"""Shows images from Python code in the Acode console.

Installed into site-packages by the plugin. ``show_image`` is provided by the
plugin as the ``_acode`` JS module and receives base64 encoded PNG data plus
the scale it was rendered at.
"""

import base64
import io
import os
import sys

from _acode import show_image

_pil_ready = False

# device pixel ratio of the console, figures are rendered at this scale
scale = 1.0


def show_png(data, image_scale=1.0):
    show_image(base64.b64encode(data).decode("ascii"), image_scale)


def prepare(code, width=0, pixel_ratio=1):
    """Called before running ``code``, after its packages are loaded.

    ``width`` is the console width in CSS pixels, ``pixel_ratio`` the
    device pixel ratio.
    """
    from pyodide.code import find_imports

    global scale
    scale = max(1.0, min(float(pixel_ratio or 1), 3.0))
    if width:
        _fit_figures(width)

    if "PIL" in find_imports(code):
        setup_pil()


def _fit_figures(width):
    """Default matplotlib figures to the console width, so their text stays
    readable on a phone instead of a 6.4in figure being shrunk to fit.

    Written as the matplotlibrc read when matplotlib is first imported (also
    when imported indirectly, e.g. by pandas), so settings changed later by
    the program are left alone.
    """
    if "matplotlib" in sys.modules:
        return
    rc_file = os.environ.get("MATPLOTLIBRC")
    if not rc_file:
        return
    inches = max(3.0, min(width / 100, 6.4))
    with open(rc_file, "w") as rc:
        rc.write(f"figure.figsize: {inches:.2f}, {inches * 0.75:.2f}\n")
        rc.write("figure.dpi: 100\n")


def setup_pil():
    """Make ``Image.show()`` display the image in the console."""
    global _pil_ready
    if _pil_ready:
        return

    from PIL import ImageShow

    class AcodeViewer(ImageShow.Viewer):
        format = "PNG"

        def show_image(self, image, **options):
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            show_png(buffer.getvalue())
            return 1

    ImageShow.register(AcodeViewer(), 0)
    _pil_ready = True


def flush_figures():
    """Show matplotlib figures the code created but never showed."""
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is not None and pyplot.get_fignums():
        pyplot.show()
