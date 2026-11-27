#!/usr/bin/env python3
"""Generate the temporary isolated staging Worker config. Never targets live."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root/"wrangler.staging.toml").read_text()
assert 'name = "pkr-reloaded-worker-staging"' in source
assert 'database_id = "03577857-fc94-49ed-bd1b-5cd658aa0978"' in source
assert 'id = "9e86adbcfb5d4817a32dfd4482d3dbf9"' in source
assert 'PKR_ENV = "staging"' in source
assert "e21a4823-ef28-496a-9f49-fa3e04dc73bf" not in source
assert '[triggers]' not in source
flags='PKR_CLUB_PLANNING_V1 = "1"\nPKR_CLUB_EXTRAS_V1 = "1"\nPKR_FREE_FIRST_GAME_V1 = "1"\n'
source=source.split("\n[previews]")[0].replace("[vars]\n","[vars]\n"+flags,1)
assert all(source.count(flag)==1 for flag in ["PKR_CLUB_PLANNING_V1","PKR_CLUB_EXTRAS_V1","PKR_FREE_FIRST_GAME_V1"])
(root/"wrangler.club-staging.toml").write_text(source)
