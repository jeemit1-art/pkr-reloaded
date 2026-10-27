#!/usr/bin/env python3
"""Synthetic/no-network, no-secret test of public-safe settlement inventory."""
import contextlib
import importlib.util
import io
from pathlib import Path

p=Path(__file__).with_name("read-only-production-settlement-audit.py")
spec=importlib.util.spec_from_file_location("pkr_inventory",p)
assert spec and spec.loader
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
records=[
    {"status":"legacy","n":326,"cents":7523500},
    {"status":"paid","n":17,"cents":123456},
    {"status":"owed","n":3,"cents":70000},
    {"status":"PRIVATE_PLAYER","n":1,"cents":50},
]
prior=[{"action":"owner_marked_legacy_paid_without_recipient_confirmation","n":0,"cents":0}]
extra=[{"settled_games":9,"nonsettled_games":1}]
out=io.StringIO()
with contextlib.redirect_stdout(out):
    statuses=m.show_summary(records,prior,extra)
t=out.getvalue()
assert statuses["legacy"]=={"n":326,"cents":7523500}
assert statuses["other"]=={"n":1,"cents":50}
assert "PRIVATE_PLAYER" not in t and "Legacy count matches expectation: True" in t
assert "No transfers" in t
try:
    m.numeric({"n":"1"},"n")
except RuntimeError:
    pass
else:
    raise AssertionError("Expected numeric validation to fail closed")
print("PASS: synthetic grouped status inventory is read-only, accurate and redacted")
