// Experimental SDL support (https://pyodide.org/en/stable/usage/sdl.html).
// SDL needs a real <canvas>, which a worker does not have, so this runtime
// runs on the main thread. It is only loaded for pygame programs with an
// async game loop; blocking loops would freeze Acode.
import { flushFigures, loadRuntime, prepareCode } from "./runtime.js";

const RUNNER_SOURCE = `
import asyncio
from pyodide.code import eval_code_async

def start(code):
    return asyncio.ensure_future(eval_code_async(code, {"__name__": "__main__"}))

def stop():
    import sys
    pygame = sys.modules.get("pygame")
    if pygame is not None:
        pygame.quit()
`;

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
let task = null;
let onFatal = () => {};

function getRuntime(baseUrl) {
	runtimePromise ??= (async () => {
		const pyodide = await loadRuntime({
			baseUrl,
			stdout: (text) => handlers.stdout(text),
			stderr: (text) => handlers.stderr(text),
			// blocking input() is impossible on the main thread
			stdin: () => null,
			showImage: (data) => handlers.showImage(data),
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
async function run(code, { baseUrl, canvas, stdout, stderr, showImage }) {
	stop();
	Object.assign(handlers, { stdout, stderr, showImage });
	// SDL sets document.title to its window caption, which is Acode's title
	const title = document.title;

	let pyodide;
	try {
		pyodide = await getRuntime(baseUrl);
		canvas.id = "canvas";
		canvas.tabIndex = 0;
		pyodide.canvas.setCanvas2D(canvas);
		pyodide.runPython("import pygame\npygame.display.init()");
	} catch (error) {
		throw new SdlUnavailableError(error?.message ?? String(error));
	}

	let handle = null;
	const fatal = new Promise((_, reject) => {
		onFatal = (error) =>
			reject(new Error(`Python crashed (${error?.message ?? error})`));
	});
	try {
		await prepareCode(pyodide, code, { message: stdout, error: stderr });
		const current = runner.start(code);
		// awaiting a proxy of a Python awaitable consumes and destroys it,
		// so keep a separate copy for stop() to cancel the task with
		handle = current.copy();
		task = handle;
		await Promise.race([current, fatal]);
		return null;
	} catch (error) {
		if (error?.type === "CancelledError") return null;
		return error?.message ?? String(error);
	} finally {
		document.title = title;
		// a newer run may have replaced the task already
		if (task === handle) task = null;
		handle?.destroy();
		try {
			flushFigures(pyodide);
		} catch (error) {
			stderr(error?.message ?? String(error));
		}
	}
}

/** Cancels the running program and closes its pygame display */
function stop() {
	try {
		task?.cancel();
	} catch {
		// already finished
	}
	try {
		runner?.stop();
	} catch {
		// pygame was never started
	}
}

self.acodePythonSdl = { run, stop, SdlUnavailableError };
