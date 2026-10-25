#!/usr/bin/env python3
"""Validate mobile-only group membership schema with disposable synthetic SQLite."""
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:')
db.execute("PRAGMA foreign_keys=ON")
db.executescript((root/'staging.schema.sql').read_text())
db.executescript((root/'migrations/20261025_staging_rsvp_board.sql').read_text())
migration=(root/'migrations/20261025_staging_phone_members.sql').read_text()
db.executescript(migration)
db.executescript(migration)
db.execute("INSERT INTO users(id,google_sub,email,name) VALUES('u1','sub1','','Host')")
db.execute("INSERT INTO events(id,name,host_id) VALUES('e1','Group A','u1')")
db.execute("INSERT INTO events(id,name,host_id) VALUES('e2','Group B','u1')")
db.execute("INSERT INTO group_phone_contacts(id,event_id,display_name,phone_lookup,phone_cipher) VALUES(?,?,?,?,?)",
           ('c1','e1','Fictional Player','scoped-hmac-a','ENCRYPTED-CIPHERTEXT'))
db.execute("INSERT INTO group_phone_contacts(id,event_id,display_name,phone_lookup,phone_cipher) VALUES(?,?,?,?,?)",
           ('c2','e2','Different Group','scoped-hmac-b','ENCRYPTED-CIPHERTEXT'))
db.execute("INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES(?,?,?,?,?,?)",
           ('i1','e1','c1','token-digest','member',9999999999))
db.execute("INSERT INTO verified_phone_identities(phone_lookup,user_id) VALUES('verified-hmac','u1')")
assert db.execute("SELECT COUNT(*) FROM group_phone_contacts WHERE event_id='e1'").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM group_phone_contacts WHERE event_id='e2'").fetchone()[0]==1
try:
    db.execute("INSERT INTO group_phone_contacts(id,event_id,display_name,phone_lookup,phone_cipher) VALUES('c3','e1','Duplicate','scoped-hmac-a','X')")
    raise AssertionError("Duplicate number within one group was permitted")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES('i2','e2','c1','bad-cross-group','member',9999999999)")
    raise AssertionError("An invitation was allowed to point to a contact in another group")
except sqlite3.IntegrityError:
    pass
db.execute("DELETE FROM events WHERE id='e1'")
assert db.execute("SELECT COUNT(*) FROM group_phone_contacts WHERE event_id='e1'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM group_phone_invites WHERE event_id='e1'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM group_phone_contacts WHERE event_id='e2'").fetchone()[0]==1
print('PASS private mobile migration is idempotent, scoped, encrypted fields present, and group cascade safe')
