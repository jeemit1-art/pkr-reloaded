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
    foreign_keys = {
        name: sorted((row[2], row[3], row[4], row[5], row[6], row[7])
                     for row in db.execute("PRAGMA foreign_key_list(" + q(name) + ")"))
        for name in sorted(tables)
    }
    return tables, columns, indexes, foreign_keys

def unique_constraints(db, tables):
    """Inspect enforced UNIQUE keys including implicit constraint indexes."""
    result = {}
    for table in sorted(tables):
        signatures = set()
        for entry in db.execute("PRAGMA index_list(" + q(table) + ")"):
            if not entry[2]:
                continue
            key = tuple(
                (str(part[2]), bool(part[3]), str(part[4] or "BINARY").upper())
                for part in db.execute("PRAGMA index_xinfo(" + q(entry[1]) + ")")
                if part[5]
            )
            signatures.add((key, bool(entry[4])))
        result[table] = signatures
    return result

def unique_label(table, item):
    key, partial = item
    columns = [
        name + (" DESC" if descending else "") +
        (" COLLATE " + collation if collation != "BINARY" else "")
        for name, descending, collation in key
    ]
    return table + "(" + ",".join(columns) + ")" + (" [partial]" if partial else "")

def triggers(db):
    return {
        name: " ".join((sql or "").lower().split())
        for name, sql in db.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger'"
        )
    }

def compare_financial_baseline(actual, prior_report):
    if not isinstance(prior_report, dict) or prior_report.get("schema_compatible") is not True:
        return ["baseline.invalid_or_incompatible"]
    previous = prior_report.get("aggregate_reconciliation_baseline")
    if not isinstance(previous, dict) or not previous:
        return ["baseline.missing_aggregates"]
    mismatches = []
    for table in sorted(set(actual) | set(previous)):
        if table not in actual or table not in previous:
            mismatches.append(table + ".missing_in_one_report")
            continue
        if actual[table].get("rows") != previous[table].get("rows"):
            mismatches.append(table + ".rows")
        a, b = actual[table].get("totals"), previous[table].get("totals")
        if not isinstance(a, dict) or not isinstance(b, dict):
            mismatches.append(table + ".invalid_totals")
            continue
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b or a[key] != b[key]:
                mismatches.append(table + ".totals." + key)
    return mismatches

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

def assess(restored, expected_schema=EXPECTED, require_integrity_upgrade=False,
           baseline_report=None):
    reference = sqlite3.connect(":memory:")
    reference.executescript(Path(expected_schema).read_text(encoding="utf-8"))
    if require_integrity_upgrade:
        migration = HERE.parent / "migrations" / "20261024_staging_integrity.sql"
        reference.executescript(migration.read_text(encoding="utf-8"))
    expected_tables, expected_columns, expected_indexes, expected_fks = inventory(reference)
    expected_unique = unique_constraints(reference, expected_tables)
    expected_triggers = triggers(reference)
    reference.close()
    actual_tables, actual_columns, actual_indexes, actual_fks = inventory(restored)
    actual_unique = unique_constraints(restored, actual_tables)
    actual_triggers = triggers(restored)
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
    incompatible_foreign_keys = sorted(
        table for table in expected_tables & actual_tables
        if expected_fks[table] != actual_fks[table]
    )
    missing_unique_constraints = sorted(
        unique_label(table, signature)
        for table in expected_tables & actual_tables
        for signature in expected_unique[table] - actual_unique[table]
    )
    missing_required_triggers = sorted(set(expected_triggers) - set(actual_triggers))
    incompatible_triggers = sorted(
        name for name in set(expected_triggers) & set(actual_triggers)
        if expected_triggers[name] != actual_triggers[name]
    )
    check = restored.execute("PRAGMA quick_check").fetchone()
    integrity = str(check[0]) if check else "no response"
    # quick_check does NOT validate foreign-key references. Check them
    # separately, reporting only table-level counts (never customer row IDs).
    foreign_key_violations = {}
    foreign_key_check_error = None
    try:
        for table, _rowid, _parent, _fkid in restored.execute("PRAGMA foreign_key_check"):
            foreign_key_violations[table] = foreign_key_violations.get(table, 0) + 1
    except sqlite3.DatabaseError:
        # A malformed or missing referenced table may prevent the PRAGMA
        # completing; that is a blocker, not an assumption of zero orphans.
        foreign_key_check_error = "Foreign-key verification could not complete"
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
    schema_issues = bool(missing_tables or missing_columns or
                         incompatible_columns or incompatible_foreign_keys or
                         missing_unique_constraints or missing_required_triggers or
                         incompatible_triggers or integrity != "ok" or
                         foreign_key_violations or foreign_key_check_error)
    baseline_differences = (compare_financial_baseline(financial, baseline_report)
                            if baseline_report is not None else [])
    release_ok = not schema_issues and not baseline_differences
    return {
        "restored_integrity_check": integrity,
        "foreign_key_violations_by_table": dict(sorted(foreign_key_violations.items())),
        "foreign_key_violation_count": sum(foreign_key_violations.values()),
        "foreign_key_check_error": foreign_key_check_error,
        "schema_compatible": not schema_issues,
        "require_integrity_upgrade": require_integrity_upgrade,
        "missing_tables": missing_tables,
        "additional_tables_not_an_error": extra_tables,
        "missing_columns": missing_columns,
        "incompatible_columns": incompatible_columns,
        "incompatible_foreign_keys": incompatible_foreign_keys,
        "missing_unique_constraints": missing_unique_constraints,
        "missing_required_triggers": missing_required_triggers,
        "incompatible_triggers": incompatible_triggers,
        "missing_reference_indexes": sorted(expected_indexes - actual_indexes),
        "aggregate_reconciliation_baseline": financial,
        "baseline_report_compared": baseline_report is not None,
        "baseline_reconciliation_ok": (not baseline_differences
                                       if baseline_report is not None else None),
        "baseline_reconciliation_mismatches": baseline_differences,
        "preflight_passed": release_ok,
        "disclaimer": ("Read-only local preflight; a supplied baseline is "
                       "not authenticated evidence of Cloudflare source data, "
                       "a successful migration, or a production release."),
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restore", type=Path, required=True,
                        help="Private path to an independently restored SQLite copy")
    parser.add_argument("--expected-schema", type=Path, default=EXPECTED)
    parser.add_argument("--require-integrity-upgrade", action="store_true",
                        help="Require staging-only integrity tables and audit triggers")
    parser.add_argument("--baseline-report", type=Path,
                        help="Private JSON summary from independent local source export")
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
        baseline = (json.loads(args.baseline_report.read_text(encoding="utf-8"))
                    if args.baseline_report else None)
        report = assess(db, args.expected_schema,
                        require_integrity_upgrade=args.require_integrity_upgrade,
                        baseline_report=baseline)
        print(json.dumps(report, indent=2))
        return 0 if report["preflight_passed"] else 2
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
