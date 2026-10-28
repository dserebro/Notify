"""Tests for the /api/keys surface — VAPID public key + login-key gate.

Both endpoints exist on origin (Deno/Oak) and target (Node/Hono) with the
same contract.
"""

from __future__ import annotations

import re

import requests

TIMEOUT = 10
BASE64URL = re.compile(r"^[A-Za-z0-9_-]{80,}$")


class TestKeysEndpoint:
    def test_get_keys_returns_vapid_public_key(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/api/keys", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["successful"] is True
        key = body["data"]
        assert isinstance(key, str)
        assert BASE64URL.match(key), f"not base64url >=80 chars: {key!r}"


class TestKeysAuthEndpoint:
    def test_get_keys_auth_reports_login_not_required(
        self, base_url: str
    ) -> None:
        # Lifecycle sets LOGINKEY="" so this must report false.
        r = requests.get(f"{base_url}/api/keys/auth", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json() == {"successful": True, "data": False}
