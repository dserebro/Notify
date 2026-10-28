# Notify

Self-hosted Web Push notification service with an installable Preact
PWA. Send a message to one webhook; every registered browser gets a
push notification, even when the tab is closed.

## Quickstart with Docker

```bash
docker run -p 8787:8787 -v notify-data:/data \
  -e SUB=mailto:you@example.com \
  -e SENDKEY=change-me \
  ghcr.io/k0in/notify
```

Open `http://localhost:8787`, register the PWA, then send a
notification:

```bash
curl -X POST http://localhost:8787/api/notify \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","message":"World"}'
```

On first start the server generates a VAPID key and persists it to
`/data/vapid.json`, so you do not have to mint one up front. See
[`doc/docker.md`](doc/docker.md) for the full environment-variable
reference.

## Features

- One webhook (`POST /api/notify`) fans out encrypted Web Push
  messages to every registered device.
- Installable PWA with offline support (Vite 7 + vite-plugin-pwa,
  Preact 10, Workbox-backed service worker).
- Zero-dependency Web Push implementation (VAPID JWT, `aesgcm`
  framing, HKDF) — no runtime key-format surprises when migrating
  from older deployments.
- SQLite persistence via `better-sqlite3`, WAL mode, versioned
  migrations.
- Hono 4 on `@hono/node-server`, Node 24 LTS runtime.
- Optional `SENDKEY` and `LOGINKEY` guards, enforced with
  constant-time comparison.
- Multi-arch container image on `ghcr.io/k0in/notify` (linux/amd64,
  linux/arm64), systemd unit shipped under
  [`deploy/notify.service`](deploy/notify.service).

## Documentation

- [Installation](doc/install.md) — prerequisites, build-from-source,
  configuration, device import.
- [Deploy on a VPS](doc/deploy.md) — end-to-end guide: user, systemd,
  Caddy TLS.
- [Docker](doc/docker.md) — image reference, environment variables,
  Compose + Caddy sidecar.
- [Bare metal / systemd](doc/baremetal.md) — compile and run under
  the shipped unit file.
- [HTTP API](doc/api.md) — endpoints, envelope and status codes.

## Tech stack

| Layer           | Pick                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| Runtime         | Node.js 24 LTS, ESM, TypeScript 5.9 strict (`nodenext`)                   |
| HTTP server     | Hono 4 on `@hono/node-server`                                             |
| Persistence     | SQLite via `better-sqlite3` 12, WAL mode, versioned migrations            |
| Web Push        | In-tree zero-dependency VAPID + `aesgcm` implementation                   |
| CLI             | commander 14 (`run`, `generate`, `notify`, `import-devices`)              |
| Validation      | zod 4 (shared schemas in `packages/shared`)                               |
| Frontend        | Preact 10, Vite 7, `vite-plugin-pwa` (injectManifest), Workbox 7          |
| Lint/format     | Biome 2                                                                   |
| Tests           | Vitest 4 (unit + API), Playwright (E2E against the Docker image)          |
| Container       | Multi-stage build on `node:24-alpine`, non-root, `fetch`-based healthcheck |

## Repository layout

```
app/server/              Node 24 + Hono API
app/frontend/            Preact PWA (Vite build)
packages/shared/         zod schemas, codec, failure types
scripts/export-deno-kv.ts  one-off migration helper (run under Deno)
dockerfile               multi-stage image
deploy/notify.service    systemd unit for a VPS
examples/                docker-compose.yml + Caddyfile
doc/                     docs (install / deploy / docker / baremetal / api)
```

## Credits

Notify started as [K0IN/Notify](https://github.com/K0IN/Notify) on
Deno Deploy and migrated to Node 24 after the Deno Deploy sunset.
Thanks to [gauntface](https://github.com/gauntface) for the reference
Web Push implementation this port is based on, and to the Google
Material Icons team for the icon font.

## License

MIT. See [`LICENSE`](LICENSE).
