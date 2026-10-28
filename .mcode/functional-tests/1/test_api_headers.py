"""Every JSON /api/* envelope must carry ``Cache-Control: no-cache``.

The origin (Oak ``util/oakreturn.ts``) set this header on every JSON
envelope. The review fix moved it from per-route literals to a single
``/api/*`` middleware — success (200), validation (400) and auth (401)
envelopes must all still carry it.
"""

from __future__ import annotations

import requests

TIMEOUT = 10


class TestApiNoCacheHeader:
    def test_api_success_envelope_sets_no_cache(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/api/keys", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["successful"] is True
        assert "application/json" in r.headers.get("content-type", "")
        assert r.headers.get("cache-control") == "no-cache"

    def test_api_400_envelope_sets_no_cache(self, base_url: str) -> None:
        r = requests.post(
            f"{base_url}/api/device",
            json={"web_push_data": {"endpoint": "not-a-url", "key": "x", "auth": "y"}},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400
        assert r.json()["error"]["type"] == "invalid_data"
        assert r.headers.get("cache-control") == "no-cache"

    def test_api_401_envelope_sets_no_cache(self, base_url: str) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={"title": "x", "message": "y"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401
        assert r.json()["error"]["type"] == "auth_required"
        assert r.headers.get("cache-control") == "no-cache"
