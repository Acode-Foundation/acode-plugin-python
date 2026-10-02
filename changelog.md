# Acode Python Plugin Changelog

## 1.2.0

- Updated Pyodide to 314.0.7 (Python 3.14)
- Packages such as `numpy`, `pandas` and `micropip` are now downloaded on demand when imported
- Errors written to stderr are now shown in red
- Console output can now be selected and copied
- Fixed Python failing to load (or staying on "loading...") on some devices
- Clear error message when Python fails to load, with automatic retry on the next run
- Smaller plugin size (removed stale Pyodide files)
- Migrated build tooling to esbuild, matching the official plugin template

## 1.1.3

- Updated Pyodide library to 0.28.1

## 1.1.1

- Initial release
