# Installation

Notify ships as a single Node 24 process backed by SQLite. Three install
paths are supported:

- [Docker](docker.md) — the quickest way to get a running instance.
- [Bare metal / systemd on a VPS](baremetal.md) — compile from source
  and run under a systemd unit.
- [Deploy guide](deploy.md) — end-to-end guide for a Linux VPS with
  TLS via Caddy.

The API shape is documented in [`api.md`](api.md).

## Prerequisites

- Node.js 24.x (LTS)
- npm 11
- A POSIX build toolchain (`python3`, `make`, `g++` or Xcode CLT) in
  case `better-sqlite3` has to compile from source. Prebuilt binaries
  are available for Linux glibc/musl and macOS on amd64 and arm64.

## From source

```bash
git clone https://github.com/K0IN/Notify.git
cd Notify
npm ci                        # installs the workspace (shared, server, frontend)
npm run build                 # builds shared → server → frontend

node app/server/dist/index.js run
```

That boots the HTTP server on `http://0.0.0.0:8787` with the compiled
Preact PWA served from `app/frontend/dist`. Create a `.env` first (see
below) so SUB and SENDKEY are set.

## Configuration

Settings are read from, in order of precedence:

1. CLI flags (`--port`, `--sub`, `--sendkey`, …).
2. Environment variables.
3. Built-in defaults.

Load variables from a `.env` file with Node's native loader:

```bash
node --env-file-if-exists=.env app/server/dist/index.js run
```

Example `.env`:

```ini
# Contact address for the push service (RFC 8292). Required.
SUB=mailto:you@example.com

# Bearer token required to call POST /api/notify. Highly recommended
# in production; otherwise anyone who can reach the port can send push
# notifications to every registered device.
SENDKEY=change-me

# Optional bearer token required to call POST /api/device (device
# registration). Leave empty to allow public registration.
LOGINKEY=

# Optional base64(JWK) VAPID private key. If unset, Notify generates
# one on first start and writes it to <dataDir>/vapid.json so it
# survives restarts. Only set this to import a key from a previous
# instance (for example, to migrate from Deno Deploy without losing
# existing subscribers).
VAPID_KEY=

# SQLite database file. Parent directories are created on demand.
DATABASE_PATH=./data/notify.db

# Serve the built PWA from this directory.
FRONTEND=./app/frontend/dist

# Trust X-Forwarded-* headers (set to `true` behind a reverse proxy
# like Caddy or Nginx so client IPs are logged correctly).
TRUST_PROXY=false
```

The matching CLI flags are listed by `node app/server/dist/index.js run --help`.

## Generate a VAPID key manually

Notify can generate one for you on first start, but if you want to
mint a key up front (for example, to pin it in your deployment
secrets):

```bash
node app/server/dist/index.js generate
```

The command prints a base64-encoded JWK suitable for the `VAPID_KEY`
env var. The same key format was used by the legacy Deno backend, so
browser subscriptions remain valid when you move to the Node runtime.

## Send a test notification

With the server running, pass a title and message to the CLI (or
`curl` the `/api/notify` endpoint directly). `--remote` is the server's
base URL and may include a sub-path for reverse-proxied instances
(e.g. `https://example.com/notify`); `api/notify` is appended to it:

```bash
node app/server/dist/index.js notify \
  --remote http://localhost:8787 \
  --key "$SENDKEY" \
  --title "Hello" \
  --message "World"
```

## Importing devices from a Deno Deploy instance

### Carry over your VAPID key first

Imported devices only keep receiving pushes if the new server signs
with the **same** VAPID key as the old instance. Configure it
**before the first start and before `import-devices`**; otherwise the
server generates a fresh key into `vapid.json`, and every imported
device is rejected by its push service and purged on the first notify.

1. Find the key: in the Deno Deploy dashboard, open your project's
   *Settings → Environment Variables* and copy `VAPID_KEY`.
2. If `VAPID_KEY` was **never set** there, the legacy backend signed
   with the hard-coded default from `app/backend/deploy.ts`. Use that
   value explicitly — the Node server no longer falls back to it:

   ```
   eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwiYWxnIjoiRVMyNTYiLCJ4IjoiUV92WlVXUExOUlFMRnU5QWRNaGRDQlFpY1FKamxYajVHZ2lwY19BS1E5USIsInkiOiJILXlDUF9hZ3FzRmpGMmgtZ2dNTTdVT1UxdktJN1JTcU1XSVhfZjBJekhnIiwiZCI6IjVXdzg1TnFxN09lY0pyaDN5MDl6a1JLWWR3TEhUVTVObjlNZUNqMkh6Y2MiLCJrZXlfb3BzIjpbInNpZ24iXSwiZXh0Ijp0cnVlfQ==
   ```

3. Set it as `VAPID_KEY` (env, `.env` or `--vapidkey`) for the new
   server. A configured key always wins over `vapid.json`; if a fresh
   key was already generated, setting `VAPID_KEY` is enough (the server
   logs a warning that the two differ — you can then delete
   `vapid.json`).
4. Check that `GET /api/keys` on the new server returns the same public
   key as the old instance did.

### Export and import

If you are migrating from the legacy Deno Deploy backend, the
`scripts/export-deno-kv.ts` script (run under Deno) dumps every
`["device", id]` entry from a Deno KV store as a JSON array:

```bash
# Against a Deno Deploy KV database:
DENO_KV_ACCESS_TOKEN=... deno run --unstable-kv --allow-net --allow-env --allow-write \
    scripts/export-deno-kv.ts \
    --kv https://api.deno.com/databases/<uuid>/connect \
    --out devices.json

# Or against a local Deno KV file:
deno run --unstable-kv --allow-read --allow-write \
    scripts/export-deno-kv.ts --kv ./app/data/local.db --out devices.json
```

Then upsert the records into your new SQLite database:

```bash
node app/server/dist/index.js import-devices devices.json
```

Each record is validated against the shared `DeviceSchema`; malformed
rows are logged and skipped. Because the VAPID key format and the
Web Push payload encoding are unchanged, previously-subscribed
browsers keep receiving notifications as long as the same `VAPID_KEY`
is configured (see [Carry over your VAPID key first](#carry-over-your-vapid-key-first)).

## Next steps

- [`docker.md`](docker.md) — run the published image.
- [`baremetal.md`](baremetal.md) — compile and run under systemd.
- [`deploy.md`](deploy.md) — end-to-end VPS guide with TLS.
- [`api.md`](api.md) — HTTP API reference.
