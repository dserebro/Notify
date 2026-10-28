"""Tests for GET /api/health — new liveness probe added by this milestone.

Legacy (Deno/Oak) backend had no /api/health; readiness was signalled by
GET /api/keys returning a VAPID public key. So this endpoint is
target_only.
"""

from __future__ import annotations

import requests

TIMEOUT = 10


class TestHealthEndpoint:
    def test_get_health_returns_ok(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "ok"}

    def test_get_health_sets_json_content_type(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "")

    def test_get_health_no_auth_required(self, base_url: str) -> None:
        # Pass a bogus Authorization header; endpoint must still answer 200.
        r = requests.get(
            f"{base_url}/api/health",
            headers={"Authorization": "Bearer definitely-not-valid"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
