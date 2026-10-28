"""Tests for POST /api/notify — the fan-out webhook.

SENDKEY-gated. Validates body shape and enforces the 2048-byte payload
limit. All of this behavior exists on origin (Oak/Deno) and target
(Hono/Node); the only intentional change is that per-device delivery
errors are now logged server-side instead of surfacing in the response
(decision-13 — tested indirectly: the API response envelope is
unaffected).
"""

from __future__ import annotations

import json

import requests

TIMEOUT = 15


class TestNotifyAuth:
    def test_post_notify_without_bearer_is_rejected(
        self, base_url: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={"title": "Smoke", "message": "no bearer"},
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_post_notify_with_wrong_bearer_is_rejected(
        self, base_url: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={"title": "Smoke", "message": "wrong bearer"},
            headers={
                "Authorization": "Bearer definitely-not-the-sendkey",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"


class TestNotifyValidation:
    def test_post_notify_rejects_empty_title(
        self, base_url: str, sendkey: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={"title": "", "message": "x"},
            headers={
                "Authorization": f"Bearer {sendkey}",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "invalid_data"

    def test_post_notify_rejects_payload_over_2kb(
        self, base_url: str, sendkey: str
    ) -> None:
        long_text = "a" * 1000
        long_tag = "b" * 200
        payload = {
            "title": long_text,
            "message": long_text,
            "tags": [long_tag],
        }
        serialized = json.dumps(payload)
        assert len(serialized) > 2048, (
            f"test precondition broken: payload is {len(serialized)} bytes"
        )
        r = requests.post(
            f"{base_url}/api/notify",
            json=payload,
            headers={
                "Authorization": f"Bearer {sendkey}",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "invalid_data"
        assert body["error"]["message"] == "data too long"


class TestNotifyHappyPath:
    def test_post_notify_with_sendkey_succeeds(
        self, base_url: str, sendkey: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={
                "title": "Functional test",
                "message": "pytest notify success",
                "tags": ["ft"],
            },
            headers={
                "Authorization": f"Bearer {sendkey}",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {
            "successful": True,
            "data": {"message": "notified"},
        }
