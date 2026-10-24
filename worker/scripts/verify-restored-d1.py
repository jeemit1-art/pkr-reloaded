#!/usr/bin/env python3
"""Read-only compatibility checks against an independently restored D1 SQLite copy.

This tool NEVER connects to Cloudflare or writes to the supplied database.
It does not perform an actual backup or establish that a production restore
has occurred. Run it locally on a separate restored copy, not in CI with live
financial records. Never commit/upload the supplied database or output report.
"""
import argparse
import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPECTED = HERE.parent / "staging.schema.sql"

def q(name):
    return '"' + name.replace('"', '""') + '"'

def inventory(db):
    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
        )
    }
    columns = {
        name: {row[1]: (str(row[2]).strip().upper(), row[3], row[5])
               for row in db.execute("PRAGMA table_info(" + q(name) + ")")}
        for name in sorted(tables)
    }
    indexes = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND name NOT LIKE 'sqlite_%'"
        )
    }
    return tables, columns, indexes

def aggregate(db, tables, columns, table, fields):
    if table not in tables:
        return None
    available = [name for name in fields if name in columns[table]]
    if not available:
        return None
    query = ("SELECT COUNT(*)," + ",".join(
        "COALESCE(SUM(" + q(field) + "),0)" for field in available
    ) + " FROM " + q(table))
    result = db.execute(query).fetchone()
    return {"rows": result[0],
            "totals": {field: result[index + 1]
                       for index, field in enumerate(available)}}

def assess(restored, expected_schema=EXPECTED):
    reference = sqlite3.connect(":memory:")
    reference.executescript(Path(expected_schema).read_text(encoding="utf-8"))
    expected_tables, expected_columns, expected_indexes = inventory(reference)
    reference.close()
    actual_tables, actual_columns, actual_indexes = inventory(restored)
    missing_tables = sorted(expected_tables - actual_tables)
    extra_tables = sorted(actual_tables - expected_tables)
    missing_columns = []
    incompatible_columns = []
    for table in sorted(expected_tables & actual_tables):
        for col, spec in expected_columns[table].items():
            if col not in actual_columns[table]:
                missing_columns.append(table + "." + col)
            elif actual_columns[table][col] != spec:
                incompatible_columns.append({
                    "column": table + "." + col,
                    "expected_type_notnull_pk": spec,
                    "restored_type_notnull_pk": actual_columns[table][col],
                })
    check = restored.execute("PRAGMA quick_check").fetchone()
    integrity = str(check[0]) if check else "no response"
    financial = {}
    for table, fields in (
        ("game_players", ["buy_ins", "buy_in_total", "cashout", "net"]),
        ("settlements", ["total_pot", "total_in", "total_out"]),
        ("settlement_transfers", ["amount"]),
        ("hand_results", ["pot_chips"]),
        ("tournament_rebuys", ["chips", "amount_paid"]),
    ):
        summary = aggregate(restored, actual_tables, actual_columns, table, fields)
        if summary is not None:
            financial[table] = summary
    issues = bool(missing_tables or missing_columns or
                  incompatible_columns or integrity != "ok")
    return {
        "restored_integrity_check": integrity,
        "schema_compatible": not issues,
        "missing_tables": missing_tables,
        "additional_tables_not_an_error": extra_tables,
        "missing_columns": missing_columns,
        "incompatible_columns": incompatible_columns,
        "missing_reference_indexes": sorted(expected_indexes - actual_indexes),
        "aggregate_reconciliation_baseline": financial,
        "disclaimer": ("This is a read-only local restore preflight, not proof "
                       "of a verified production backup, migration or release."),
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restore", type=Path, required=True,
                        help="Private path to an independently restored SQLite copy")
    parser.add_argument("--expected-schema", type=Path, default=EXPECTED)
    args = parser.parse_args()
    if not args.restore.is_file():
        parser.error("Restored database file does not exist")
    # SQLite read-only URI; query_only provides a second explicit guard.
    target = args.restore.resolve()
    from urllib.parse import quote
    uri = "file:" + quote(str(target)) + "?mode=ro"
    db = sqlite3.connect(uri, uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        report = assess(db, args.expected_schema)
        print(json.dumps(report, indent=2))
        return 0 if report["schema_compatible"] else 2
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
