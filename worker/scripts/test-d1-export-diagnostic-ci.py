#!/usr/bin/env python3
"""Offline regression: D1 export failures must never print raw provider data."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("deploy-settlement-v2-production.py")
spec = importlib.util.spec_from_file_location("pkr_release", path)
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

def check(message, expected):
    result = release.safe_export_error_class(message)
    assert result == expected, (result, expected)
    assert "PRIVATE_PLAYER" not in result
    assert "Bearer " not in result

check("export FTS5 virtual table PRIVATE_PLAYER",
      "D1 virtual tables are unsupported by full export")
check("API error: 7500 with Bearer PRIVATE_PLAYER",
      "Cloudflare API code 7500")
check("403 forbidden PRIVATE_PLAYER",
      "Cloudflare D1 export authorisation/permission failure")
check("request timed out PRIVATE_PLAYER",
      "Cloudflare export timeout")
check("unknown error with player PRIVATE_PLAYER",
      "unknown provider error (no private data logged)")
print("PASS: Cloudflare D1 export diagnostics are classified without exposing provider output")
