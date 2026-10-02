"""Shows images from Python code in the Acode console.

Installed into site-packages by the plugin. ``show_image`` is provided by the
plugin as the ``_acode`` JS module and receives base64 encoded PNG data.
"""

import base64
import io
import sys

from _acode import show_image

_pil_ready = False


def show_png(data):
    show_image(base64.b64encode(data).decode("ascii"))


def prepare(code):
    """Called before running ``code``, after its packages are loaded."""
    from pyodide.code import find_imports

    if "PIL" in find_imports(code):
        setup_pil()


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
