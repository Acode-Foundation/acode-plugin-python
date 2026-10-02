import fs from "node:fs";
import path from "node:path";
import jszip from "jszip";

const root = import.meta.dirname;
const iconFile = path.join(root, "icon.png");
const licenseFile = path.join(root, "LICENSE");
const pluginJSON = path.join(root, "plugin.json");
const distFolder = path.join(root, "dist");
const json = JSON.parse(fs.readFileSync(pluginJSON, "utf8"));
const readmeDotMd = resolveMetadataFile(json.readme, [
	"readme.md",
	"README.md",
]);
const changelogDotMd = resolveMetadataFile(json.changelogs, [
	"changelog.md",
	"changelogs.md",
	"CHANGELOG.md",
]);

const zip = new jszip();

zip.file("icon.png", fs.readFileSync(iconFile));
zip.file("plugin.json", fs.readFileSync(pluginJSON));

if (fs.existsSync(licenseFile)) {
	zip.file("LICENSE", fs.readFileSync(licenseFile));
}

if (readmeDotMd) {
	zip.file(
		json.readme || path.basename(readmeDotMd),
		fs.readFileSync(readmeDotMd),
	);
}

if (changelogDotMd) {
	zip.file(
		json.changelogs || path.basename(changelogDotMd),
		fs.readFileSync(changelogDotMd),
	);
}

loadFile("", distFolder);

zip
	.generateNodeStream({ type: "nodebuffer", streamFiles: true })
	.pipe(fs.createWriteStream(path.join(root, "plugin.zip")))
	.on("finish", () => {
		console.log("Plugin plugin.zip written.");
	});

function loadFile(base, folder) {
	for (const file of fs.readdirSync(folder)) {
		if (file === ".DS_Store" || /LICENSE.txt/.test(file)) continue;

		const filePath = path.join(folder, file);
		const zipPath = path.posix.join(base, file);

		if (fs.statSync(filePath).isDirectory()) {
			zip.folder(zipPath);
			loadFile(zipPath, filePath);
			continue;
		}

		zip.file(zipPath, fs.readFileSync(filePath));
	}
}

function resolveMetadataFile(configuredPath, fallbacks) {
	if (configuredPath) {
		const file = path.join(root, configuredPath);
		if (!fs.existsSync(file)) {
			throw new Error(`Missing plugin metadata file: ${configuredPath}`);
		}
		return file;
	}

	for (const fallback of fallbacks) {
		const file = path.join(root, fallback);
		if (fs.existsSync(file)) return file;
	}
	return null;
}
