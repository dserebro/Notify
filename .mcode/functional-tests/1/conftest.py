"""Pytest fixtures for Notify backend functional tests.

The target lifecycle runs the Hono server on http://localhost:$PORT. These
fixtures:
  - resolve the base URL from NOTIFY_BASE_URL (defaults to port 8787);
  - verify the server is healthy before any test runs;
  - supply a disposable push-data factory and a ``registered_device``
    fixture that creates + tears down a real device via the public API.

Every created device uses a push endpoint on a closed port
(``http://127.0.0.1:9/...``) so no real push delivery can ever happen.
"""

from __future__ import annotations

import base64
import os
import secrets
import time
import uuid
from typing import Iterator

import pytest
import requests


BASE_URL = os.environ.get("NOTIFY_BASE_URL", "http://localhost:8787").rstrip("/")
SENDKEY = os.environ.get("NOTIFY_SENDKEY") or os.environ.get("SENDKEY")
REQUEST_TIMEOUT = 15


def _b64(n: int) -> str:
    return base64.b64encode(secrets.token_bytes(n)).decode("ascii")


def make_push_data(tag: str | None = None) -> dict:
    """Return a well-formed ``web_push_data`` payload with a dead endpoint."""
    label = tag or uuid.uuid4().hex[:8]
    return {
        "web_push_data": {
            "endpoint": f"http://127.0.0.1:9/ftrun/{label}",
            "key": _b64(65),
            "auth": _b64(16),
        }
    }


@pytest.fixture(scope="session", autouse=True)
def _wait_for_server() -> None:
    """Fail-fast health probe. Keeps every test from timing out when the
    server never came up — one clear failure instead of twenty cryptic ones.
    """
    deadline = time.time() + 30
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{BASE_URL}/api/health", timeout=5)
            if r.status_code == 200 and r.json().get("status") == "ok":
                return
            # The origin (Deno/Oak) has no /api/health; its readiness
            # signal is GET /api/keys serving the VAPID public key.
            k = requests.get(f"{BASE_URL}/api/keys", timeout=5)
            if k.status_code == 200 and k.json().get("successful") is True:
                return
            last_err = AssertionError(
                f"/api/health returned {r.status_code} body={r.text!r}"
            )
        except Exception as exc:
            last_err = exc
        time.sleep(1)
    raise RuntimeError(
        f"Notify server at {BASE_URL} never became healthy: {last_err!r}"
    )


@pytest.fixture
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def sendkey() -> str:
    assert SENDKEY, "SENDKEY must be set in the environment"
    return SENDKEY


@pytest.fixture
def push_data() -> dict:
    """Fresh ``web_push_data`` payload — unique endpoint per call."""
    return make_push_data()


@pytest.fixture
def registered_device(base_url: str) -> Iterator[dict]:
    """Create a device via POST /api/device and tear it down after the test.

    Yields ``{"id": "<32 hex>", "secret": "<32 hex>"}``. If the test deletes
    the device itself (as the DELETE lifecycle test does), teardown
    tolerates the follow-up 401/404.
    """
    body = make_push_data("setup")
    r = requests.post(
        f"{base_url}/api/device",
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    assert r.status_code == 200, f"device setup failed: {r.status_code} {r.text}"
    payload = r.json()["data"]
    device_id = payload["id"]
    secret = payload["secret"]
    try:
        yield {"id": device_id, "secret": secret}
    finally:
        try:
            requests.delete(
                f"{base_url}/api/device/{device_id}",
                headers={"Authorization": f"Bearer {secret}"},
                timeout=REQUEST_TIMEOUT,
            )
        except Exception:
            pass
