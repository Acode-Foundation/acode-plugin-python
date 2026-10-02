# acode-plugin-python

Plugin to run python code in [Acode](https://acode.foxdebug.com) editor for android. This plugin uses [Pyodide](https://pyodide.org) project to run python in browser.

## Plugin is underdevelopment

Using this plugin you can run python codes but you cannot import other python files yet, so, this feature will be supportted in future updates.

### Update 1.0.7

- Bugs fixes
- Updated pyodide

### Update 1.1.0

- Bugs fixes
- Reduces waiting time

### Update 1.2.0

- Python 3.14 (Pyodide 314.0.7)
- Import packages like `numpy` or `pandas` directly. They are downloaded on first use (internet required)
- Install pure Python packages from PyPI with `micropip`:

```python
import micropip
await micropip.install("snowballstemmer")
```

## Development

```sh
npm install
npm run dev        # watch, serve on :3000, rebuild plugin.zip
npm run build      # bundle and write plugin.zip
npm run check      # lint and format check (Biome)
```

In Acode, install from **Plugins → + → Remote** using `http://<your-ip>:3000/plugin.zip`.

## WARNING

This is plugin might not be supported in your device. To check weather this plugin is supported in your device or not, open console declare variable using 'const' key word. If it throws a error, your device doesn't support this plugin.
