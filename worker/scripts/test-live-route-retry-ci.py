#!/usr/bin/env python3
"""Offline tests of live Worker release route readiness, no HTTP or credentials."""
import importlib.util
import json
from pathlib import Path

path=Path(__file__).with_name("deploy-settlement-v2-production.py")
spec=importlib.util.spec_from_file_location("pkr_v2_release_probe",path)
assert spec and spec.loader
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
old=release.command

try:
    responses=iter(["404","404","401"])
    def delayed(*args,**kwargs):
        if args[-1].endswith("/health"):
            return json.dumps({"release":"settlement-v2-github-20261028","environment":"production","features":{"settlement_v2":True}})
        return next(responses)
    release.command=delayed
    release.check_api_route(attempts=3,delay_seconds=0)

    release.command=lambda *args,**kwargs:"404"
    try:
        release.check_api_route(attempts=2,delay_seconds=0)
    except release.Stop as exc:
        assert "HTTP 404" in str(exc)
    else:
        raise AssertionError("Persistent 404 was incorrectly accepted")

    def wrong_release(*args,**kwargs):
        if args[-1].endswith("/health"):
            return json.dumps({"release":"old","environment":"production","features":{"settlement_v2":True}})
        return "401"
    release.command=wrong_release
    try:
        release.check_api_route(attempts=2,delay_seconds=0)
    except release.Stop:
        pass
    else:
        raise AssertionError("Stale Worker release was incorrectly accepted")
finally:
    release.command=old
print("PASS: asynchronous Cloudflare route readiness and strict fail-closed guards")
