import { flushFigures, loadRuntime, prepareCode } from "./runtime.js";

let inputCount = 0;

function postInitError(error) {
	// Error objects are not always cloneable, so only send the message
	self.postMessage({
		action: "init",
		success: false,
		error: `Failed to load Python: ${error?.message ?? error}`,
	});
}

async function loadPyodideAndPackages(baseUrl = "", packages) {
	self.pyodide = await loadRuntime({
		baseUrl,
		stdout: (msg) => {
			stdout(msg);
		},
		stderr: (msg) => {
			stderr(msg);
		},
		stdin: () => {
			return stdin();
		},
		showImage: (data) => {
			self.postMessage({ action: "image", data });
		},
		// there is no canvas in a worker; Emscripten's SDL video and audio
		// would crash Pyodide, so pygame runs headless here
		env: { SDL_VIDEODRIVER: "dummy", SDL_AUDIODRIVER: "dummy" },
	});
	// a fatal error leaves Python unusable and pending runs never settle
	self.pyodide._api.on_fatal = (error) => {
		self.postMessage({
			action: "fatal",
			error: String(error?.message ?? error),
		});
	};
	if (Array.isArray(packages)) {
		await self.pyodide.loadPackage(packages);
	}
}

// A Map, so a message's action name can only reach these handlers and never
// inherited Object methods like `constructor` (Object.hasOwn needs Chrome 93)
const actions = new Map(
	Object.entries({
		async init(data) {
			const { packages, baseUrl, cacheFileUrl } = data;
			self.cacheFileUrl = cacheFileUrl;
			try {
				await loadPyodideAndPackages(baseUrl, packages);

				// override python input
				await self.pyodide.runPython(`import sys
def input(prompt=''):
    print(prompt)
    return sys.stdin.readline().strip()

__builtins__.input = input
`);
				self.postMessage({
					action: "init",
					success: true,
				});
			} catch (error) {
				postInitError(error);
			}
		},
		async run(data) {
			const { code } = data;
			if (!self.pyodide) {
				self.postMessage({
					action: "run",
					success: false,
					error: "Python is not loaded yet.",
				});
				return;
			}
			try {
				await prepareCode(self.pyodide, code, {
					message: stdout,
					error: stderr,
				});
				let output;
				try {
					output = await self.pyodide.runPythonAsync(code);
				} finally {
					showLeftoverFigures();
				}
				self.postMessage({
					action: "run",
					success: true,
					output: output?.toString() ?? output ?? "",
				});
			} catch (error) {
				self.postMessage({
					action: "run",
					success: false,
					error: error?.message ?? error?.toString(),
				});
			}
		},
		input(data) {
			const { line } = data;
			self.line = line;
		},
	}),
);

self.onmessage = async (e) => {
	const { action } = e.data;
	if (!actions.has(action)) return;

	const handler = actions.get(action);
	if (typeof handler === "function") {
		await handler(e.data);
	}
};

self.line = "";

function showLeftoverFigures() {
	try {
		flushFigures(self.pyodide);
	} catch (error) {
		stderr(error);
	}
}

function stdout(msg) {
	self.postMessage({
		action: "stdout",
		text: msg.message ?? msg.toString(),
	});
}

function stderr(msg) {
	self.postMessage({
		action: "stderr",
		text: msg.message ?? msg.toString(),
	});
}

function stdin(str = "") {
	self.postMessage({
		action: "input",
		text: str,
	});
	let line = "";
	while (!line) {
		line = read();
	}
	return line.replace("\0", "");
}

function read() {
	const xhr = new XMLHttpRequest();
	xhr.timeout = 1000;
	xhr.open("GET", self.cacheFileUrl, false);
	try {
		xhr.send();
		const text = xhr.responseText;
		if (text.endsWith(`\0${inputCount}`)) {
			++inputCount;
			return text.slice(0, -`${inputCount}`.length);
		} else {
			return "";
		}
	} catch (err) {
		throw err instanceof Error ? err : new Error(err);
	}
}
