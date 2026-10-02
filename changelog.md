# Acode Python Plugin Changelog

## 1.2.0

- Updated Pyodide to 314.0.7 (Python 3.14)
- Packages such as `numpy`, `pandas` and `micropip` are now downloaded on demand when imported
- Errors written to stderr are now shown in red
- Console output can now be selected and copied
- Header button to toggle line wrap in the console (remembered between sessions)
- Thin progress line under the console header while Python loads or code is running
- matplotlib plots are shown in the console (`plt.show()`, or automatically at the end of a run), as are Pillow `Image.show()` images. Plots are sized to the console and rendered sharp on high-density screens
- Experimental SDL support: pygame programs draw to a canvas in the console, including ordinary blocking game loops on WebViews with JSPI. Falls back to running without a display if SDL cannot start
- Python crashes no longer leave the console stuck; Python restarts on the next run
- Fixed Python failing to load (or staying on "loading...") on some devices
- Clear error message when Python fails to load, with automatic retry on the next run
- Smaller plugin size (removed stale Pyodide files)
- Migrated build tooling to esbuild, matching the official plugin template

## 1.1.3

- Updated Pyodide library to 0.28.1

## 1.1.1

- Initial release
