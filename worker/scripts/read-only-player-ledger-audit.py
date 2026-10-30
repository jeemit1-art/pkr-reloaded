#!/usr/bin/env python3
"""Read-only production-wide player ledger verification after Worker deployment.

Queries saved settled-game player amounts; no mutations, identifiers, access
tokens, phone numbers or individual game rows are logged.
"""
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOM_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def get_release():
    script = ROOT / "scripts" / "deploy-settlement-v2-production.py"
    spec = importlib.util.spec_from_file_location("pkr_readonly_release", script)
    if not spec or not spec.loader:
        raise RuntimeError("Production audit utilities unavailable.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def audit_all(release):
    rooms = release.remote_query(
        "SELECT DISTINCT g.event_id AS room_id FROM games g "
        "JOIN game_players gp ON gp.game_id=g.id "
        "WHERE g.status='settled' AND gp.net IS NOT NULL"
    )
    missing = release.remote_query(
        "SELECT COUNT(*) AS n FROM game_players gp "
        "JOIN games g ON g.id=gp.game_id "
        "WHERE g.status='settled' AND gp.net IS NULL"
    )
    if len(missing) != 1:
        raise RuntimeError("Cannot verify missing settled-game amounts.")
    totals = {
        "settled_rows_missing_net": int(missing[0]["n"]),
        "rooms": 0, "settled_player_rows": 0,
        "historical_net_cents": 0, "reconciled_net_cents": 0,
        "reconciled_sessions": 0, "reconciled_players": 0,
        "multi_name_player_groups": 0, "ambiguous_name_groups": 0,
        "named_example_groups": 0, "named_example_sessions": 0,
        "named_example_net_cents": 0, "named_example_profitable": 0,
    }
    mapping = {
        "source_rows": "settled_player_rows",
        "source_net": "historical_net_cents",
        "ranked_net": "reconciled_net_cents",
        "ranked_sessions": "reconciled_sessions",
        "ranked_rows": "reconciled_players",
        "multi_name_players": "multi_name_player_groups",
        "ambiguous_name_groups": "ambiguous_name_groups",
        "named_example_groups": "named_example_groups",
        "named_example_sessions": "named_example_sessions",
        "named_example_net_cents": "named_example_net_cents",
        "named_example_profitable": "named_example_profitable",
    }
    for room in rooms:
        room_id = room.get("room_id")
        if not isinstance(room_id, str) or not ROOM_ID.fullmatch(room_id):
            raise RuntimeError("Unexpected private room identifier.")
        rows = release.remote_query(
            "SELECT gp.game_id,gp.user_id,gp.display_name,gp.net,"
            "gp.settled_at,g.scheduled_at FROM game_players gp "
            "JOIN games g ON g.id=gp.game_id WHERE g.event_id='"
            + room_id + "' AND g.status='settled' AND gp.net IS NOT NULL "
            "ORDER BY g.scheduled_at,gp.game_id,gp.user_id"
        )
        users = release.remote_query(
            "SELECT DISTINCT u.id FROM users u "
            "JOIN game_players gp ON gp.user_id=u.id "
            "JOIN games g ON g.id=gp.game_id WHERE g.event_id='"
            + room_id + "' AND g.status='settled'"
        )
        # Only private stdin carries names/IDs; subprocess stdout is aggregated.
        result = subprocess.run(
            ["node", "scripts/offline-ledger-audit.cjs"], cwd=ROOT,
            input=json.dumps({"rows": rows, "verified": [u["id"] for u in users]}),
            text=True, capture_output=True, timeout=45,
        )
        if result.returncode != 0:
            raise RuntimeError("Source totals could not be reconciled.")
        try:
            metrics = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise RuntimeError("Private audit returned invalid metrics.") from None
        if (metrics["source_rows"] != metrics["ranked_sessions"] or
                metrics["source_net"] != metrics["ranked_net"]):
            raise RuntimeError("Saved and reconciled totals do not agree.")
        totals["rooms"] += 1
        for source, destination in mapping.items():
            totals[destination] += int(metrics[source])
    if (totals["settled_player_rows"] != totals["reconciled_sessions"] or
            totals["historical_net_cents"] != totals["reconciled_net_cents"]):
        raise RuntimeError("Production player totals failed the audit.")
    return totals


def main():
    release = get_release()
    release.verify_target()
    totals = audit_all(release)
    print("PKR READ-ONLY PRODUCTION PLAYER AUDIT")
    print(json.dumps(totals, sort_keys=True))
    print("PASS: every settled player result reconciles; no records were changed.")


if __name__ == "__main__":
    main()

