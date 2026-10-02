// The Pyodide loader and runtime are bundled into this file instead of being
// imported at runtime, so loading does not depend on how the host serves .mjs files
import { loadPyodide } from "pyodide";
import createPyodideModule from "pyodide/pyodide.asm.mjs";

let inputCount = 0;

// Packages not bundled with the plugin are fetched on demand from the CDN
// build matching the bundled runtime (PYODIDE_VERSION is injected at build time)
const PACKAGE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Local file hosts in Android WebView often do not serve .wasm as
// `application/wasm`, which makes instantiateStreaming throw. Pyodide only logs
// that error and never settles, so fall back to an ArrayBuffer and report any
// remaining failure ourselves instead of leaving the page stuck on loading.
const instantiateStreaming = WebAssembly.instantiateStreaming;
WebAssembly.instantiateStreaming = async (source, imports) => {
	try {
		const response = await source;
		if (!response.ok) {
			throw new Error(`${response.url} (HTTP ${response.status})`);
		}
		const type = response.headers.get("Content-Type") ?? "";
		if (instantiateStreaming && type.startsWith("application/wasm")) {
			return await instantiateStreaming(response, imports);
		}
		return await WebAssembly.instantiate(await response.arrayBuffer(), imports);
	} catch (error) {
		postInitError(error);
		throw error;
	}
};

function postInitError(error) {
	// Error objects are not always cloneable, so only send the message
	self.postMessage({
		action: "init",
		success: false,
		error: `Failed to load Python: ${error?.message ?? error}`,
	});
}

async function loadPyodideAndPackages(baseUrl = "", packages) {
	self.pyodide = await loadPyodide({
		indexURL: `${baseUrl}lib/`,
		createPyodideModule,
		packageBaseUrl: PACKAGE_BASE_URL,
		stdout: (msg) => {
			stdout(msg);
		},
		stderr: (msg) => {
			stderr(msg);
		},
		stdin: () => {
			return stdin();
		},
	});
	if (Array.isArray(packages)) {
		await self.pyodide.loadPackage(packages);
	}
}

const actions = {
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
			await self.pyodide.loadPackagesFromImports(code, {
				messageCallback: stdout,
				errorCallback: stderr,
			});
			const output = await self.pyodide.runPythonAsync(code);
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
};

self.onmessage = async (e) => {
	const { action } = e.data;

	if (actions[action]) {
		await actions[action](e.data);
	}
};

self.line = "";

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
