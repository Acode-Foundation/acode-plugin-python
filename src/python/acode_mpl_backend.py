"""Matplotlib backend that renders figures with Agg and shows them as PNG
images in the Acode console. Selected with MPLBACKEND=module://acode_mpl_backend.
"""

import io

from matplotlib._pylab_helpers import Gcf
from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas

from acode_display import show_png

__all__ = ["FigureCanvas", "show"]


def show(*args, **kwargs):
    for manager in Gcf.get_all_fig_managers():
        buffer = io.BytesIO()
        manager.canvas.figure.savefig(buffer, format="png", bbox_inches="tight")
        show_png(buffer.getvalue())
    Gcf.destroy_all()
