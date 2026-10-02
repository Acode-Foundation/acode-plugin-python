import plugin from "../plugin.json";
import style from "./style.css";

const WRAP_KEY = `${plugin.id}.wrap`;
const SDL_ALLOWED_KEY = `${plugin.id}.sdlAllowed`;
// Material "wrap_text" icon (Apache-2.0); Acode's icon font has no wrap glyph
const WRAP_ICON =
	'<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z"/></svg>';

// pygame programs use the experimental SDL runtime on the main thread
const PYGAME_IMPORT = /^\s*(?:import|from)\s+pygame\b/m;

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
	$status = null;
	$style = null;
	#codes = [];
	#niddle = 0;
	#inputCount = 0;
	#state = 0;
	#initPromise = Promise.resolve(false);
	/** number of code runs still waiting for the worker */
	#running = 0;
	#sdlPromise = null;
	/** SDL API from this instance's current sdl.js load */
	#sdl = null;
	/** id of the current sdl.js load; older loads are ignored */
	#sdlLoadId = null;
	$sdlScript = null;
	/** bumped by every run and when the console closes, to drop stale runs */
	#runId = 0;
	#sdlAllowed = false;

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
			this.#runId += 1;
			this.#sdl?.stop();
			this.#state = this.NOT_INTIALIZED;
			this.#worker?.terminate();
			// runs on the terminated worker never reply
			this.#running = 0;
			this.#isInput = false;
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
			attr: { action: "toggle-wrap", role: "button" },
			onclick: () => this.#setWrap(!this.$page.classList.contains("wrap")),
		});
		// thin progress line along the header while Python loads or code runs
		this.$status = tag("div", { className: "py-progress" });
		this.$page.header?.append(this.$status, this.$wrapBtn);
		this.#setWrap(loadFlag(WRAP_KEY));
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
		this.#updateStatus();
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
			this.#updateStatus();
		}
	}

	async run() {
		const runId = ++this.#runId;
		this.#sdl?.stop();
		this.#showPage();
		this.#inputCount = 0;
		this.#append(this.$input);
		await this.#cacheFile.writeFile("");

		const code = editorManager.editor.getValue();
		if (PYGAME_IMPORT.test(code)) {
			if (!(await this.#allowSdl())) {
				this.print("Running without the pygame display.", "info");
			} else if (await this.#runWithSdl(code, runId)) {
				return;
			}
			if (runId !== this.#runId) return;
		}
		await this.runCode(code);
	}

	/**
	 * The pygame display runs Python on Acode's own page, where it can reach
	 * the app and its data, unlike the isolated worker. Ask before doing that.
	 */
	async #allowSdl() {
		if (this.#sdlAllowed || loadFlag(SDL_ALLOWED_KEY)) return true;

		const confirm =
			acode.require?.("confirm") ??
			((title, message) =>
				Promise.resolve(window.confirm(`${title}\n\n${message}`)));
		const answer = await confirm(
			"Show pygame display?",
			"The experimental pygame display runs this program on Acode's main page, where it can access the app and its data. Only continue for code you trust. Cancel runs it without the display.",
			false,
			{ checkboxText: "Don't ask again", returnState: true },
		);
		// older Acode versions return a plain boolean
		const confirmed = typeof answer === "object" ? answer?.confirmed : answer;
		if (!confirmed) return false;
		this.#sdlAllowed = true;
		if (answer?.checked) saveFlag(SDL_ALLOWED_KEY, true);
		return true;
	}

	/**
	 * Runs a pygame program with the experimental SDL runtime.
	 * @returns {Promise<boolean>} false if SDL is unavailable and the caller
	 * should fall back to the worker
	 */
	async #runWithSdl(code, runId) {
		const $canvas = tag("canvas");
		const $media = tag("div", { className: "py-media", children: [$canvas] });
		this.#append($media, this.$input);
		this.#running += 1;
		this.#updateStatus();
		try {
			const sdl = await this.#loadSdl();
			// another run started or the console closed while sdl.js loaded
			if (runId !== this.#runId) return true;
			const error = await sdl.run(code, {
				baseUrl: this.baseUrl,
				canvas: $canvas,
				stdout: (text) => this.print(text),
				stderr: (text) => this.print(text, "error"),
				showImage: (data, scale) => this.#printImage(data, scale),
				...this.#displaySize(),
			});
			if (error) this.print(error, "error");
			return true;
		} catch (error) {
			$media.remove();
			this.print(
				`Experimental SDL support is unavailable (${error?.message ?? error}). Running without it, so pygame windows cannot be shown.`,
				"info",
			);
			return false;
		} finally {
			this.#running = Math.max(0, this.#running - 1);
			this.#updateStatus();
		}
	}

	/**
	 * Loads sdl.js. Each load registers its API under its own id, so a stale
	 * load that finishes late (e.g. after an unmount and remount) cannot
	 * replace the API this instance uses.
	 */
	#loadSdl() {
		this.#sdlPromise ??= new Promise((resolve, reject) => {
			const loadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			this.#sdlLoadId = loadId;
			const $script = tag("script", { src: `${this.baseUrl}sdl.js` });
			$script.dataset.loadId = loadId;
			this.$sdlScript = $script;
			$script.onload = () => {
				const loads = window.acodePythonSdlLoads;
				const sdl = loads?.[loadId];
				if (loads) delete loads[loadId];
				if (!sdl) {
					reject(new Error("sdl.js did not initialize"));
					return;
				}
				if (this.#sdlLoadId === loadId) this.#sdl = sdl;
				resolve(sdl);
			};
			$script.onerror = () => reject(new Error("failed to load sdl.js"));
			document.head.append($script);
		}).catch((error) => {
			this.#sdlPromise = null;
			throw error;
		});
		return this.#sdlPromise;
	}

	async terminal() {
		this.#showPage();
	}

	async runCode(code) {
		this.#running += 1;
		this.#updateStatus();
		try {
			if (!(await this.initWorker())) return;
			this.#worker.postMessage({
				action: "run",
				code,
				...this.#displaySize(),
			});
			const res = await new Promise((resolve, error) => {
				this.#onRunSuccess = resolve;
				this.#onRunError = error;
			});
			this.print(res, "output");
		} catch (error) {
			this.print(error, "error");
		} finally {
			this.#running = Math.max(0, this.#running - 1);
			this.#updateStatus();
		}
	}

	/** Progress line while Python is busy, hidden while it waits for input() */
	#updateStatus() {
		if (!this.$status) return;
		const busy =
			(this.#state === this.INITIALIZING || this.#running > 0) &&
			!this.#isInput;
		this.$status.classList.toggle("running", busy);
	}

	destroy() {
		if (this.$runBtn) {
			this.$runBtn.onclick = null;
			this.$runBtn.remove();
		}

		this.$wrapBtn?.remove();
		this.$status?.remove();
		// runs still waiting for sdl.js must not start after this
		this.#runId += 1;
		this.#sdl?.dispose();
		this.#sdl = null;
		// a later init loads a fresh sdl.js; a load still in flight is ignored
		this.#sdlLoadId = null;
		this.#sdlPromise = null;
		this.$sdlScript?.remove();
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
		saveFlag(WRAP_KEY, wrap);
	}

	print(res, type) {
		if (!this.$page.isConnected) return;
		const $output = tag("div", {
			className: `print ${type || ""}`,
			textContent: res,
		});
		this.#append($output, this.$input);
	}

	/** Console width (CSS px) and pixel ratio, so figures fit and stay sharp */
	#displaySize() {
		const $main = this.$page.get(".main");
		const style = $main && getComputedStyle($main);
		const padding = style
			? Number.parseFloat(style.paddingLeft) +
				Number.parseFloat(style.paddingRight)
			: 0;
		return {
			width: Math.max(0, ($main?.clientWidth ?? 0) - padding),
			pixelRatio: window.devicePixelRatio || 1,
		};
	}

	/**
	 * Shows a PNG rendered at `scale` times its display size at its true
	 * size, so it is sharp on HiDPI screens instead of upscaled.
	 */
	#printImage(data, scale = 1) {
		if (!this.$page.isConnected) return;
		const $img = tag("img", { src: `data:image/png;base64,${data}` });
		$img.onload = () => {
			$img.style.width = `${$img.naturalWidth / scale}px`;
		};
		this.#append(
			tag("div", { className: "py-media", children: [$img] }),
			this.$input,
		);
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
				this.#updateStatus();
				if (text) this.print(text);
				await this.#cacheFile.writeFile("");
				this.$input.get("textarea").focus();
				break;

			case "stdout":
				this.print(text);
				break;

			case "image":
				this.#printImage(e.data.data, e.data.scale);
				break;

			case "fatal":
				// Python cannot recover; restart it on the next run
				this.#worker?.terminate();
				this.#state = this.NOT_INTIALIZED;
				this.#isInput = false;
				this.#onRunError?.(
					`Python crashed (${error}). It will restart on the next run.`,
				);
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
				this.#updateStatus();
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

function loadFlag(key) {
	try {
		return localStorage.getItem(key) === "true";
	} catch {
		return false;
	}
}

function saveFlag(key, value) {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// preferences are a convenience, ignore storage failures
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
