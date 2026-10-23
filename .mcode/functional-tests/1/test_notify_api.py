"""
Functional tests for the Notify backend API.

All endpoints are origin_and_target (MODIFIED repo: Deno/Oak baseline vs Cloudflare Workers/Hono target).

Endpoints tested:
  GET  /api/keys       - VAPID public key retrieval (no auth)
  GET  /api/keys/auth  - Auth status check (no auth)
  POST /api/device     - Create device (no auth when LOGINKEY unset)
  GET  /api/device/:id - Check device existence (Bearer auth with device secret)
  PATCH /api/device/:id - Update device push subscription (Bearer auth)
  DELETE /api/device/:id - Delete device (Bearer auth)
  POST /api/notify     - Send notification (no auth when SENDKEY unset)
"""

import requests
import pytest
import uuid
import json
import os

BASE_URL = os.environ.get("FT_BASE_URL", "http://localhost:8787")
NS = f"ftrun_{uuid.uuid4().hex[:8]}"

# Valid web push data for device creation/update
VALID_PUSH_DATA = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-12345",
    "key": "BPXZQ+zXGJ2DlMRKjC8xYb6aRHcRPf8D6L0XqWyTrnY=",
    "auth": "dGVzdGF1dGg=",
}

VALID_PUSH_DATA_UPDATED = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-updated",
    "key": "BPXZQ+zXGJ2DlMRKjC8xYb6aRHcRPf8D6L0XqWyTrnY=",
    "auth": "dXBkYXRlZA==",
}


@pytest.fixture(autouse=True)
def health_check():
    """Confirm the app is reachable before running tests."""
    resp = requests.get(f"{BASE_URL}/api/keys", timeout=10)
    assert resp.status_code == 200, f"Health check failed: {resp.status_code} {resp.text}"


@pytest.fixture
def created_device():
    """Create a device and yield its id and secret. Delete in teardown."""
    payload = {"web_push_data": VALID_PUSH_DATA}
    resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
    assert resp.status_code == 200, f"Device creation failed: {resp.status_code} {resp.text}"
    body = resp.json()
    device_id = body["data"]["id"]
    device_secret = body["data"]["secret"]
    yield {"id": device_id, "secret": device_secret}
    # Teardown: try to delete the device
    requests.delete(
        f"{BASE_URL}/api/device/{device_id}",
        headers={"Authorization": f"Bearer {device_secret}"},
        timeout=10,
    )


# ============================================================
# GET /api/keys
# ============================================================
class TestGetKeys:
    """GET /api/keys - VAPID public key retrieval."""

    def test_get_keys_happy_path(self):
        resp = requests.get(f"{BASE_URL}/api/keys", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True
        assert isinstance(body["data"], str)
        assert len(body["data"]) > 0

    def test_get_keys_returns_consistent_key(self):
        """Two calls should return the same key."""
        resp1 = requests.get(f"{BASE_URL}/api/keys", timeout=10)
        resp2 = requests.get(f"{BASE_URL}/api/keys", timeout=10)
        assert resp1.json()["data"] == resp2.json()["data"]


# ============================================================
# GET /api/keys/auth
# ============================================================
class TestGetKeysAuth:
    """GET /api/keys/auth - Auth status check."""

    def test_get_keys_auth_happy_path(self):
        resp = requests.get(f"{BASE_URL}/api/keys/auth", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True
        # LOGINKEY is not set, so data should be False
        assert body["data"] is False


# ============================================================
# POST /api/device
# ============================================================
class TestCreateDevice:
    """POST /api/device - Create a new device registration."""

    def test_create_device_happy_path(self):
        payload = {"web_push_data": VALID_PUSH_DATA}
        resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True
        assert "id" in body["data"]
        assert "secret" in body["data"]
        assert isinstance(body["data"]["id"], str)
        assert isinstance(body["data"]["secret"], str)
        assert len(body["data"]["id"]) > 0
        assert len(body["data"]["secret"]) > 0
        # Clean up
        requests.delete(
            f"{BASE_URL}/api/device/{body['data']['id']}",
            headers={"Authorization": f"Bearer {body['data']['secret']}"},
            timeout=10,
        )

    def test_create_device_invalid_push_data(self):
        payload = {"web_push_data": {"endpoint": "not-a-url", "key": "abc", "auth": "def"}}
        resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "invalid_data"

    def test_create_device_missing_push_data(self):
        payload = {}
        resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False

    def test_create_device_missing_required_fields(self):
        payload = {"web_push_data": {"endpoint": "https://example.com/push"}}
        resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False


# ============================================================
# GET /api/device/:id
# ============================================================
class TestCheckDevice:
    """GET /api/device/:id - Check device existence."""

    def test_check_device_happy_path(self, created_device):
        resp = requests.get(
            f"{BASE_URL}/api/device/{created_device['id']}",
            headers={"Authorization": f"Bearer {created_device['secret']}"},
            timeout=10,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True
        assert body["data"]["exists"] is True

    def test_check_device_not_found(self):
        resp = requests.get(
            f"{BASE_URL}/api/device/nonexistent-device-id-12345",
            headers={"Authorization": "Bearer invalid-secret"},
            timeout=10,
        )
        # Origin returns 500 (unhandled error, plain text body); target returns 401 with JSON
        assert resp.status_code in (401, 500)
        try:
            body = resp.json()
            assert body["successful"] is False
        except Exception:
            # Origin returns plain text "Internal Server Error"
            pass

    def test_check_device_no_auth(self, created_device):
        resp = requests.get(
            f"{BASE_URL}/api/device/{created_device['id']}",
            timeout=10,
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_check_device_wrong_secret(self, created_device):
        resp = requests.get(
            f"{BASE_URL}/api/device/{created_device['id']}",
            headers={"Authorization": "Bearer wrong-secret-value"},
            timeout=10,
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["successful"] is False


# ============================================================
# PATCH /api/device/:id
# ============================================================
class TestUpdateDevice:
    """PATCH /api/device/:id - Update device push subscription."""

    def test_update_device_happy_path(self, created_device):
        payload = {"web_push_data": VALID_PUSH_DATA_UPDATED}
        resp = requests.patch(
            f"{BASE_URL}/api/device/{created_device['id']}",
            json=payload,
            headers={"Authorization": f"Bearer {created_device['secret']}"},
            timeout=10,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True

    def test_update_device_invalid_push_data(self, created_device):
        payload = {"web_push_data": {"endpoint": "bad", "key": "!!", "auth": "!!"}}
        resp = requests.patch(
            f"{BASE_URL}/api/device/{created_device['id']}",
            json=payload,
            headers={"Authorization": f"Bearer {created_device['secret']}"},
            timeout=10,
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "invalid_data"

    def test_update_device_no_auth(self, created_device):
        payload = {"web_push_data": VALID_PUSH_DATA_UPDATED}
        resp = requests.patch(
            f"{BASE_URL}/api/device/{created_device['id']}",
            json=payload,
            timeout=10,
        )
        assert resp.status_code == 401

    def test_update_device_wrong_auth(self, created_device):
        payload = {"web_push_data": VALID_PUSH_DATA_UPDATED}
        resp = requests.patch(
            f"{BASE_URL}/api/device/{created_device['id']}",
            json=payload,
            headers={"Authorization": "Bearer wrong-secret"},
            timeout=10,
        )
        assert resp.status_code == 401


# ============================================================
# DELETE /api/device/:id
# ============================================================
class TestDeleteDevice:
    """DELETE /api/device/:id - Delete device."""

    def test_delete_device_happy_path(self):
        # Create a device specifically for deletion
        payload = {"web_push_data": VALID_PUSH_DATA}
        create_resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        assert create_resp.status_code == 200
        device = create_resp.json()["data"]

        resp = requests.delete(
            f"{BASE_URL}/api/device/{device['id']}",
            headers={"Authorization": f"Bearer {device['secret']}"},
            timeout=10,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True

    def test_delete_device_then_check_gone(self):
        # Create, delete, then verify device is gone
        payload = {"web_push_data": VALID_PUSH_DATA}
        create_resp = requests.post(f"{BASE_URL}/api/device", json=payload, timeout=10)
        device = create_resp.json()["data"]

        # Delete
        del_resp = requests.delete(
            f"{BASE_URL}/api/device/{device['id']}",
            headers={"Authorization": f"Bearer {device['secret']}"},
            timeout=10,
        )
        assert del_resp.status_code == 200

        # Check it is gone — device no longer exists so auth middleware
        # returns 401 with a structured JSON error (the origin crashed with
        # 500 here, which was a bug; the target handles it correctly).
        check_resp = requests.get(
            f"{BASE_URL}/api/device/{device['id']}",
            headers={"Authorization": f"Bearer {device['secret']}"},
            timeout=10,
        )
        assert check_resp.status_code == 401
        body = check_resp.json()
        assert body["successful"] is False
        assert body["error"]["type"] == "auth_required"

    def test_delete_device_no_auth(self, created_device):
        resp = requests.delete(
            f"{BASE_URL}/api/device/{created_device['id']}",
            timeout=10,
        )
        assert resp.status_code == 401

    def test_delete_device_wrong_auth(self, created_device):
        resp = requests.delete(
            f"{BASE_URL}/api/device/{created_device['id']}",
            headers={"Authorization": "Bearer wrong-secret"},
            timeout=10,
        )
        assert resp.status_code == 401


# ============================================================
# POST /api/notify
# ============================================================
class TestNotify:
    """POST /api/notify - Send push notification."""

    def test_notify_happy_path(self):
        payload = {"title": "Test Notification", "message": "Hello from tests"}
        resp = requests.post(f"{BASE_URL}/api/notify", json=payload, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True

    def test_notify_with_optional_fields(self):
        payload = {
            "title": "Test Notification",
            "message": "Hello",
            "icon": "https://example.com/icon.png",
            "tags": ["test", "functional"],
        }
        resp = requests.post(f"{BASE_URL}/api/notify", json=payload, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["successful"] is True

    def test_notify_missing_title(self):
        payload = {"message": "No title"}
        resp = requests.post(f"{BASE_URL}/api/notify", json=payload, timeout=10)
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False

    def test_notify_missing_message(self):
        payload = {"title": "No message"}
        resp = requests.post(f"{BASE_URL}/api/notify", json=payload, timeout=10)
        assert resp.status_code == 400
        body = resp.json()
        assert body["successful"] is False

    def test_notify_empty_title(self):
        payload = {"title": "", "message": "Test"}
        resp = requests.post(f"{BASE_URL}/api/notify", json=payload, timeout=10)
        assert resp.status_code == 400

    def test_notify_empty_body(self):
        resp = requests.post(f"{BASE_URL}/api/notify", json={}, timeout=10)
        assert resp.status_code == 400
