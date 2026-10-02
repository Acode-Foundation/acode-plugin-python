import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jszip from "jszip";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Packs plugin.json, metadata files and the dist folder into plugin.zip.
 * The archive is written to a temp file and renamed, so a dev server never
 * serves a partially written zip.
 */
export default async function packZip() {
	const pluginJSON = path.join(root, "plugin.json");
	const json = JSON.parse(await fs.readFile(pluginJSON, "utf8"));
	const readmeDotMd = await resolveMetadataFile(json.readme, [
		"readme.md",
		"README.md",
	]);
	const changelogDotMd = await resolveMetadataFile(json.changelogs, [
		"changelog.md",
		"changelogs.md",
		"CHANGELOG.md",
	]);

	const zip = new jszip();

	zip.file("icon.png", await fs.readFile(path.join(root, "icon.png")));
	zip.file("plugin.json", await fs.readFile(pluginJSON));

	const licenseFile = path.join(root, "LICENSE");
	if (await exists(licenseFile)) {
		zip.file("LICENSE", await fs.readFile(licenseFile));
	}

	if (readmeDotMd) {
		zip.file(
			json.readme || path.basename(readmeDotMd),
			await fs.readFile(readmeDotMd),
		);
	}

	if (changelogDotMd) {
		zip.file(
			json.changelogs || path.basename(changelogDotMd),
			await fs.readFile(changelogDotMd),
		);
	}

	await loadFile(zip, "", path.join(root, "dist"));

	const output = path.join(root, "plugin.zip");
	const tempOutput = `${output}.tmp`;
	await fs.writeFile(
		tempOutput,
		await zip.generateAsync({ type: "nodebuffer", streamFiles: true }),
	);
	await fs.rename(tempOutput, output);
	console.log("Plugin plugin.zip written.");
}

async function loadFile(zip, base, folder) {
	for (const file of await fs.readdir(folder)) {
		if (file === ".DS_Store" || /LICENSE.txt/.test(file)) continue;

		const filePath = path.join(folder, file);
		const zipPath = path.posix.join(base, file);

		if ((await fs.stat(filePath)).isDirectory()) {
			zip.folder(zipPath);
			await loadFile(zip, zipPath, filePath);
			continue;
		}

		zip.file(zipPath, await fs.readFile(filePath));
	}
}

async function resolveMetadataFile(configuredPath, fallbacks) {
	if (configuredPath) {
		const file = path.join(root, configuredPath);
		if (!(await exists(file))) {
			throw new Error(`Missing plugin metadata file: ${configuredPath}`);
		}
		return file;
	}

	for (const fallback of fallbacks) {
		const file = path.join(root, fallback);
		if (await exists(file)) return file;
	}
	return null;
}

async function exists(file) {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}
