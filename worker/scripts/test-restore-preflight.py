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
    assert report["foreign_key_violation_count"] == 0
    assert report["foreign_key_violations_by_table"] == {}
    # An otherwise valid schema and quick_check=ok is not sufficient.
    # Ensure orphaned financial/player records stop a restored-db release.
    orphan = Path(tmp) / "orphaned_financial_copy.sqlite"
    db = sqlite3.connect(orphan)
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    db.execute(
        "INSERT INTO game_players(game_id,user_id,display_name,buy_ins) "
        "VALUES(?,?,?,?)", ("nonexistent-game", "fictional-user", "Fictional", 1)
    )
    db.commit()
    db.close()
    broken = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(orphan)],
        capture_output=True, text=True, check=False,
    )
    assert broken.returncode == 2, broken.stderr + broken.stdout
    broken_report = json.loads(broken.stdout)
    assert broken_report["restored_integrity_check"] == "ok"
    assert broken_report["schema_compatible"] is False
    assert broken_report["foreign_key_violation_count"] == 1
    assert broken_report["foreign_key_violations_by_table"] == {"game_players": 1}

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
print("PASS: read-only restored-copy verifier rejects missing schema and orphaned foreign keys")
