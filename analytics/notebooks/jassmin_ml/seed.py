"""The one seed every #133 notebook uses."""

from __future__ import annotations

import random

import numpy as np

SEED = 133


def set_seeds(seed: int = SEED) -> np.random.Generator:
    """Seed Python's and NumPy's global generators and return a fresh ``Generator``.

    Libraries with their own seeds (LightGBM, scikit-learn, implicit, PyMC) get ``SEED`` passed
    explicitly in the notebooks.
    """
    random.seed(seed)
    np.random.seed(seed)  # noqa: NPY002 - for libraries that still read the legacy global state
    return np.random.default_rng(seed)
