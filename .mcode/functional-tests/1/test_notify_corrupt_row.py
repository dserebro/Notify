"""POST /api/notify must tolerate a corrupt device row in SQLite.

Review fix: ``SqliteRepository.listAll()`` skips and logs rows whose
``push_data`` cannot be parsed instead of throwing, so the notify fan-out
no longer 500s because of one bad row. Target-only: the origin stored
devices in Deno KV (no SQLite rows to corrupt).

The fixture writes a namespaced corrupt row (``ftrun_corrupt_...``)
straight into the target's SQLite file and deletes it on teardown.
"""

from __future__ import annotations

import os
import sqlite3
import time
import uuid
from typing import Iterator

import pytest
import requests

TIMEOUT = 15
DB_PATH = os.environ.get(
    "NOTIFY_DB_PATH",
    os.path.join(os.environ.get("WORKSPACE_DIR", "/l2l/workspace"), "Notify", "data", "notify.db"),
)


@pytest.fixture
def corrupt_device_row() -> Iterator[str]:
    if not os.path.exists(DB_PATH):
        pytest.fail(f"SQLite database not found at {DB_PATH}")
    row_id = f"ftrun_corrupt_{uuid.uuid4().hex[:12]}"
    now = int(time.time() * 1000)
    con = sqlite3.connect(DB_PATH, timeout=10)
    try:
        con.execute(
            "INSERT INTO devices (id, secret, push_data, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (row_id, "ftrun-secret", "{not valid json", now, now),
        )
        con.commit()
        yield row_id
    finally:
        con.execute("DELETE FROM devices WHERE id = ?", (row_id,))
        con.commit()
        con.close()


class TestNotifyCorruptRow:
    def test_post_notify_skips_corrupt_device_row(
        self, base_url: str, sendkey: str, corrupt_device_row: str
    ) -> None:
        r = requests.post(
            f"{base_url}/api/notify",
            json={"title": "Corrupt row", "message": "fan-out must skip bad rows"},
            headers={"Authorization": f"Bearer {sendkey}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"successful": True, "data": {"message": "notified"}}
        assert r.headers.get("cache-control") == "no-cache"
