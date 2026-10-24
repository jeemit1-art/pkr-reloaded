#!/usr/bin/env python3
"""Verify the staging-only SQL schema in an in-memory SQLite database.

Never connects to Cloudflare or production. No external packages required.
"""
from pathlib import Path
import sqlite3

SCHEMA = Path(__file__).resolve().parents[1] / "staging.schema.sql"

REQUIRED = {
    "users": ["id", "google_sub", "plan", "trial_started_at", "plan_expires_at",
              "stripe_customer_id", "stripe_subscription_id"],
    "events": ["id", "host_id", "status", "master_password", "buy_in"],
    "event_members": ["event_id", "user_id", "role"],
    "event_players": ["event_id", "display_name", "user_id", "games_played"],
    "games": ["id", "event_id", "status", "live_token", "results_token",
              "variance", "current_hand_no", "current_dealer_seat",
              "hand_tracking", "chip_value", "starting_chips", "seat_draw_result",
              "live_cards_enabled"],
    "game_rsvps": ["game_id", "display_name", "status"],
    "game_players": ["game_id", "user_id", "display_name", "buy_ins", "buy_in_total",
                     "cashout", "net", "settled_at", "created_at"],
    "push_subscriptions": ["event_id", "display_name", "endpoint"],
    "settlements": ["game_id", "idempotency_key", "payload_json"],
    "settlement_transfers": ["game_id", "from_user", "to_user", "from_name",
                              "to_name", "status", "paid_at", "last_reminded_at",
                              "reminder_count"],
    "paid_carryover": ["game_id", "from_user", "to_user", "paid_at"],
    "leaderboard": ["event_id", "user_id", "total_net", "games_played"],
    "hands": ["id", "game_id", "hand_no", "dealer_seat", "sb_seat", "bb_seat",
              "board", "mode", "voided", "pot_chips"],
    "hand_actions": ["id", "hand_id", "game_id", "street", "action", "chips", "created_at"],
    "hand_results": ["id", "game_id", "hand_id", "winner_name", "hole_cards", "split_pot"],
    "hand_analyses": ["id", "game_id", "player_name", "analysis_type"],
    "tournament_state": ["game_id", "status", "buy_in_amount", "current_level",
                          "starting_chips", "level_started_at", "paused_elapsed"],
    "tournament_levels": ["game_id", "level_num", "duration_secs", "is_break"],
    "tournament_rebuys": ["game_id", "player_name", "amount_paid", "chips"],
    "tournament_eliminations": ["game_id", "player_name", "finishing_position"],
}
def main():
    schema = SCHEMA.read_text(encoding="utf-8")
    assert "DROP TABLE" not in schema.upper()
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(schema)
    for table, columns in REQUIRED.items():
        actual = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
        assert set(columns) <= actual, f"{table}: missing {sorted(set(columns) - actual)}"
    conn.execute("INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)",
                 ("u1", "google_test_1", "example.invalid", "Test host"))
    conn.execute("INSERT INTO events(id,name,host_id,buy_in) VALUES(?,?,?,?)",
                 ("e1", "Synthetic game", "u1", 2000))
    conn.execute("INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)",
                 ("e1", "u1", "host"))
    conn.execute("INSERT INTO games(id,event_id,scheduled_at,live_token) VALUES(?,?,?,?)",
                 ("g1", "e1", 1234567890, "fake-staging-token"))
    conn.execute("INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total) VALUES(?,?,?,?,?) ON CONFLICT(game_id,display_name) DO UPDATE SET buy_ins=excluded.buy_ins",
                 ("g1","p1","Guest",2,4000))
    conn.execute("INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total) VALUES(?,?,?,?,?) ON CONFLICT(game_id,display_name) DO UPDATE SET buy_ins=excluded.buy_ins",
                 ("g1","p1","Guest",3,6000))
    assert conn.execute("SELECT buy_ins FROM game_players WHERE game_id='g1'").fetchone()[0] == 3
    conn.execute("INSERT INTO hands(id,game_id,hand_no,board) VALUES(?,?,?,?)",
                 ("h1","g1",1,"[]"))
    conn.execute("INSERT INTO hand_actions(id,hand_id,game_id,display_name,street,action,chips) VALUES(?,?,?,?,?,?,?)",
                 ("a1","h1","g1","Guest","pre","call",100))
    assert conn.execute("SELECT COUNT(*) FROM hand_actions WHERE game_id='g1'").fetchone()[0] == 1
    conn.execute("INSERT INTO hand_results(id,hand_id,game_id,winner_name,pot_chips) VALUES(?,?,?,?,?)",
                 ("r1","h1","g1","Guest",100))
    conn.execute("INSERT INTO tournament_state(game_id,status,current_level,starting_chips,buy_in_amount,rebuy_allowed,rebuy_levels,addon_allowed,addon_chips,payout_structure,total_chips_in_play) VALUES(?,?,?,?,?,?,?,?,?,?,0)",
                 ("g1","setup",1,10000,2000,1,4,0,0,"[]"))
    conn.execute("INSERT INTO tournament_levels(id,game_id,level_num,small_blind,big_blind) VALUES(?,?,?,?,?)",
                 ("l1","g1",1,50,100))
    conn.execute("INSERT INTO tournament_rebuys(id,game_id,player_name,type,chips,amount_paid) VALUES(?,?,?,?,?,?)",
                 ("rb1","g1","Guest","rebuy",10000,2000))
    conn.execute("INSERT INTO tournament_eliminations(id,game_id,player_name,finishing_position) VALUES(?,?,?,?) ON CONFLICT(game_id,player_name) DO UPDATE SET finishing_position=excluded.finishing_position",
                 ("el1","g1","Guest",2))
    conn.execute("INSERT INTO paid_carryover(game_id,from_user,to_user,amount) VALUES(?,?,?,?)",
                 ("g1","p1","p2",100))
    conn.execute("INSERT INTO settlements(id,game_id,idempotency_key,payload_json) VALUES(?,?,?,?)",
                 ("s1","g1","test-key","{}"))
    conn.execute("INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount,from_name,to_name,status) VALUES(?,?,?,?,?,?,?,?)",
                 ("tr1","g1","p1","p2",100,"Guest","Recipient","owed"))
    conn.execute("INSERT INTO hand_analyses(id,game_id,analysis_type,analysis) VALUES(?,?,?,?)",
                 ("an1","g1","game","Test analysis"))
    conn.execute("DELETE FROM games WHERE id='g1'")
    for table in ["game_players", "hands", "hand_actions", "hand_results",
                  "tournament_state", "tournament_levels", "tournament_rebuys",
                  "tournament_eliminations", "settlements", "settlement_transfers",
                  "paid_carryover", "hand_analyses"]:
        assert conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0, f"Orphan rows: {table}"
    print(f"PASS: {len(REQUIRED)} tables, expected fields, writes and cascading cleanup.")
    print("PASS: in-memory synthetic tests; no remote database accessed.")
if __name__ == "__main__":
    main()
