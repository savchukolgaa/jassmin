"""One chart style for every notebook, and the README's figures (#133)."""

from __future__ import annotations

from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.figure import Figure

FIGURES = Path(__file__).resolve().parents[1] / "figures"

#: Validated categorical palette (colour-blind safe), in series order.
PALETTE = ["#2a6f97", "#e07a5f", "#3d405b", "#81b29a", "#f2cc8f", "#9c6644", "#6d597a", "#b56576"]
ACCENT = PALETTE[0]
MUTED = "#9aa0a6"


def use_style() -> None:
    """Set the shared matplotlib style: quiet axes, one accent colour, readable sizes."""
    mpl.rcParams.update(
        {
            "figure.figsize": (8, 4.5),
            "figure.dpi": 110,
            "savefig.dpi": 150,
            "savefig.bbox": "tight",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.color": "#e6e6e6",
            "grid.linewidth": 0.8,
            "axes.axisbelow": True,
            "axes.titlesize": 12,
            "axes.titleweight": "semibold",
            "axes.titlelocation": "left",
            "axes.labelsize": 10,
            "axes.prop_cycle": mpl.cycler(color=PALETTE),
            "legend.frameon": False,
            "font.size": 10,
        }
    )


def save_figure(fig: Figure, name: str) -> Path:
    """Save ``fig`` as ``figures/<name>.png`` for the README and return the path."""
    FIGURES.mkdir(parents=True, exist_ok=True)
    path = FIGURES / f"{name}.png"
    # No "Software" metadata (it names the matplotlib version), so re-runs give the same file.
    fig.savefig(path, metadata={"Software": None})
    return path


def close(fig: Figure) -> None:
    plt.close(fig)
