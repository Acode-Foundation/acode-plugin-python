# Acode Python Plugin Changelog

## 1.2.0

### New

- Python 3.14: updated Pyodide from 0.28.1 to 314.0.7
- Packages such as `numpy`, `pandas`, `matplotlib` and `micropip` are downloaded automatically when imported (internet needed on first use)
- matplotlib plots are shown in the console, on `plt.show()` or automatically when the program ends. Plots are sized to the console and rendered sharp on high-density screens
- Pillow's `Image.show()` displays images in the console
- Experimental pygame support: games draw to a canvas in the console, including ordinary blocking game loops on WebViews with JSPI (Android System WebView 137+). If SDL cannot start, the program runs without a display and the reason is shown
- Header button to toggle line wrap in the console (remembered between sessions)
- Thin progress line under the console header while Python is loading or code is running

### Improved

- Console output can be selected and copied
- Errors written to stderr are shown in red
- Clear error message when Python fails to load, with an automatic retry on the next run
- If Python crashes, the console no longer gets stuck; Python restarts on the next run
- Smaller plugin download (removed stale Pyodide files)

### Fixed

- Python failing to load on some devices (`importScripts ... failed to load` followed by `Cannot read properties of undefined (reading 'loadPackagesFromImports')`)
- Python staying on "loading..." forever when the device serves `.wasm` files with the wrong type
- pygame failing with `Failed to connect to localhost/127.0.0.1:443` when another plugin replaces `fetch`

### Development

- Build tooling migrated from webpack, Babel, PostCSS and Sass to esbuild, matching the [official plugin template](https://github.com/Acode-Foundation/acode-plugin)
- The Pyodide runtime is installed from npm and copied into the build, so a clean checkout builds a working plugin

## 1.1.4

- New run icon

## 1.1.3

- Updated Pyodide library to 0.28.1

## 1.1.1

- Initial release
