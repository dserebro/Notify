"""Static frontend serving tests (PWA manifest, service worker, assets).

Review fixes covered here:
  - The PWA manifest is served at ``/manifest.json`` again (the origin
    URL); the Vite ``/manifest.webmanifest`` path was dropped.
  - Only Vite-fingerprinted ``/assets/<name>-<8charhash>.<ext>`` files get
    ``public, max-age=31536000, immutable``; stable-URL public files under
    ``/assets/`` (icons, fonts, screenshots) get ``no-cache``.
  - ``/sw.js`` is served with ``Cache-Control: no-cache``.
"""

from __future__ import annotations

import re

import requests

TIMEOUT = 10
SCRIPT_SRC = re.compile(r'<script[^>]+src="([^"]+)"')
HASHED_ASSET = re.compile(r"^/assets/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$")


class TestPwaManifest:
    def test_get_pwa_manifest_json_serves_manifest(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/manifest.json", timeout=TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert isinstance(body.get("name"), str) and body["name"]
        assert isinstance(body.get("icons"), list) and body["icons"]


class TestServiceWorker:
    def test_get_sw_js_served_with_no_cache(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/sw.js", timeout=TIMEOUT)
        assert r.status_code == 200
        assert "javascript" in r.headers.get("content-type", "")
        assert len(r.content) > 100
        assert r.headers.get("cache-control") == "no-cache"


class TestAssetCaching:
    def test_get_hashed_asset_is_immutable(self, base_url: str) -> None:
        index = requests.get(f"{base_url}/", timeout=TIMEOUT)
        assert index.status_code == 200
        hashed = [s for s in SCRIPT_SRC.findall(index.text) if HASHED_ASSET.match(s)]
        assert hashed, f"no fingerprinted /assets/ script in index.html: {index.text[:500]!r}"
        r = requests.get(f"{base_url}{hashed[0]}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert len(r.content) > 1024
        assert r.headers.get("cache-control") == "public, max-age=31536000, immutable"

    def test_get_unhashed_public_asset_is_no_cache(self, base_url: str) -> None:
        r = requests.get(f"{base_url}/assets/icons/notify.png", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        assert r.headers.get("cache-control") == "no-cache"
