// Shared Pyodide setup for the worker and the experimental SDL runtime.
// The Pyodide loader and runtime are bundled in instead of being imported at
// runtime, so loading does not depend on how the host serves .mjs files.
import { loadPyodide } from "pyodide";
import createPyodideModule from "pyodide/pyodide.asm.mjs";
import displaySource from "./python/acode_display.py";
import mplBackendSource from "./python/acode_mpl_backend.py";

// Packages not bundled with the plugin are fetched on demand from the CDN
// build matching the bundled runtime (PYODIDE_VERSION is injected at build time)
const PACKAGE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const NOISE = /already loaded from|^No new packages to load/;

/**
 * Loads Pyodide from `<baseUrl>lib/` and installs the display helpers.
 * @param {object} options
 * @param {string} options.baseUrl plugin base url, ending with "/"
 * @param {(text: string) => void} options.stdout
 * @param {(text: string) => void} options.stderr
 * @param {() => string | null} options.stdin
 * @param {(base64Png: string) => void} options.showImage
 * @param {Record<string, string>} [options.env] extra environment variables
 */
export async function loadRuntime({
	baseUrl,
	stdout,
	stderr,
	stdin,
	showImage,
	env = {},
}) {
	let fail;
	const failed = new Promise((_, reject) => {
		fail = reject;
	});
	const restore = patchInstantiateStreaming(fail);

	try {
		const pyodide = await Promise.race([
			loadPyodide({
				indexURL: `${baseUrl}lib/`,
				createPyodideModule,
				packageBaseUrl: PACKAGE_BASE_URL,
				env: { MPLBACKEND: "module://acode_mpl_backend", ...env },
				stdout,
				stderr,
				stdin,
			}),
			failed,
		]);

		pyodide.registerJsModule("_acode", { show_image: showImage });
		const sitePackages = pyodide.runPython(
			"import site; site.getsitepackages()[0]",
		);
		pyodide.FS.writeFile(`${sitePackages}/acode_display.py`, displaySource);
		pyodide.FS.writeFile(
			`${sitePackages}/acode_mpl_backend.py`,
			mplBackendSource,
		);
		pyodide.runPython("import importlib; importlib.invalidate_caches()");
		return pyodide;
	} finally {
		restore();
	}
}

/**
 * Loads the packages `code` imports and prepares display hooks for them.
 */
export async function prepareCode(pyodide, code, { message, error }) {
	await pyodide.loadPackagesFromImports(code, {
		// only report real downloads, not "already loaded" on every run
		messageCallback: (text) => {
			if (!NOISE.test(text)) message(text);
		},
		errorCallback: error,
	});
	callDisplay(pyodide, "prepare", code);
}

/** Shows matplotlib figures the code created but never showed */
export function flushFigures(pyodide) {
	callDisplay(pyodide, "flush_figures");
}

function callDisplay(pyodide, name, ...args) {
	const display = pyodide.pyimport("acode_display");
	try {
		display[name](...args);
	} finally {
		display.destroy();
	}
}

/**
 * Local file hosts in Android WebView often do not serve .wasm as
 * `application/wasm`, which makes instantiateStreaming throw. Pyodide only
 * logs that error and never settles, so fall back to an ArrayBuffer and
 * report any remaining failure through `onError`.
 * @returns {() => void} restores the original function
 */
function patchInstantiateStreaming(onError) {
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
			return await WebAssembly.instantiate(
				await response.arrayBuffer(),
				imports,
			);
		} catch (error) {
			onError(error);
			throw error;
		}
	};
	return () => {
		WebAssembly.instantiateStreaming = instantiateStreaming;
	};
}
