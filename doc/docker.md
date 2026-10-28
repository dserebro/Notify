# Running Notify with Docker

Notify is published as a multi-arch (linux/amd64, linux/arm64) image
at [`ghcr.io/k0in/notify`](https://ghcr.io/k0in/notify). The image is
built on `node:24-alpine`, runs as a non-root user, exposes port
8787, and uses a Node `fetch` healthcheck on `/api/health`.

## Quickstart

```bash
docker run -d --name notify \
  -p 8787:8787 \
  -v notify-data:/data \
  -e SUB=mailto:you@example.com \
  -e SENDKEY=change-me \
  ghcr.io/k0in/notify
```

Then open `http://localhost:8787` and send a test:

```bash
curl -X POST http://localhost:8787/api/notify \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","message":"World"}'
```

> **Port note:** the legacy Deno Deploy container defaulted to `PORT=80`.
> The Node container exposes **8787** by default. Change your port
> mapping (`-p 80:8787` on the host, or `-e PORT=…` to move it inside
> the container) when you upgrade.

## Environment variables

| Name            | Description                                                       | Default           |
| --------------- | ----------------------------------------------------------------- | ----------------- |
| `SUB`           | VAPID subscription contact (`mailto:…`). **Required.**            | —                 |
| `SENDKEY`       | Bearer token required to call `POST /api/notify`.                 | *(unauthenticated)* |
| `LOGINKEY`      | Bearer token required to call `POST /api/device`.                 | *(open)*          |
| `VAPID_KEY`     | base64(JWK) private key. Generated on first start if unset.       | *(auto)*          |
| `DATABASE_PATH` | SQLite path. Must sit on the `/data` volume to survive restarts.  | `/data/notify.db` |
| `FRONTEND`      | Path to the built PWA inside the image.                           | `/app/app/frontend/dist` |
| `PORT`          | HTTP listen port.                                                 | `8787`            |
| `HOST`          | HTTP listen host.                                                 | `0.0.0.0`         |
| `CORS`          | Enable CORS when the PWA is served on a different origin.         | `false`           |
| `TRUST_PROXY`   | Trust `X-Forwarded-*` headers (set `true` behind a reverse proxy).| `false`           |
| `LOG_LEVEL`     | `trace` / `debug` / `info` / `warn` / `error`.                    | `info`            |

**No VAPID key is baked into the image.** When `VAPID_KEY` is unset,
the server generates one at startup and persists it to
`/data/vapid.json` so later restarts keep the same key. Pre-set
`VAPID_KEY` only if you are migrating an existing key (so already-
subscribed browsers keep working). When migrating from Deno Deploy,
set it **before the first start and before importing devices** — see
[Carry over your VAPID key first](install.md#carry-over-your-vapid-key-first),
which also covers instances that ran on the legacy built-in default key.

## Volumes

- `/data` — SQLite database and the generated `vapid.json`. Mount a
  named volume or a host path; otherwise state is lost when the
  container is removed.

## Healthcheck

The image ships `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/api/health')…"`.
Container orchestrators and `docker ps` surface the result; use
`docker inspect --format='{{.State.Health.Status}}' notify` to query
it directly.

## Caddy sidecar (automatic HTTPS)

The project ships an example compose file at
[`examples/docker-compose.yml`](../examples/docker-compose.yml) that
pairs Notify with [Caddy 2](https://caddyserver.com/) for Let's
Encrypt-backed TLS, and a matching
[`examples/Caddyfile`](../examples/Caddyfile).

Place both files on the host and set `NOTIFY_SUB`, `NOTIFY_SENDKEY`
(required; compose refuses to start without it) and optionally
`NOTIFY_LOGINKEY` in a sibling `.env`.

Notify alone is published on host port 8787 (`8787:8787`), which is
enough behind an existing reverse proxy or on localhost:

```bash
docker compose -f examples/docker-compose.yml up -d
```

The Caddy service is optional and lives behind the `caddy` compose
profile. Update the hostname in the Caddyfile and start it with:

```bash
docker compose -f examples/docker-compose.yml --profile caddy up -d
```

Caddy then terminates TLS on 80/443. When you rely on Caddy, you can
remove the `8787:8787` mapping so Notify is only reachable on the
internal compose network.

## Running the CLI

Any of the commander subcommands is reachable by overriding the
default CMD:

```bash
# Generate a VAPID key you can paste into VAPID_KEY:
docker run --rm ghcr.io/k0in/notify generate

# Import devices exported from a Deno Deploy instance:
docker run --rm \
  -v notify-data:/data \
  -v "$PWD/devices.json:/tmp/devices.json:ro" \
  ghcr.io/k0in/notify import-devices /tmp/devices.json
```

## Building the image locally

Docker Buildx is required for multi-arch output; a single-arch build
on the host's native platform works with vanilla `docker build`:

```bash
docker build -t notify:dev -f dockerfile .
docker run --rm -p 8787:8787 -v notify-data:/data \
  -e SUB=mailto:you@example.com -e SENDKEY=dev notify:dev
```

The build respects `.dockerignore`, so local `node_modules`, `dist/`,
`.env` files and the Deno artefacts never enter the image.
