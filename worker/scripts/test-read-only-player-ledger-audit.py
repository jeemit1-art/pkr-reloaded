#!/usr/bin/env python3
"""Offline-only audit test. No production credentials or network queries."""
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).with_name("read-only-player-ledger-audit.py")
spec = importlib.util.spec_from_file_location("pkr_readonly_test", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeRelease:
    def remote_query(self, sql):
        if "COUNT(*) AS n FROM game_players gp" in sql:
            return [{"n":0}]
        if "SELECT DISTINCT g.event_id AS room_id" in sql:
            return [{"room_id":"room-A"},{"room_id":"room-B"}]
        if "SELECT DISTINCT u.id FROM users u" in sql:
            return [{"id":"auth-1"}] if "room-A" in sql else [{"id":"auth-2"}]
        if "SELECT gp.game_id,gp.user_id,gp.display_name" in sql:
            if "room-A" in sql:
                return [
                    {"game_id":"g1","user_id":"auth-1","display_name":"Jeemit Shah","net":2500,"settled_at":100,"scheduled_at":99},
                    {"game_id":"g2","user_id":"auth-1","display_name":"Jeemit","net":-800,"settled_at":200,"scheduled_at":199},
                    {"game_id":"g3","user_id":"guest-1","display_name":"Jeemit","net":1300,"settled_at":300,"scheduled_at":299},
                ]
            return [
                {"game_id":"g4","user_id":"auth-2","display_name":"Prakash","net":-400,"settled_at":400,"scheduled_at":399},
                {"game_id":"g5","user_id":"guest-2","display_name":"Prakash","net":900,"settled_at":500,"scheduled_at":499},
            ]
        raise RuntimeError("Unexpected audit SQL.")


result = mod.audit_all(FakeRelease())
assert result["rooms"] == 2
assert result["settled_rows_missing_net"] == 0
assert result["settled_player_rows"] == 5
assert result["reconciled_sessions"] == 5
assert result["historical_net_cents"] == result["reconciled_net_cents"] == 3500
assert result["reconciled_players"] == 2
assert result["multi_name_player_groups"] == 1
assert result["named_example_groups"] == 1
assert result["named_example_sessions"] == 3
assert result["named_example_net_cents"] == 3000
print("PASS: production audit aggregates all rooms, preserves money, and logs no records.")

