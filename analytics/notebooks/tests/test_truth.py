import hashlib
import re
from pathlib import Path

from jassmin_ml import truth

REPO = Path(__file__).resolve().parents[3]


def test_customer_key_matches_the_warehouse_macro():
    assert truth.customer_key(42) == hashlib.md5(b"u:42").hexdigest()
    assert truth.customer_key("42") == truth.customer_key(42)
    macro = (REPO / "analytics/warehouse/macros/keys.sql").read_text(encoding="utf-8")
    assert "'u:' || ({{ user_id_column }})::text" in macro


def test_planted_segments_match_the_generator_config():
    config = (REPO / "analytics/generator/config.py").read_text(encoding="utf-8")
    block = config.split("SEGMENTS: dict[str, tuple[float, float, float]] = {", 1)[1].split("}", 1)[0]
    planted = {
        name: tuple(float(v) for v in values.split(","))
        for name, values in re.findall(r'"(\w+)": \(([^)]*)\)', block)
    }
    assert planted == truth.PLANTED
    assert list(planted) == truth.SEGMENTS
