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

    # All expected columns can exist while a relationship has been silently
    # dropped during a schema rebuild. That must also fail the release gate.
    unconstrained = Path(tmp) / "missing_foreign_key.sqlite"
    original_schema = SCHEMA.read_text(encoding="utf-8")
    relation = "CREATE TABLE game_players (\n  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,"
    replacement = "CREATE TABLE game_players (\n  game_id TEXT NOT NULL,"
    assert original_schema.count(relation) == 1
    db = sqlite3.connect(unconstrained)
    db.executescript(original_schema.replace(relation, replacement, 1))
    db.close()
    missing_fk = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(unconstrained)],
        capture_output=True, text=True, check=False,
    )
    assert missing_fk.returncode == 2, missing_fk.stderr + missing_fk.stdout
    foreign_key_report = json.loads(missing_fk.stdout)
    assert foreign_key_report["schema_compatible"] is False
    assert foreign_key_report["missing_columns"] == []
    assert foreign_key_report["foreign_key_violation_count"] == 0
    assert foreign_key_report["incompatible_foreign_keys"] == ["game_players"]

    # An accidentally dropped UNIQUE key must fail even with a valid schema
    # inventory and an otherwise clean integrity check.
    source_schema = SCHEMA.read_text(encoding="utf-8")
    key_sql = "  created_at INTEGER NOT NULL DEFAULT (unixepoch()),\n  UNIQUE(game_id,hand_no)\n"
    assert source_schema.count(key_sql) == 1
    no_unique = Path(tmp) / "missing_unique_hand_number.sqlite"
    db = sqlite3.connect(no_unique)
    db.executescript(source_schema.replace(
        key_sql, "  created_at INTEGER NOT NULL DEFAULT (unixepoch())\n", 1
    ))
    db.close()
    failure = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(no_unique)],
        capture_output=True, text=True, check=False,
    )
    assert failure.returncode == 2, failure.stdout + failure.stderr
    assert "hands(game_id,hand_no)" in json.loads(failure.stdout)["missing_unique_constraints"]

    # Optional staging safeguards are a hard gate until migrated in the
    # selected isolated database, including its audit triggers.
    not_migrated = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(expected),
         "--require-integrity-upgrade"],
        capture_output=True, text=True, check=False,
    )
    assert not_migrated.returncode == 2, not_migrated.stdout
    assert "game_financial_audit" in json.loads(not_migrated.stdout)["missing_tables"]
    upgraded = Path(tmp) / "synthetic_migrated_staging.sqlite"
    db = sqlite3.connect(upgraded)
    db.executescript(source_schema)
    db.executescript(
        (ROOT / "migrations" / "20261024_staging_integrity.sql")
        .read_text(encoding="utf-8")
    )
    db.close()
    good = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(upgraded),
         "--require-integrity-upgrade"],
        capture_output=True, text=True, check=False,
    )
    assert good.returncode == 0, good.stdout + good.stderr
    db = sqlite3.connect(upgraded)
    db.execute("DROP TRIGGER trg_pkr_player_revision_delete")
    db.close()
    lost_trigger = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(upgraded),
         "--require-integrity-upgrade"],
        capture_output=True, text=True, check=False,
    )
    assert lost_trigger.returncode == 2, lost_trigger.stdout
    assert "trg_pkr_player_revision_delete" in json.loads(
        lost_trigger.stdout
    )["missing_required_triggers"]

    # A one-cent financial change must fail a source-versus-restore
    # comparison even if both databases pass SQLite integrity checks.
    import shutil
    source = Path(tmp) / "fictional_source.sqlite"
    db = sqlite3.connect(source)
    db.executescript(source_schema)
    db.execute("INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
               ("u", "fictional-sub", "user@example.invalid", "Fictional"))
    db.execute("INSERT INTO events(id,name,host_id) VALUES(?,?,?)",
               ("e", "Fictional Event", "u"))
    db.execute("INSERT INTO games(id,event_id,scheduled_at) VALUES(?,?,?)",
               ("g", "e", 1))
    db.execute(
        "INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total,cashout,net) "
        "VALUES(?,?,?,?,?,?,?)", ("g", "u", "Fictional", 1, 1000, 800, -200)
    )
    db.commit()
    db.close()
    baseline_run = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(source)],
        capture_output=True, text=True, check=False,
    )
    assert baseline_run.returncode == 0, baseline_run.stdout
    baseline = Path(tmp) / "source_summary.json"
    baseline.write_text(baseline_run.stdout, encoding="utf-8")
    restored = Path(tmp) / "restored_financial_copy.sqlite"
    shutil.copyfile(source, restored)
    matched = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(restored),
         "--baseline-report", str(baseline)],
        capture_output=True, text=True, check=False,
    )
    assert matched.returncode == 0, matched.stdout
    assert json.loads(matched.stdout)["baseline_reconciliation_ok"] is True
    db = sqlite3.connect(restored)
    db.execute("UPDATE game_players SET buy_in_total = buy_in_total + 1")
    db.commit()
    db.close()
    changed = subprocess.run(
        [sys.executable, str(CHECK), "--restore", str(restored),
         "--baseline-report", str(baseline)],
        capture_output=True, text=True, check=False,
    )
    assert changed.returncode == 2, changed.stdout
    result = json.loads(changed.stdout)
    assert result["schema_compatible"] is True
    assert result["preflight_passed"] is False
    assert result["baseline_reconciliation_mismatches"] == [
        "game_players.totals.buy_in_total"
    ]
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
print("PASS: read-only restore preflight rejects missing schema, lost foreign keys and orphaned records")
