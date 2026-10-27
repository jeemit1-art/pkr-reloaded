#!/usr/bin/env python3
"""Offline tests of D1 export API fallback, no HTTP or real Cloudflare data."""
import importlib.util
import io
import json
import os
import tempfile
import urllib.parse
from pathlib import Path

code=Path(__file__).with_name("deploy-settlement-v2-production.py")
spec=importlib.util.spec_from_file_location("release",code)
assert spec and spec.loader
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class FakeResp:
    def __init__(self,data):
        self.data=io.BytesIO(data)
    def __enter__(self):return self
    def __exit__(self,*args):return None
    def read(self,count=-1):return self.data.read(count)

calls=[]
def fake_urlopen(request,timeout):
    if isinstance(request,str):
        calls.append("download")
        assert request=="https://example.invalid/signed-backup?signature=not-a-secret"
        return FakeResp(b"CREATE TABLE example(id INTEGER);\n" + b"-- synthetic \n"*480)
    payload=json.loads(request.data)
    calls.append("poll")
    assert request.full_url.endswith("/export")
    assert request.get_header("Authorization")=="Bearer TEST-ONLY-SECRET"
    assert payload.get("output_format")=="polling"
    if "current_bookmark" not in payload:
        return FakeResp(json.dumps({"success":True,"result":{"type":"export","at_bookmark":"test-bookmark"}}).encode())
    assert payload["current_bookmark"]=="test-bookmark"
    return FakeResp(json.dumps({"success":True,"result":{"type":"export","status":"complete","result":{"signed_url":"https://example.invalid/signed-backup?signature=not-a-secret"}}}).encode())

prior=os.environ.get("CLOUDFLARE_API_TOKEN")
os.environ["CLOUDFLARE_API_TOKEN"]="TEST-ONLY-SECRET"
try:
    with tempfile.TemporaryDirectory(prefix="pkr-synthetic-api-") as root:
        dest=Path(root)/"d1-export.sql"
        release.export_backup_via_api(dest,open_url=fake_urlopen,sleep=lambda _seconds:None)
        assert dest.exists() and dest.stat().st_size>4000
        assert calls==["poll","poll","download"]
        assert "CREATE TABLE example" in dest.read_text()
    def reject_urlopen(request,timeout):
        return FakeResp(json.dumps({"success":False,"errors":[{"code":7003,"message":"PRIVATE_PLAYER_SECRET"}]}).encode())
    with tempfile.TemporaryDirectory(prefix="pkr-synthetic-api-") as root:
        try:
            release.export_backup_via_api(Path(root)/"not-written.sql",open_url=reject_urlopen)
        except release.Stop as exc:
            assert "7003" in str(exc)
            assert "PRIVATE_PLAYER_SECRET" not in str(exc)
        else:
            raise AssertionError("Export API error was not rejected")
finally:
    if prior is None:os.environ.pop("CLOUDFLARE_API_TOKEN",None)
    else:os.environ["CLOUDFLARE_API_TOKEN"]=prior
print("PASS: D1 API polling/full download, private-file handling and failure sanitation")
