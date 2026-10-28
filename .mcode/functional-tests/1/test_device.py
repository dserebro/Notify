"""Tests for the /api/device entity lifecycle.

Covers the device create/read/update/delete flows plus the two
decision-13 defect fixes called out in MILESTONE.md:
  1. GET/PATCH/DELETE for an unknown device id → 401 with the standard
     ``auth_required`` envelope (origin returned 500 ``Internal Server
     Error`` plain text — the "not found" exception escaped the auth
     middleware).
  2. A successful PATCH preserves the existing device secret (origin
     stored the raw ``Authorization: Bearer <secret>`` header as the new
     secret, which locked the caller out).
"""

from __future__ import annotations

import re

import pytest
import requests

from conftest import make_push_data

TIMEOUT = 15
HEX32 = re.compile(r"^[0-9a-f]{32}$")
UNKNOWN_ID = "f" * 32  # 32-char hex that is extremely unlikely to exist


class TestDeviceRegister:
    def test_post_device_registers_and_returns_id_secret(
        self, base_url: str, push_data: dict
    ) -> None:
        r = requests.post(
            f"{base_url}/api/device",
            json=push_data,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["successful"] is True
        data = body["data"]
        assert HEX32.match(data["id"]), f"id not 32 hex: {data['id']!r}"
        assert HEX32.match(data["secret"]), f"secret not 32 hex: {data['secret']!r}"
        # Clean up — the fixture-based registered_device isn't used here
        # because we want to exercise the raw register path.
        requests.delete(
            f"{base_url}/api/device/{data['id']}",
            headers={"Authorization": f"Bearer {data['secret']}"},
            timeout=TIMEOUT,
        )

    def test_post_device_rejects_invalid_web_push_data(
        self, base_url: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/device",
            json={
                "web_push_data": {
                    "endpoint": "not-a-url",
                    "key": "x",
                    "auth": "y",
                }
            },
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "invalid_data"


class TestDeviceGet:
    def test_get_device_with_bearer_secret_returns_exists_true(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.get(
            f"{base_url}/api/device/{registered_device['id']}",
            headers={"Authorization": f"Bearer {registered_device['secret']}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"successful": True, "data": {"exists": True}}

    def test_get_device_without_auth_is_rejected(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.get(
            f"{base_url}/api/device/{registered_device['id']}",
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_get_device_with_wrong_secret_is_rejected(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.get(
            f"{base_url}/api/device/{registered_device['id']}",
            headers={"Authorization": "Bearer wrong-secret-" + "0" * 20},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_get_device_unknown_id_returns_401_envelope(
        self, base_url: str
    ) -> None:
        """Decision-13 fix: origin returned 500 ``Internal Server Error``
        (plain text, no JSON envelope). The target must now return 401
        with the standard ``auth_required`` envelope.
        """
        r = requests.get(
            f"{base_url}/api/device/{UNKNOWN_ID}",
            headers={"Authorization": "Bearer any-token-for-missing-dev-01"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, (
            f"expected 401, got {r.status_code} body={r.text!r}"
        )
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"


class TestDevicePatch:
    def test_patch_device_without_auth_is_rejected(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.patch(
            f"{base_url}/api/device/{registered_device['id']}",
            json=make_push_data("patch-noauth"),
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        assert r.json()["error"]["type"] == "auth_required"

    def test_patch_device_validates_web_push_data(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.patch(
            f"{base_url}/api/device/{registered_device['id']}",
            json={
                "web_push_data": {
                    "endpoint": "bad",
                    "key": "x",
                    "auth": "y",
                }
            },
            headers={
                "Authorization": f"Bearer {registered_device['secret']}",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, r.text
        assert r.json()["error"]["type"] == "invalid_data"

    def test_patch_device_unknown_id_returns_401_envelope(
        self, base_url: str
    ) -> None:
        """Decision-13 fix: origin returned 500 plain text."""
        r = requests.patch(
            f"{base_url}/api/device/{UNKNOWN_ID}",
            json=make_push_data("patch-unknown"),
            headers={
                "Authorization": "Bearer any-token-for-missing-dev-02",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_patch_device_success_preserves_secret(
        self, base_url: str, registered_device: dict
    ) -> None:
        """Decision-13 fix: origin stored the raw ``Authorization`` header
        value as the new secret, which locked the caller out. The target
        must leave the existing secret untouched so the same bearer keeps
        working after a successful PATCH.
        """
        device_id = registered_device["id"]
        original_secret = registered_device["secret"]

        # Perform a valid PATCH.
        patch_resp = requests.patch(
            f"{base_url}/api/device/{device_id}",
            json=make_push_data("patch-success"),
            headers={
                "Authorization": f"Bearer {original_secret}",
                "Content-Type": "application/json",
            },
            timeout=TIMEOUT,
        )
        assert patch_resp.status_code == 200, patch_resp.text
        assert patch_resp.json() == {"successful": True, "data": True}

        # The ORIGINAL secret must still authenticate GET.
        probe = requests.get(
            f"{base_url}/api/device/{device_id}",
            headers={"Authorization": f"Bearer {original_secret}"},
            timeout=TIMEOUT,
        )
        assert probe.status_code == 200, (
            "PATCH must not rotate the device secret (decision-13 fix); "
            f"GET with original secret returned {probe.status_code} {probe.text!r}"
        )
        assert probe.json() == {"successful": True, "data": {"exists": True}}


class TestDeviceDelete:
    def test_delete_device_with_wrong_secret_is_rejected(
        self, base_url: str, registered_device: dict
    ) -> None:
        r = requests.delete(
            f"{base_url}/api/device/{registered_device['id']}",
            headers={"Authorization": "Bearer wrong-secret-" + "0" * 20},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        assert r.json()["error"]["type"] == "auth_required"

    def test_delete_device_unknown_id_returns_401_envelope(
        self, base_url: str
    ) -> None:
        """Decision-13 fix: origin returned 500 plain text."""
        r = requests.delete(
            f"{base_url}/api/device/{UNKNOWN_ID}",
            headers={"Authorization": "Bearer any-token-for-missing-dev-03"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_delete_device_with_bearer_secret_succeeds(
        self, base_url: str
    ) -> None:
        # Register our own device so this test can delete it fully.
        reg = requests.post(
            f"{base_url}/api/device",
            json=make_push_data("delete-success"),
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert reg.status_code == 200, reg.text
        device = reg.json()["data"]

        resp = requests.delete(
            f"{base_url}/api/device/{device['id']}",
            headers={"Authorization": f"Bearer {device['secret']}"},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"successful": True, "data": True}

        # After deletion the device must no longer authenticate — on the
        # target this is a 401 envelope (not a 500, which is the whole
        # point of the decision-13 fix).
        after = requests.get(
            f"{base_url}/api/device/{device['id']}",
            headers={"Authorization": f"Bearer {device['secret']}"},
            timeout=TIMEOUT,
        )
        assert after.status_code == 401, after.text
        assert after.json()["error"]["type"] == "auth_required"
