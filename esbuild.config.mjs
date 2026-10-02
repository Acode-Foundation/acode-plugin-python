import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import packZip from "./pack-zip.js";

const require = createRequire(import.meta.url);
const isServe = process.argv.includes("--serve");
const target = ["chrome90"];
const pyodideDir = path.dirname(require.resolve("pyodide/package.json"));
const { version: pyodideVersion } = require("pyodide/package.json");

// Pyodide runtime files fetched by the worker from `<baseUrl>lib/`
// (pyodide.mjs and pyodide.asm.mjs are bundled into worker.js)
const PYODIDE_FILES = [
	"pyodide.asm.wasm",
	"python_stdlib.zip",
	"pyodide-lock.json",
];

function serveUrls(hosts, port) {
	const names = new Set(
		(hosts?.length ? hosts : ["127.0.0.1"]).flatMap((host) => {
			if (host === "0.0.0.0" || host === "::") return ["127.0.0.1"];
			return [host.includes(":") ? `[${host}]` : host];
		}),
	);

	for (const list of Object.values(os.networkInterfaces())) {
		for (const net of list ?? []) {
			if (net.internal || net.family !== "IPv4") continue;
			names.add(net.address);
		}
	}

	return [...names].map((host) => `http://${host}:${port}`);
}

// Starts from an empty dist so files from earlier builds are never packaged
async function prepareDist() {
	await rm("dist", { recursive: true, force: true });
	const libDir = path.resolve("dist/lib");
	await mkdir(libDir, { recursive: true });
	await Promise.all(
		PYODIDE_FILES.map((file) =>
			cp(path.join(pyodideDir, file), path.join(libDir, file)),
		),
	);
}

// Bundles imported CSS (nesting lowered, fonts inlined) and exposes it as a string
const cssTextPlugin = {
	name: "css-text",
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, async (args) => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				minify: true,
				write: false,
				metafile: true,
				target,
				loader: { ".ttf": "dataurl" },
			});
			return {
				contents: result.outputFiles[0].text,
				loader: "text",
				watchFiles: Object.keys(result.metafile.inputs).map((file) =>
					path.resolve(file),
				),
			};
		});
	},
};

const zipPlugin = {
	name: "zip-plugin",
	setup(build) {
		// esbuild waits for this before finishing the build or starting a
		// rebuild, so packing never overlaps
		build.onEnd(async (result) => {
			if (result.errors.length) return;
			try {
				await packZip();
			} catch (error) {
				console.error("Error packing zip:", error);
				if (!isServe) process.exitCode = 1;
			}
		});
	},
};

const buildConfig = {
	entryPoints: {
		main: "src/main.js",
		worker: "src/worker.js",
		// experimental SDL runtime, loaded on demand by main.js
		sdl: "src/sdl.js",
	},
	bundle: true,
	minify: true,
	platform: "browser",
	target,
	format: "iife",
	logLevel: "info",
	color: true,
	outdir: "dist",
	// Node-only imports inside Pyodide, never reached in the browser
	external: ["node:*", "ws"],
	// Python helpers installed into Pyodide's site-packages
	loader: { ".py": "text" },
	define: {
		PYODIDE_VERSION: JSON.stringify(pyodideVersion),
	},
	plugins: [cssTextPlugin, zipPlugin],
};

(async () => {
	await prepareDist();

	if (isServe) {
		console.log("Starting development server...");

		const ctx = await esbuild.context(buildConfig);
		await ctx.watch();
		const { hosts, port } = await ctx.serve({
			servedir: ".",
			port: 3000,
		});
		for (const url of serveUrls(hosts, port)) {
			console.log(`Development server: ${url}`);
		}
	} else {
		console.log("Building for production...");
		await esbuild.build(buildConfig);
		if (!process.exitCode) console.log("Production build complete.");
	}
})();
