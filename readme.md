# Notify - Push Notification Service

Notify is an open-source push notification service that lets you send push messages via a simple HTTP webhook to any device that supports web push. It runs on **Cloudflare Workers** with **Hono** as the HTTP framework, **Workers KV** for device storage, and ships with an offline-installable **Preact PWA** frontend.

## Features

- Send push messages to any device that supports web push
- Runs on Cloudflare Workers (local dev via Wrangler/Miniflare)
- Offline installable PWA
- Customize notifications with icons, tags, and more
- Open-source and free to use
- No registration required
- Simple REST API

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [Bun](https://bun.sh/) (latest stable) - used for backend dependency management
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) 4 (installed as a dev dependency)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VAPID_KEY` | Yes | Base64-encoded ECDSA P-256 JWK private key for Web Push authentication |
| `SUB` | Yes | VAPID subject contact (e.g. `mailto:you@example.com`) |
| `CORS` | No | CORS configuration. Set to `"false"` to disable (default: `"false"`) |
| `PORT` | No | Dev server listen port (default: `8787`) |

### Generating a VAPID Key

Run the included script to generate a new VAPID key pair:

```bash
cd app/backend
bun run generate-vapid-key
```

This outputs a base64-encoded JWK string. Use this value for `VAPID_KEY`.

## Installation & Setup

### 1. Install frontend dependencies and build the PWA

```bash
cd app/frontend
npm install
npm run build
```

### 2. Copy the frontend build into the backend's static assets directory

```bash
rm -rf app/backend/public
mkdir -p app/backend/public
cp -r app/frontend/build/* app/backend/public/
```

### 3. Install backend dependencies

```bash
cd app/backend
bun install
```

## Running Locally

### Configure secrets

Create a `.dev.vars` file in `app/backend/` with your VAPID credentials. Wrangler reads this file for local development:

```
VAPID_KEY=<your-base64-encoded-vapid-key>
SUB=mailto:you@example.com
```

### Start the dev server

```bash
cd app/backend
npx wrangler dev --port 8787
```

Wrangler starts the full Cloudflare Workers runtime locally via Miniflare, including Workers KV emulation. The server is ready when you can reach the health endpoint:

```bash
curl http://localhost:8787/api/keys
# Expected: {"successful":true,"data":"<VAPID_PUBLIC_KEY>"}
```

## Building

Validate that the Workers bundle compiles correctly (without deploying):

```bash
cd app/backend
npx wrangler deploy --dry-run
```

## API Reference

All endpoints are served under `/api`. Responses use a consistent JSON envelope:

- Success: `{"successful": true, "data": <value>}`
- Error: `{"successful": false, "error": {"type": "<error_type>", "message": "<details>"}}`

### GET /api/keys

Returns the VAPID public key. No authentication required.

```bash
curl http://localhost:8787/api/keys
```

### GET /api/keys/auth

Returns whether login authentication is enabled. No authentication required.

```bash
curl http://localhost:8787/api/keys/auth
# {"successful":true,"data":false}  (false when LOGINKEY is not set)
```

### POST /api/device

Create a new device registration. Returns the device `id` and `secret`.

```bash
curl -X POST http://localhost:8787/api/device \
  -H "Content-Type: application/json" \
  -d '{
    "web_push_data": {
      "endpoint": "https://fcm.googleapis.com/fcm/send/your-endpoint",
      "key": "<base64-p256dh-key>",
      "auth": "<base64-auth-secret>"
    }
  }'
# {"successful":true,"data":{"id":"<device_id>","secret":"<device_secret>"}}
```

Save the returned `id` and `secret` -- you need them for all authenticated device operations.

### GET /api/device/:id

Check whether a device exists. Requires `Authorization: Bearer <device_secret>`.

```bash
curl http://localhost:8787/api/device/<device_id> \
  -H "Authorization: Bearer <device_secret>"
# {"successful":true,"data":{"exists":true}}
```

### PATCH /api/device/:id

Update a device's push subscription data. Requires `Authorization: Bearer <device_secret>`.

```bash
curl -X PATCH http://localhost:8787/api/device/<device_id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <device_secret>" \
  -d '{
    "web_push_data": {
      "endpoint": "https://fcm.googleapis.com/fcm/send/updated-endpoint",
      "key": "<base64-p256dh-key>",
      "auth": "<base64-auth-secret>"
    }
  }'
# {"successful":true,"data":true}
```

### DELETE /api/device/:id

Delete a device registration. Requires `Authorization: Bearer <device_secret>`.

```bash
curl -X DELETE http://localhost:8787/api/device/<device_id> \
  -H "Authorization: Bearer <device_secret>"
# {"successful":true,"data":true}
```

### POST /api/notify

Send a push notification to all registered devices. Authentication is optional (required only when `SENDKEY` is set).

```bash
curl -X POST http://localhost:8787/api/notify \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello", "message": "World"}'
# {"successful":true,"data":{"message":"notified"}}
```

Optional fields: `icon` (URL), `tags` (array of strings).

```bash
curl -X POST http://localhost:8787/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hello",
    "message": "World",
    "icon": "https://via.placeholder.com/150",
    "tags": ["test", "server"]
  }'
```

## Testing

### Unit & Integration Tests (Vitest)

The project includes a Vitest test suite that runs inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`. Tests cover device CRUD routes, auth middleware, VAPID key operations, and Web Push utilities.

```bash
cd app/backend
npx vitest run
```

### Type Checking

```bash
cd app/backend
npx tsc --noEmit
```

### Functional API Tests (pytest)

A comprehensive functional test suite in `.mcode/functional-tests/1/test_notify_api.py` exercises all API endpoints against a running server. It covers 25 test cases across 6 test classes:

| Test Class | Endpoint | Coverage |
|------------|----------|----------|
| `TestGetKeys` | `GET /api/keys` | Key retrieval, consistency across calls |
| `TestGetKeysAuth` | `GET /api/keys/auth` | Auth status check |
| `TestCreateDevice` | `POST /api/device` | Happy path, invalid data, missing fields |
| `TestCheckDevice` | `GET /api/device/:id` | Happy path, not found, no auth, wrong secret |
| `TestUpdateDevice` | `PATCH /api/device/:id` | Happy path, invalid data, no auth, wrong auth |
| `TestDeleteDevice` | `DELETE /api/device/:id` | Happy path, delete-then-verify-gone, no auth, wrong auth |
| `TestNotify` | `POST /api/notify` | Happy path, optional fields, missing title/message, empty body |

**Prerequisites:** Python 3, pytest, requests

```bash
pip install pytest requests
```

**Run the tests** (the server must be running first):

```bash
FT_BASE_URL=http://localhost:8787 pytest .mcode/functional-tests/1/test_notify_api.py -v
```

### Manual Testing

With the dev server running, walk through the full device lifecycle using curl:

**1. Get the VAPID public key**

```bash
curl http://localhost:8787/api/keys
```

**2. Check auth status**

```bash
curl http://localhost:8787/api/keys/auth
```

**3. Register a device**

```bash
curl -X POST http://localhost:8787/api/device \
  -H "Content-Type: application/json" \
  -d '{
    "web_push_data": {
      "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint",
      "key": "BPXZQ+zXGJ2DlMRKjC8xYb6aRHcRPf8D6L0XqWyTrnY=",
      "auth": "dGVzdGF1dGg="
    }
  }'
```

Save the returned `id` and `secret` from the response.

**4. Verify the device exists**

```bash
curl http://localhost:8787/api/device/<DEVICE_ID> \
  -H "Authorization: Bearer <DEVICE_SECRET>"
# Expect: {"successful":true,"data":{"exists":true}}
```

**5. Update the device push subscription**

```bash
curl -X PATCH http://localhost:8787/api/device/<DEVICE_ID> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <DEVICE_SECRET>" \
  -d '{
    "web_push_data": {
      "endpoint": "https://fcm.googleapis.com/fcm/send/updated-endpoint",
      "key": "BPXZQ+zXGJ2DlMRKjC8xYb6aRHcRPf8D6L0XqWyTrnY=",
      "auth": "dXBkYXRlZA=="
    }
  }'
# Expect: {"successful":true,"data":true}
```

**6. Send a notification**

```bash
curl -X POST http://localhost:8787/api/notify \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "message": "Hello from Notify!"}'
# Expect: {"successful":true,"data":{"message":"notified"}}
```

**7. Delete the device**

```bash
curl -X DELETE http://localhost:8787/api/device/<DEVICE_ID> \
  -H "Authorization: Bearer <DEVICE_SECRET>"
# Expect: {"successful":true,"data":true}
```

**8. Verify the device is gone**

```bash
curl http://localhost:8787/api/device/<DEVICE_ID> \
  -H "Authorization: Bearer <DEVICE_SECRET>"
# Expect: 401 {"successful":false,"error":{"type":"auth_required","message":"Authorization header invalid"}}
```

## Deployment

To deploy to Cloudflare Workers:

1. Create a KV namespace for device storage:
   ```bash
   npx wrangler kv namespace create DEVICES
   ```

2. Update the `kv_namespaces` binding in `wrangler.jsonc` with the returned namespace ID.

3. Set secrets:
   ```bash
   npx wrangler secret put VAPID_KEY
   npx wrangler secret put SUB
   ```

4. Deploy:
   ```bash
   cd app/backend
   npx wrangler deploy
   ```

## Project Structure

```
app/
  backend/
    src/
      index.ts          # Worker entry point (Hono app)
      routes/           # API route handlers (device, keys, notify)
      middleware/        # Auth middleware (device secret, push secret, login key)
      databases/        # Workers KV operations
      logic/            # Business logic layer
      types/            # TypeScript types, Zod schemas, API response helpers
      util/             # Utility functions (string comparison, crypto helpers)
      webpush/          # Web Push protocol implementation (VAPID, encryption)
    test/               # Vitest test suite
    scripts/            # Utility scripts (VAPID key generation, send notification)
    wrangler.jsonc      # Wrangler configuration
    package.json        # Dependencies and scripts
  frontend/             # Preact PWA (unchanged)
```

## Credits

Built on the web push code from [gauntface](https://github.com/gauntface), powered by [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/), and using the [Google Icon Font](https://fonts.google.com/icons).
