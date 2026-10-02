# Python for Acode

Run Python 3.14 in the [Acode](https://acode.app) editor on Android. Python runs on your device through [Pyodide](https://pyodide.org), so no server or Termux setup is needed.

## Features

- **Run Python files**: open a `.py` file and tap the run button in the header
- **Interactive console**: type Python after your program finishes; `input()` works too
- **Python packages**: `import numpy`, `pandas`, `matplotlib` and many more are downloaded automatically the first time you use them
- **Install from PyPI** with `micropip`
- **Plots and images**: `matplotlib` figures and Pillow images are shown right in the console
- **pygame (experimental)**: games draw to a canvas in the console
- **Copy output**: console text can be selected and copied
- **Line wrap**: toggle wrapping of long output lines from the header button
- **Progress indicator**: a thin line under the header shows while Python is loading or your code is running

## Usage

Open a Python file and tap the run button. The console shows your program's output, errors in red, and a prompt for `input()`.

After the program finishes, you can keep typing Python in the console. Use the up and down arrows to browse previous commands and `Ctrl+L` to clear the console.

### Packages

Packages built for Pyodide (numpy, pandas, scipy, matplotlib, Pillow and [many more](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)) load automatically when imported. They are downloaded the first time, so an internet connection is needed then.

Pure Python packages from PyPI can be installed with `micropip`:

```python
import micropip
await micropip.install("snowballstemmer")

import snowballstemmer
print(snowballstemmer.stemmer("english").stemWords(["running", "jumps"]))
```

### Plots and images

`plt.show()` displays matplotlib figures in the console, and any figures still open are shown when the program ends. Figures default to the width of the console and are rendered sharp on high-density screens. Pillow's `Image.show()` works too.

```python
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2 * np.pi, 200)
plt.plot(x, np.sin(x), label="sin(x)")
plt.legend()
plt.show()
```

### pygame (experimental)

pygame programs draw to a canvas in the console using Pyodide's [SDL support](https://pyodide.org/en/stable/usage/sdl.html). Ordinary game loops work as written:

```python
import pygame

pygame.init()
screen = pygame.display.set_mode((1280, 720))
clock = pygame.time.Clock()
running = True

while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False

    screen.fill("purple")
    pygame.display.flip()
    clock.tick(60)

pygame.quit()
```

- Blocking loops like this need Android System WebView 137 or newer (JSPI support). On older WebViews, make the loop async with `await asyncio.sleep(0)` each frame.
- Running again or closing the console stops the game.
- If SDL cannot start, the program runs without a display and the console explains why.

## Limitations

- Only the open file runs; importing your other `.py` files is not supported yet.
- Code runs in the browser sandbox: no access to device files outside Python's in-memory file system, and no `subprocess` or threads.
- Packages with native code must be [built for Pyodide](https://pyodide.org/en/stable/usage/packages-in-pyodide.html); others cannot be installed with `micropip`.
- Requires a recent Android System WebView.

## Development

```sh
npm install
npm run dev        # watch, serve on :3000, rebuild plugin.zip
npm run build      # bundle and write plugin.zip
npm run check      # lint and format check (Biome)
```

In Acode, install from **Plugins → + → Remote** using `http://<your-ip>:3000/plugin.zip`.

See [changelog.md](changelog.md) for release notes.
