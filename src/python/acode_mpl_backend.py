"""Matplotlib backend that renders figures with Agg and shows them as PNG
images in the Acode console. Selected with MPLBACKEND=module://acode_mpl_backend.
"""

import io

from matplotlib._pylab_helpers import Gcf
from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas

import acode_display

__all__ = ["FigureCanvas", "show"]


def show(*args, **kwargs):
    scale = acode_display.scale
    for manager in Gcf.get_all_fig_managers():
        figure = manager.canvas.figure
        buffer = io.BytesIO()
        # render at the device pixel ratio so plots stay sharp on HiDPI screens
        figure.savefig(
            buffer, format="png", bbox_inches="tight", dpi=figure.dpi * scale
        )
        acode_display.show_png(buffer.getvalue(), scale)
    Gcf.destroy_all()
