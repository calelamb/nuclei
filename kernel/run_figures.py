"""Figure capture for user programs (audit R-12, design note section 2.11).

``MPLBACKEND=Agg`` is set before the worker imports matplotlib, so ``plt.show()`` can never block
or open a window.  After an editor run the open figures are rendered to PNG and shipped to the
Output panel instead of being lost.
"""

from __future__ import annotations

import base64
import io
import sys

MAX_FIGURES = 8
DPI = 100
FALLBACK_DPI = 60
MAX_FIGURE_BYTES = int(1.5 * 1024 * 1024)
MAX_TOTAL_BYTES = 6 * 1024 * 1024


def _render(figure, dpi: int) -> bytes:
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight")
    return buffer.getvalue()


def _title(figure, number: int) -> str:
    suptitle = getattr(figure, "_suptitle", None)
    if suptitle is not None and suptitle.get_text():
        return suptitle.get_text()
    for axes in figure.axes:
        text = axes.get_title()
        if text:
            return text
    return f"Figure {number}"


def render_open_figures() -> tuple[list[dict], int]:
    """``(figures, dropped)``: at most 8 PNGs within a 6 MiB budget; the rest are counted, not sent."""
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return [], 0
    figures: list[dict] = []
    total = 0
    dropped = 0
    numbers = pyplot.get_fignums()
    for index, number in enumerate(numbers):
        if index >= MAX_FIGURES:
            dropped += 1
            continue
        figure = pyplot.figure(number)
        try:
            png = _render(figure, DPI)
            if len(png) > MAX_FIGURE_BYTES:
                png = _render(figure, FALLBACK_DPI)
        except Exception:  # noqa: BLE001 - one unrenderable figure must not lose the run
            dropped += 1
            continue
        if total + len(png) > MAX_TOTAL_BYTES:
            dropped += 1
            continue
        total += len(png)
        figures.append({"png_base64": base64.b64encode(png).decode("ascii"), "title": _title(figure, number)})
    return figures, dropped
