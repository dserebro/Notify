"""CLI tests for the application's own ``notify`` binary.

Target: ``node app/server/dist/index.js <cmd>`` (Node 24, commander).
Origin: ``deno run ... main.ts <cmd>`` from ``app/backend`` (Denomander).
Select with ``NOTIFY_CLI_SIDE=origin|target`` (default target); the origin
checkout root can be set with ``NOTIFY_ORIGIN_ROOT``.

Review fixes exercised:
  - the ``notify`` client sends ``icon`` (schema field) and keeps a
    ``--remote`` that already ends in ``/api/notify`` verbatim;
  - VAPID keys are validated with strict ``atob`` at startup, so a
    base64url-encoded key is rejected before the server binds a port.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess

import pytest

SIDE = os.environ.get("NOTIFY_CLI_SIDE", "target")
REPO = os.path.join(os.environ.get("WORKSPACE_DIR", "/l2l/workspace"), "Notify")
ORIGIN_ROOT = os.environ.get("NOTIFY_ORIGIN_ROOT", REPO)
BASE_URL = os.environ.get("NOTIFY_BASE_URL", "http://localhost:8787").rstrip("/")
NODE_BIN = "/home/morphagent/.nvm/versions/node/v24.22.2/bin"
DENO_BIN = "/home/morphagent/.deno/bin"


def run_cli(*args: str, env_extra: dict | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if SIDE == "origin":
        env["PATH"] = f"{DENO_BIN}:{env['PATH']}"
        cmd = ["deno", "run", "--allow-net", "--allow-read", "--allow-write",
               "--allow-env", "--unstable", "main.ts", *args]
        cwd = os.path.join(ORIGIN_ROOT, "app", "backend")
    else:
        env["PATH"] = f"{NODE_BIN}:{env['PATH']}"
        cmd = ["node", "app/server/dist/index.js", *args]
        cwd = REPO
    if env_extra:
        env.update(env_extra)
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


class TestNotifyCommand:
    def test_cli_notify_with_sendkey_succeeds(self, sendkey: str) -> None:
        r = run_cli(
            "notify", "-t", "CLI functional test", "-m", "sent from cli",
            "-i", "https://example.com/icon.png",
            "-r", f"{BASE_URL}/api/notify", "-k", sendkey,
        )
        assert r.returncode == 0, f"stdout={r.stdout!r} stderr={r.stderr!r}"
        assert "Notification sent" in r.stdout

    def test_cli_notify_with_wrong_key_fails(self) -> None:
        r = run_cli(
            "notify", "-t", "CLI functional test", "-m", "wrong key",
            "-r", f"{BASE_URL}/api/notify", "-k", "definitely-not-the-sendkey",
        )
        assert r.returncode != 0
        assert "Notification sent" not in r.stdout


@pytest.mark.skipif(SIDE == "origin", reason="target-only startup validation")
class TestRunVapidValidation:
    def test_cli_run_rejects_base64url_vapid_key(self, tmp_path) -> None:
        # Take the configured (valid, standard-base64) key and re-encode the
        # same JWK as unpadded base64url — strict atob must reject it.
        valid = os.environ.get("VAPID_KEY")
        assert valid, "VAPID_KEY must be set (target lifecycle secret)"
        jwk = json.loads(base64.b64decode(valid))
        # Base64 of plain-ASCII JSON only yields '+'/'/' for bytes like '~',
        # so add an ignored JWK member carrying '~' until the standard
        # encoding contains '+' or '/'; its base64url form then carries
        # '-' / '_' characters that strict atob must reject.
        for n in range(1, 16):
            candidate = json.dumps({**jwk, "ftrun": "~" * n}).encode()
            std = base64.b64encode(candidate).decode()
            if "+" in std or "/" in std:
                break
        else:
            pytest.fail("could not build a base64url key with '-'/'_' chars")
        b64url = base64.urlsafe_b64encode(candidate).decode().rstrip("=")
        assert "-" in b64url or "_" in b64url
        r = run_cli(
            "run",
            env_extra={
                "VAPID_KEY": b64url,
                "PORT": "18999",
                "DATABASE_PATH": str(tmp_path / "notify.db"),
                "FRONTEND": "",
            },
            timeout=30,
        )
        assert r.returncode != 0, f"server accepted base64url key: {r.stdout!r} {r.stderr!r}"
        assert "vapid key is not valid base64" in (r.stdout + r.stderr).lower()
