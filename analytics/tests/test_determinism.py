from conftest import END, START

import frames
from generate import generate


def test_same_seed_gives_identical_output():
    a = generate(150, 200, START, END, 3)
    b = generate(150, 200, START, END, 3)
    assert a.raw == b.raw
    assert a.clean_inventory == b.clean_inventory
    assert a.clean_variants == b.clean_variants


def test_another_seed_gives_other_output():
    a = generate(150, 200, START, END, 3)
    c = generate(150, 200, START, END, 4)
    assert frames.digest(a.raw) != frames.digest(c.raw)
