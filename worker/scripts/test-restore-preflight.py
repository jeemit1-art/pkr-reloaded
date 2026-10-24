#!/usr/bin/env python3
"""Synthetic read-only regression test; no Cloudflare credentials or data."""
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK = ROOT / "scripts" / "verify-restored-d1.py"
SCHEMA = ROOT / "staging.schema.sql"

with tempfile.TemporaryDirectory() as tmp:
    expected = Path(tmp) / "restored_copy.sqlite"
    db = sqlite3.connect(expected)
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    db.close()
    successful = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(expected)],
        capture_output=True, text=True, check=False,
    )
    assert successful.returncode == 0, successful.stderr + successful.stdout
    report = json.loads(successful.stdout)
    assert report["schema_compatible"] is True
    assert report["missing_tables"] == []
    assert report["aggregate_reconciliation_baseline"]["game_players"]["rows"] == 0
    bad = Path(tmp) / "incomplete_copy.sqlite"
    db = sqlite3.connect(bad)
    db.execute("CREATE TABLE game_players(id TEXT)")
    db.close()
    failed = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(bad)],
        capture_output=True, text=True, check=False,
    )
    assert failed.returncode == 2, failed.stderr + failed.stdout
    problems = json.loads(failed.stdout)
    assert problems["schema_compatible"] is False
    assert "hands" in problems["missing_tables"]
    assert "game_players.user_id" in problems["missing_columns"]
print("PASS: restored-copy verifier is read-only and fails closed on missing schema")
