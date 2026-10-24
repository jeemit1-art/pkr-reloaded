#!/usr/bin/env python3
"""Compile literal D1 SQL statements against the isolated staging schema.

This uses only an in-memory SQLite database and never reaches Cloudflare.
Dynamically constructed statements are identified but cannot be compiled.
"""
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "staging.schema.sql"
SRC = ROOT / "src"

PREPARE_START = re.compile(r"\.prepare\(\s*(['\"\x60])")
SQL_START = re.compile(r"^\s*(?:SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b", re.IGNORECASE)


def extract_literal(source, position, quote):
    chars = []
    i = position
    while i < len(source):
        current = source[i]
        if current == "\\" and i + 1 < len(source):
            nxt = source[i + 1]
            if nxt == "n":
                chars.append("\n")
            elif nxt == "r":
                chars.append("\r")
            elif nxt == "t":
                chars.append("\t")
            else:
                chars.append(nxt)
            i += 2
            continue
        if current == quote:
            return "".join(chars)
        chars.append(current)
        i += 1
    raise AssertionError("Unterminated SQL string")


def main():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(SCHEMA.read_text(encoding="utf-8"))
    checked = 0
    dynamic = []
    problems = []
    for path in sorted(SRC.rglob("*.ts")):
        if path.name.endswith(".bak.ts") or path.name.endswith(".test.ts"):
            continue
        source = path.read_text(encoding="utf-8")
        for match in PREPARE_START.finditer(source):
            query = extract_literal(source, match.end(), match.group(1))
            line = source.count("\n", 0, match.start()) + 1
            location = f"{path.relative_to(ROOT)}:{line}"
            if not SQL_START.match(query):
                continue
            if "$" + "{" in query:
                dynamic.append(location)
                continue
            try:
                connection.execute("EXPLAIN " + query, [None] * query.count("?"))
                checked += 1
            except sqlite3.Error as exc:
                problems.append((location, str(exc), query[:140].replace("\n", " ")))
    print(f"Audited {checked} literal SQL statements against staging schema (in-memory only).")
    for item in dynamic:
        print(f"SKIPPED dynamic SQL: {item}")
    for location, error, sql in problems:
        print(f"FAIL {location}: {error}; SQL: {sql}")
    assert checked >= 100, f"Unexpectedly low SQL coverage: {checked}"
    assert not problems, f"{len(problems)} SQL statements do not compile against staging schema."
    print("PASS: static D1 SQL statements compile; no remote database accessed.")


if __name__ == "__main__":
    main()
