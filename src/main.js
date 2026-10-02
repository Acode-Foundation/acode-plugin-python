import plugin from "../plugin.json";
import style from "./style.css";

const WRAP_KEY = `${plugin.id}.wrap`;
// Material "wrap_text" icon (Apache-2.0); Acode's icon font has no wrap glyph
const WRAP_ICON =
	'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z"/></svg>';

class Python {
	#worker;
	#onInitError;
	#onInitSuccess;
	#onRunSuccess;
	#onRunError;
	#cacheFile;
	#cacheFileUrl;
	#isInput = false;
	$input = null;
	$page = null;
	$runBtn = null;
	$wrapBtn = null;
	$style = null;
	#codes = [];
	#niddle = 0;
	#inputCount = 0;
	#state = 0;
	#initPromise = Promise.resolve(false);

	INITIALIZING = 1;
	INITIALIZED = 2;
	NOT_INTIALIZED = 0;

	name = "Python";
	baseUrl = "";
	pyodide = null;

	async init($page, cacheFile, cacheFileUrl) {
		$page.id = "acode-plugin-python";

		this.#cacheFileUrl = cacheFileUrl;
		this.$page = $page;
		this.$page.settitle("Python");
		this.#cacheFile = cacheFile;

		const onhide = $page.onhide;
		$page.onhide = () => {
			this.#state = this.NOT_INTIALIZED;
			this.#worker?.terminate();
			this.initWorker();
			onhide();
		};

		let main = this.$page.get(".main");

		if (!main) {
			main = tag("div", { className: "main" });
			this.$page.append(main);
		}

		main.style.padding = "10px";
		main.style.overflow = "auto";
		main.style.boxSizing = "border-box";

		this.$runBtn = tag("div", {
			className: "icon play_py",
			attr: { action: "run" },
			onclick: this.run.bind(this),
		});
		this.$wrapBtn = tag("span", {
			className: "icon wrap_py",
			innerHTML: WRAP_ICON,
			attr: { action: "toggle-wrap", title: "Wrap lines", role: "button" },
			onclick: () => this.#setWrap(!this.$page.classList.contains("wrap")),
		});
		this.$page.header?.append(this.$wrapBtn);
		this.#setWrap(loadWrap());
		this.$style = tag("style", { textContent: style });
		this.$input = tag("div", {
			className: "print input",
			children: [
				tag("textarea", {
					onkeydown: this.#onkeydown.bind(this),
					oninput: this.#oninput.bind(this),
				}),
			],
		});

		this.checkRunnable();
		editorManager.on("switch-file", this.checkRunnable.bind(this));
		editorManager.on("rename-file", this.checkRunnable.bind(this));
		document.head.append(this.$style);
		this.initWorker();
	}

	/**
	 * Starts the Python worker if it is not running.
	 * @returns {Promise<boolean>} false if Python failed to load
	 */
	initWorker() {
		if (this.#state === this.NOT_INTIALIZED) {
			this.#initPromise = this.#startWorker();
		}
		return this.#initPromise;
	}

	async #startWorker() {
		this.#state = this.INITIALIZING;
		this.$page.settitle(strings["loading..."]);
		this.#worker?.terminate();

		try {
			// inside try: construction throws if module workers are unsupported
			this.#worker = new Worker(`${this.baseUrl}worker.js`, { type: "module" });
			this.#worker.onmessage = this.#workerOnMessage.bind(this);
			await new Promise((resolve, reject) => {
				this.#onInitSuccess = resolve;
				this.#onInitError = reject;
				// fires if worker.js itself fails to load or throws while starting
				this.#worker.onerror = (e) => {
					e.preventDefault();
					reject(`Failed to start Python worker: ${e.message || e.type}`);
				};
				this.#worker.postMessage({
					action: "init",
					baseUrl: this.baseUrl,
					cacheFileUrl: this.#cacheFileUrl,
				});
			});
			this.#state = this.INITIALIZED;
			return true;
		} catch (error) {
			// allow the next run to retry
			this.#state = this.NOT_INTIALIZED;
			this.print(error?.message ?? error, "error");
			return false;
		} finally {
			this.$page.settitle("Python");
		}
	}

	async run() {
		this.#showPage();
		this.#inputCount = 0;
		this.#append(this.$input);
		await this.#cacheFile.writeFile("");
		await this.runCode(editorManager.editor.getValue());
	}

	async terminal() {
		this.#showPage();
	}

	async runCode(code) {
		if (!(await this.initWorker())) return;
		this.#worker.postMessage({
			action: "run",
			code,
		});
		try {
			const res = await new Promise((resolve, error) => {
				this.#onRunSuccess = resolve;
				this.#onRunError = error;
			});
			this.print(res, "output");
		} catch (error) {
			this.print(error, "error");
		}
	}

	destroy() {
		if (this.$runBtn) {
			this.$runBtn.onclick = null;
			this.$runBtn.remove();
		}

		this.$wrapBtn?.remove();
		this.#worker?.terminate();
		editorManager.off("switch-file", this.checkRunnable.bind(this));
		editorManager.off("rename-file", this.checkRunnable.bind(this));
		this.$style.remove();
	}

	checkRunnable() {
		const file = editorManager.activeFile;

		if (this.$runBtn.isConnected) {
			this.$runBtn.remove();
		}

		if (file?.name.endsWith(".py")) {
			const $header = root.get("header");
			$header.get(".icon.play_arrow")?.remove();
			$header.insertBefore(this.$runBtn, $header.lastChild);
		}
	}

	/** Wraps long output lines instead of scrolling them horizontally */
	#setWrap(wrap) {
		this.$page.classList.toggle("wrap", wrap);
		this.$wrapBtn.classList.toggle("active", wrap);
		this.$wrapBtn.setAttribute("aria-pressed", String(wrap));
		saveWrap(wrap);
	}

	print(res, type) {
		if (!this.$page.isConnected) return;
		const $output = tag("div", {
			className: `print ${type || ""}`,
			textContent: res,
		});
		this.#append($output, this.$input);
	}

	#showPage() {
		const $main = this.$page.get(".main");
		if (!this.$page.isConnected) {
			this.$page.classList.remove("hide");
			this.$page.show();
		}
		$main.innerHTML = "";
	}

	#clearConsole() {
		this.$page.get(".main").innerHTML = "";
		this.#append(this.$input);
	}

	#append(...$el) {
		const $main = this.$page.get(".main");
		if (!$main) this.$page.append(tag("div", { className: "main" }));
		this.$page.get(".main").append(...$el);
	}

	async #workerOnMessage(e) {
		const { action, success, error, text } = e.data;

		switch (action) {
			case "init":
				if (success) {
					this.#onInitSuccess();
				} else {
					this.#onInitError(error);
				}
				break;

			case "run":
				if (success) {
					this.#onRunSuccess();
				} else {
					this.#onRunError(error);
				}
				break;

			case "input":
				this.#isInput = true;
				if (text) this.print(text);
				await this.#cacheFile.writeFile("");
				this.$input.get("textarea").focus();
				break;

			case "stdout":
				this.print(text);
				break;

			case "stderr":
				this.print(text, "error");
				break;

			default:
				break;
		}
	}

	#onkeydown(e) {
		const value = e.target.value;
		const lines = value.split("\n");
		const canGoUp = this.#getCursorPosition() === 1;
		const canGoDown = this.#getCursorPosition() === lines.length;
		// if up arrow is pressed, show previous code
		if (canGoUp && e.key === "ArrowUp") {
			e.preventDefault();
			if (this.#niddle > 0) {
				this.#niddle -= 1;
				e.target.value = this.#codes[this.#niddle];
			}
		}

		// if down arrow is pressed, show next code
		if (canGoDown && e.key === "ArrowDown") {
			e.preventDefault();
			if (this.#niddle < this.#codes.length) {
				this.#niddle += 1;
				e.target.value = this.#codes[this.#niddle] || "";
			}
		}

		// if ctrl + l is pressed, clear the input
		if (e.key === "l" && e.ctrlKey) {
			this.#clearConsole();
		}

		if (e.key === "Tab") {
			e.preventDefault();
			e.target.value += "\t";
		}
	}

	#getCursorPosition() {
		const $textarea = this.$input.get("textarea");
		const { selectionStart, selectionEnd } = $textarea;

		if (selectionStart !== selectionEnd) return;
		const lines = $textarea.value;

		// get the line number of the cursor
		return lines.slice(0, selectionStart).split("\n").length;
	}

	#oninput(e) {
		const $el = e.target;
		let { value } = $el;
		$el.style.height = `${$el.scrollHeight}px`;
		// check if new line is added
		if (value.endsWith("\n")) {
			if (this.#isInput) {
				this.#isInput = false;
				value = value.slice(0, -1);
				this.#cacheFile.writeFile(`${value}\0${this.#inputCount++}`);
				this.print(value, "input");
				this.$input.get("textarea").value = "";
				return;
			}

			if (!this.#isIncomplete(value)) {
				this.#codes.push(value.trim());
				this.#niddle = this.#codes.length;
				this.print(value, "input");
				this.runCode(value);
				this.$input.get("textarea").value = "";
			}
		}
	}

	#isIncomplete(code) {
		const lines = code.trim().split("\n");
		const lastLine = lines[lines.length - 1];

		// if last line ends with ':', it is incomplete
		if (/:$/.test(lastLine)) {
			return true;
		}

		// if last line starts with tab or soft tab, it is incomplete
		if (/^\W+/.test(lastLine)) {
			if (/\n\n$/.test(code)) {
				return false;
			}
			return true;
		}

		return false;
	}
}

function loadWrap() {
	try {
		return localStorage.getItem(WRAP_KEY) === "true";
	} catch {
		return false;
	}
}

function saveWrap(wrap) {
	try {
		localStorage.setItem(WRAP_KEY, String(wrap));
	} catch {
		// the preference is a convenience, ignore storage failures
	}
}

if (window.acode) {
	const python = new Python();
	acode.setPluginInit(
		plugin.id,
		(baseUrl, $page, { cacheFileUrl, cacheFile }) => {
			if (!baseUrl.endsWith("/")) baseUrl += "/";
			python.baseUrl = baseUrl;
			python.init($page, cacheFile, cacheFileUrl);
		},
	);
	acode.setPluginUnmount(plugin.id, () => {
		python.destroy();
	});
}
