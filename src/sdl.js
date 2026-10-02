// Experimental SDL support (https://pyodide.org/en/stable/usage/sdl.html).
// SDL needs a real <canvas>, which a worker does not have, so this runtime
// runs on the main thread. Ordinary blocking game loops work through JSPI
// (see python/acode_pygame.py); without JSPI only async loops are safe.
// Code here can reach Acode's page, so main.js asks the user first.
import {
	flushFigures,
	loadRuntime,
	PACKAGE_BASE_URL,
	prepareCode,
} from "./runtime.js";

const RUNNER_SOURCE = `
import asyncio
from pyodide.code import eval_code_async

def start(code):
    import acode_pygame
    acode_pygame.reset()
    acode_pygame.install()
    return asyncio.ensure_future(eval_code_async(code, {"__name__": "__main__"}))

def has_await(code):
    # real await expressions only, not the word in comments or strings
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False
    return any(
        isinstance(node, (ast.Await, ast.AsyncFor, ast.AsyncWith))
        for node in ast.walk(tree)
    )

async def can_block():
    # only meaningful inside a task, where blocking code would run
    from pyodide.ffi import can_run_sync
    return can_run_sync()

def stop():
    import sys
    acode_pygame = sys.modules.get("acode_pygame")
    if acode_pygame is not None:
        acode_pygame.request_stop()
    pygame = sys.modules.get("pygame")
    if pygame is not None:
        pygame.quit()
`;

// errors that mean the program was stopped from the console
const STOPPED = new Set(["CancelledError", "StopProgram"]);

/** Thrown when SDL itself is unavailable, so the caller can fall back */
class SdlUnavailableError extends Error {}

// callbacks of the current run; the runtime is loaded once and reused
const handlers = {
	stdout() {},
	stderr() {},
	showImage() {},
};

let runtimePromise = null;
let runner = null;
/** the current run: its task handle and whether it was stopped */
let current = null;
let onFatal = () => {};
/** set while window.fetch is routed, so dispose() can undo it */
let fetchRoute = null;

/**
 * Other plugins may replace `window.fetch` on Acode's page, e.g. with native
 * HTTP to avoid CORS. Native HTTP cannot reach the plugin's own files at
 * https://localhost/..., which only exist inside the WebView, so Pyodide
 * failed with "Failed to connect to localhost/127.0.0.1:443". Requests for the
 * plugin's files and Pyodide packages go through the browser's own fetch,
 * taken from a hidden same-origin iframe; everything else is untouched.
 */
function routeRuntimeFetch(baseUrl) {
	if (fetchRoute) return;
	const $frame = document.createElement("iframe");
	$frame.style.display = "none";
	$frame.setAttribute("aria-hidden", "true");
	document.body.append($frame);
	const frameWindow = $frame.contentWindow;
	const browserFetch = frameWindow.fetch.bind(frameWindow);
	const pageFetch = window.fetch;
	const prefixes = [baseUrl, PACKAGE_BASE_URL];

	const route = { $frame, pageFetch, disposed: false, fetch: null };
	route.fetch = function (input, init) {
		const url = typeof input === "string" ? input : (input?.url ?? `${input}`);
		if (!route.disposed && prefixes.some((prefix) => url.startsWith(prefix))) {
			return browserFetch(input, init);
		}
		return pageFetch.call(this, input, init);
	};
	window.fetch = route.fetch;
	fetchRoute = route;
}

/** Undoes routeRuntimeFetch when the plugin is unmounted */
function unrouteRuntimeFetch() {
	if (!fetchRoute) return;
	// if another plugin wrapped fetch after us, restoring would drop their
	// wrapper, so leave ours in place as a plain pass-through instead
	if (window.fetch === fetchRoute.fetch) window.fetch = fetchRoute.pageFetch;
	fetchRoute.disposed = true;
	fetchRoute.$frame.remove();
	fetchRoute = null;
}

function getRuntime(baseUrl) {
	runtimePromise ??= (async () => {
		routeRuntimeFetch(baseUrl);
		const pyodide = await loadRuntime({
			baseUrl,
			stdout: (text) => handlers.stdout(text),
			stderr: (text) => handlers.stderr(text),
			// blocking input() is impossible on the main thread
			stdin: () => null,
			showImage: (data, scale) => handlers.showImage(data, scale),
			// only take keyboard input from the canvas, not all of Acode
			env: { SDL_EMSCRIPTEN_KEYBOARD_ELEMENT: "#canvas" },
		});
		// required by SDL's main loop handling, see the Pyodide SDL docs
		pyodide._api._skip_unwind_fatal_error = true;
		// a fatal error leaves this runtime unusable, load a new one next time
		pyodide._api.on_fatal = (error) => {
			runtimePromise = null;
			onFatal(error);
		};
		await pyodide.loadPackage("pygame-ce", {
			messageCallback: (text) => handlers.stdout(text),
			errorCallback: (text) => handlers.stderr(text),
		});

		const namespace = pyodide.globals.get("dict")();
		pyodide.runPython(RUNNER_SOURCE, { globals: namespace });
		runner = {
			start: namespace.get("start"),
			hasAwait: namespace.get("has_await"),
			canBlock: namespace.get("can_block"),
			stop: namespace.get("stop"),
		};
		namespace.destroy();
		return pyodide;
	})().catch((error) => {
		runtimePromise = null;
		throw error;
	});
	return runtimePromise;
}

/**
 * Runs `code` with SDL drawing to `canvas`.
 * @returns {Promise<string | null>} formatted Python error, or null
 * @throws {SdlUnavailableError} if SDL could not be set up
 */
async function run(
	code,
	{ baseUrl, canvas, stdout, stderr, showImage, width, pixelRatio },
) {
	stop();
	const run = { task: null, stopped: false };
	current = run;
	Object.assign(handlers, { stdout, stderr, showImage });
	// SDL sets document.title to its window caption, which is Acode's title
	const title = document.title;

	let pyodide;
	try {
		pyodide = await getRuntime(baseUrl);
		// stopped while the runtime was loading
		if (run.stopped) return null;
		canvas.id = "canvas";
		canvas.tabIndex = 0;
		pyodide.canvas.setCanvas2D(canvas);
		pyodide.runPython("import pygame\npygame.display.init()");
		// a blocking game loop needs JSPI to pause, or it freezes Acode
		if (!runner.hasAwait(code) && !(await runner.canBlock())) {
			throw new Error(
				"this WebView cannot pause Python (no JSPI support), so the game loop must be async: await asyncio.sleep(0) each frame",
			);
		}
		if (run.stopped) return null;
	} catch (error) {
		if (current === run) current = null;
		if (run.stopped) return null;
		throw new SdlUnavailableError(error?.message ?? String(error));
	}

	const fatal = new Promise((_, reject) => {
		onFatal = (error) =>
			reject(new Error(`Python crashed (${error?.message ?? error})`));
	});
	try {
		await prepareCode(pyodide, code, {
			message: stdout,
			error: stderr,
			width,
			pixelRatio,
		});
		// stopped while packages were loading
		if (run.stopped) return null;
		const task = runner.start(code);
		// awaiting a proxy of a Python awaitable consumes and destroys it,
		// so keep a separate copy for stop() to cancel the task with
		run.task = task.copy();
		await Promise.race([task, fatal]);
		return null;
	} catch (error) {
		if (run.stopped || STOPPED.has(error?.type)) return null;
		return error?.message ?? String(error);
	} finally {
		document.title = title;
		run.task?.destroy();
		if (current === run) current = null;
		if (!run.stopped) {
			try {
				flushFigures(pyodide);
			} catch (error) {
				stderr(error?.message ?? String(error));
			}
		}
	}
}

/** Stops the running program and closes its pygame display */
function stop() {
	if (current) current.stopped = true;
	try {
		current?.task?.cancel();
	} catch {
		// already finished
	}
	try {
		runner?.stop();
	} catch {
		// pygame was never started
	}
}

/** Stops any program and undoes page changes when the plugin is unmounted */
function dispose() {
	stop();
	unrouteRuntimeFetch();
	if (self.acodePythonSdl === api) delete self.acodePythonSdl;
}

const api = { run, stop, dispose, SdlUnavailableError };
self.acodePythonSdl = api;
