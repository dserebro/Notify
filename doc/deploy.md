# Deploying Notify on a VPS

This guide walks through a self-hosted deployment on a generic Linux
VPS (Debian/Ubuntu/Fedora/etc.) using systemd for process management
and Caddy for automatic HTTPS. Notify is a plain Node 24 application
with a SQLite database, so any host that can run Node will do.

If you prefer Docker, see [`docker.md`](docker.md).

## 1. Prerequisites

- A VPS with at least 256 MB of RAM.
- A DNS A/AAAA record pointing at the VPS (needed by Caddy for the
  Let's Encrypt challenge).
- Root (or `sudo`) access.

## 2. Install Node 24

Pick whichever method matches your distro. The project targets Node
24 LTS and npm 11.

```bash
# Debian/Ubuntu via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Verify:
node --version   # v24.x
npm --version    # 11.x
```

The `build-essential` (or `make`, `gcc-c++`, `python3`) package is
only needed if `better-sqlite3` has to compile from source; prebuilt
binaries are shipped for glibc amd64/arm64.

## 3. Create the service user and directories

```bash
sudo useradd --system --home /opt/notify --shell /usr/sbin/nologin notify
sudo mkdir -p /opt/notify /var/lib/notify /etc/notify
sudo chown -R notify:notify /opt/notify /var/lib/notify
sudo chmod 750 /etc/notify
```

- `/opt/notify` — compiled application (source tree with `dist/`
  outputs).
- `/var/lib/notify` — SQLite database and the generated
  `vapid.json`.
- `/etc/notify` — environment file with secrets.

## 4. Clone and build

```bash
sudo -u notify git clone https://github.com/K0IN/Notify.git /opt/notify
cd /opt/notify
sudo -u notify npm ci
sudo -u notify npm run build
```

`npm run build` produces `packages/shared/dist`, `app/server/dist`
and `app/frontend/dist`.

## 5. Write the environment file

```bash
sudo tee /etc/notify/notify.env >/dev/null <<'EOF'
SUB=mailto:you@example.com
SENDKEY=change-me-to-a-long-random-value
# LOGINKEY=optional-ui-login-token
# VAPID_KEY=                 # omit to auto-generate and persist to /var/lib/notify/vapid.json
DATABASE_PATH=/var/lib/notify/notify.db
FRONTEND=/opt/notify/app/frontend/dist
TRUST_PROXY=true
EOF
sudo chown root:notify /etc/notify/notify.env
sudo chmod 640 /etc/notify/notify.env
```

Set `TRUST_PROXY=true` whenever the server runs behind a reverse
proxy (Caddy, Nginx, Traefik, …). It tells the server to honour the
`X-Forwarded-*` headers so client IPs are logged correctly.

## 6. Install the systemd unit

The repository ships a hardened unit at
[`deploy/notify.service`](../deploy/notify.service):

```bash
sudo install -m 644 /opt/notify/deploy/notify.service /etc/systemd/system/notify.service
sudo systemctl daemon-reload
sudo systemctl enable --now notify.service
sudo systemctl status notify.service
```

The unit binds Notify to `127.0.0.1:8787` by default and relies on a
local reverse proxy for TLS. Change `Environment=HOST=…` in the unit
(or override via `/etc/notify/notify.env`) if you want to expose it
on all interfaces instead.

## 7. Terminate TLS with Caddy

Install Caddy from your distro repo (`sudo apt install caddy` on
Debian/Ubuntu) and point it at Notify:

```caddy
# /etc/caddy/Caddyfile
notify.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
```

Reload:

```bash
sudo systemctl reload caddy
```

Caddy will fetch and renew a Let's Encrypt certificate automatically.
Nginx, HAProxy or any other TLS-terminating proxy works just as well.

## 8. Smoke test

```bash
curl -sS https://notify.example.com/api/health
# {"status":"ok"}

curl -sS -X POST https://notify.example.com/api/notify \
  -H "Authorization: Bearer $SENDKEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"hello","message":"world"}'
# {"successful":true,"data":{"message":"notified"}}
```

Open `https://notify.example.com` in a browser, register the PWA and
subscribe. The POST above will push a notification to every
registered device.

## 9. Upgrades

```bash
cd /opt/notify
sudo -u notify git pull
sudo -u notify npm ci
sudo -u notify npm run build
sudo systemctl restart notify.service
```

The SQLite schema is managed by versioned migrations applied at
startup, so no manual DB step is required.

## 10. Backups

Back up `/var/lib/notify/` as a whole. It holds `notify.db` (plus the
WAL/SHM files when the server is running) and `vapid.json`. Losing
`vapid.json` invalidates every existing browser subscription, so
include it in your backup rotation.
