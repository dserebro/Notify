# Running Notify on bare metal

This page covers compiling Notify from source and running it under a
systemd unit on a Linux host. For a step-by-step VPS walkthrough
(including DNS, TLS and a reverse proxy), see
[`deploy.md`](deploy.md).

## Prerequisites

- Node.js 24.x (LTS)
- npm 11
- `python3`, `make` and a C++ compiler — only needed if the
  `better-sqlite3` prebuilt binary does not match your platform
  (glibc amd64, glibc arm64, musl amd64, musl arm64, macOS amd64/arm64
  all ship prebuilt). On Debian/Ubuntu: `sudo apt install build-essential`.
- `git`

## Build

```bash
git clone https://github.com/K0IN/Notify.git
cd Notify
npm ci                # installs workspaces: shared, server, frontend
npm run build         # compiles shared → server → frontend
```

Outputs:

- `packages/shared/dist/` — zod schemas and codec consumed by the
  server and the PWA.
- `app/server/dist/` — compiled server (ESM, Node 24).
- `app/frontend/dist/` — Vite-built PWA (served by the Node server
  when `FRONTEND` points at this directory).

## Run interactively

```bash
node app/server/dist/index.js run \
  --port 8787 \
  --sub mailto:you@example.com \
  --sendkey "$SENDKEY" \
  --frontend ./app/frontend/dist \
  --database ./data/notify.db
```

Or, with a `.env` file (see [`install.md`](install.md)):

```bash
node --env-file-if-exists=.env app/server/dist/index.js run
```

On first start the server generates a VAPID key and writes it to
`<databasePath>/../vapid.json` so later restarts stay compatible with
browsers that already subscribed. The decision log in
`PROJECT.md` (design decision 5) explains why there is no shared
default key.

## Run under systemd

The repository ships a hardened unit file at
[`deploy/notify.service`](../deploy/notify.service). It expects the
compiled source to live at `/opt/notify`, the SQLite database at
`/var/lib/notify/notify.db`, and an optional environment file at
`/etc/notify/notify.env`.

### Install

```bash
# One-time: user, directories, env file.
sudo useradd --system --home /opt/notify --shell /usr/sbin/nologin notify
sudo mkdir -p /opt/notify /var/lib/notify /etc/notify
sudo chown -R notify:notify /opt/notify /var/lib/notify

# Deploy the compiled source as the service user.
sudo -u notify git clone https://github.com/K0IN/Notify.git /opt/notify
cd /opt/notify
sudo -u notify npm ci
sudo -u notify npm run build

# Env file.
sudo tee /etc/notify/notify.env >/dev/null <<'EOF'
SUB=mailto:you@example.com
SENDKEY=change-me
# LOGINKEY=
# VAPID_KEY=
DATABASE_PATH=/var/lib/notify/notify.db
FRONTEND=/opt/notify/app/frontend/dist
TRUST_PROXY=true
EOF
sudo chown root:notify /etc/notify/notify.env
sudo chmod 640 /etc/notify/notify.env

# Service unit.
sudo install -m 644 /opt/notify/deploy/notify.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now notify.service
```

### Verify

```bash
systemctl status notify.service
journalctl -u notify.service -f

curl -sS http://127.0.0.1:8787/api/health
# {"status":"ok"}
```

### Hardening defaults

The shipped unit sets `NoNewPrivileges=true`, `ProtectSystem=strict`,
`ProtectHome=true`, `PrivateTmp=true`, `ProtectKernelTunables=true`
and friends. The only writable path is `/var/lib/notify` (via
`ReadWritePaths=`), where the SQLite database and `vapid.json` live.
If you move those paths, update both the env file and the unit's
`ReadWritePaths=` line.

## Upgrades

```bash
cd /opt/notify
sudo -u notify git pull
sudo -u notify npm ci
sudo -u notify npm run build
sudo systemctl restart notify.service
```

SQL migrations run inside a transaction at startup, so no manual DB
step is needed. See [`deploy.md`](deploy.md) for backup guidance.
