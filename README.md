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

### Plots and images

`matplotlib` figures are shown in the console when you call `plt.show()`, and any figures left open are shown when the program ends. Pillow's `Image.show()` works too.

### pygame (experimental)

pygame programs can draw to a canvas in the console using Pyodide's [SDL support](https://pyodide.org/en/stable/usage/sdl.html). The game loop must be async so the app stays responsive:

```python
import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((320, 240))

async def main():
    while True:
        screen.fill((30, 30, 60))
        pygame.display.flip()
        await asyncio.sleep(1 / 60)

await main()
```

If SDL cannot start, the program runs without a display. Running again or closing the console stops the game.

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
