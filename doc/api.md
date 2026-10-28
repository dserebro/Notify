# API Reference

All HTTP endpoints are prefixed with `/api`. Responses are JSON and
served with `Cache-Control: no-cache`.

## Response envelope

Every `/api/*` route (except `/api/health`, see below) returns the
discriminated-union envelope exported from
[`@notify/shared`](../packages/shared/src/api-response.ts):

**Success**

```json
{ "successful": true, "data": <payload> }
```

**Failure**

```json
{ "successful": false, "error": { "type": "<failure-type>", "message": "<human readable>" } }
```

`type` is one of the following values (see
[`packages/shared/src/failures.ts`](../packages/shared/src/failures.ts)):

| `type`           | Status | Meaning                                                             |
| ---------------- | ------ | ------------------------------------------------------------------- |
| `auth_required`  | 401    | Missing/invalid `Authorization: Bearer …` header.                   |
| `invalid_data`   | 400    | Request body failed schema validation or exceeded size limits.      |
| `missing_data`   | 400    | A required field was absent (reserved; current routes use `invalid_data`). |
| `not_found`      | 404    | The requested resource does not exist (reserved).                    |
| `internal_error` | 500    | Unhandled server error (produced by the global `app.onError`).      |

## Authentication

Three bearer-token guards sit in front of the API, each matching the
configured key with `crypto.timingSafeEqual`:

- **`POST /api/notify`** requires `Authorization: Bearer <SENDKEY>`
  **only when `SENDKEY` is configured**. If it is unset, the endpoint
  is open (so demo deployments keep working).
- **`POST /api/device`** requires `Authorization: Bearer <LOGINKEY>`
  **only when `LOGINKEY` is configured**. Otherwise registration is
  public.
- **`GET`/`PATCH`/`DELETE /api/device/:device_id`** require
  `Authorization: Bearer <device.secret>`. The secret is returned
  (once) from the device-creation call. An unknown `:device_id`
  returns **401** (`auth_required`), not 404 — this prevents id
  enumeration.

---

## `GET /api/health`

Liveness probe used by the Docker `HEALTHCHECK` and by smoke tests.
This endpoint does **not** use the standard envelope.

**Response — `200 OK`**

```json
{ "status": "ok" }
```

---

## `GET /api/keys`

Returns the server's VAPID public key, base64url-encoded, suitable
for `pushManager.subscribe({ applicationServerKey })` in the browser.

**Auth** — none.

**Response — `200 OK`**

```json
{
  "successful": true,
  "data": "BGDRJjAeUMkFC1uFnqR0L5-VlqwV6RxhQedXid6CY95ONU3NCQI82-WvNWc2vc9HV8YOIAC9VsMrMhJhi3XS8MQ"
}
```

---

## `GET /api/keys/auth`

Reports whether `LOGINKEY` is configured on the server, so the PWA
knows whether to prompt for a login token before registration.

**Auth** — none.

**Response — `200 OK`**

```json
{ "successful": true, "data": true }
```

`data` is `true` when `LOGINKEY` is set, `false` otherwise.

---

## `POST /api/notify`

Fan-out: encrypt the message, dispatch it to every registered device,
and return once dispatch is complete. Per-device failures are logged
but never surface in the response. Devices that respond with 400,
401, 404 or 410 are considered `NotSubscribed` and purged.

**Auth** — `Bearer <SENDKEY>` when `SENDKEY` is configured.

**Request body**

```json
{
  "title": "Hello",
  "message": "World",
  "icon": "https://example.com/icon.png",   // optional
  "tags": ["test", "server"]                 // optional
}
```

The serialized payload must not exceed **2048 bytes**
(enforced by `enforceMessageSize` from `@notify/shared`).

**Response — `200 OK`**

```json
{ "successful": true, "data": { "message": "notified" } }
```

**Error responses**

- `400 invalid_data` — body is not valid JSON, fails `MessageSchema`,
  or exceeds the 2048-byte limit.
- `401 auth_required` — `SENDKEY` is set and the token did not
  match.

---

## `POST /api/device`

Register a new browser subscription. Returns the device `id` and the
`secret` that the client must present on all subsequent
GET/PATCH/DELETE calls. **The secret is only shown here — store it.**

**Auth** — `Bearer <LOGINKEY>` when `LOGINKEY` is configured.

**Request body**

```json
{
  "web_push_data": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/…",
    "key":      "<base64url subscription p256 key>",
    "auth":     "<base64url subscription auth>"
  }
}
```

**Response — `200 OK`**

```json
{
  "successful": true,
  "data": {
    "id":     "c968712190ec72e785160fe2a45b45a4",
    "secret": "bd907b2a5f9e571949aa92561fcb5694"
  }
}
```

**Error responses**

- `400 invalid_data` — missing or malformed `web_push_data`.
- `401 auth_required` — `LOGINKEY` is set and the token did not
  match.

---

## `GET /api/device/:device_id`

Lightweight existence check used by the PWA to detect that its stored
subscription is still live on the server.

**Auth** — `Bearer <device.secret>`.

**Response — `200 OK`**

```json
{ "successful": true, "data": { "exists": true } }
```

**Error responses**

- `401 auth_required` — bearer token missing, or does not match the
  stored secret (also returned when the id is unknown).

---

## `PATCH /api/device/:device_id`

Update a device's push subscription. This is used after the browser
rotates its subscription URL. **The device secret cannot be changed
through this endpoint** (fix for a legacy defect that persisted the
raw `Authorization` header as the new secret).

**Auth** — `Bearer <device.secret>`.

**Request body**

```json
{
  "web_push_data": {
    "endpoint": "https://…",
    "key":      "…",
    "auth":     "…"
  }
}
```

**Response — `200 OK`**

```json
{ "successful": true, "data": true }
```

**Error responses**

- `400 invalid_data` — missing/malformed `web_push_data`.
- `401 auth_required` — missing or wrong bearer token.

---

## `DELETE /api/device/:device_id`

Unregister a device.

**Auth** — `Bearer <device.secret>`.

**Response — `200 OK`**

```json
{ "successful": true, "data": true }
```

**Error responses**

- `401 auth_required` — missing or wrong bearer token.

---

## Error example

```json
{
  "successful": false,
  "error": {
    "type": "invalid_data",
    "message": "invalid message"
  }
}
```

Clients should branch on `successful`, then on `error.type` for a
machine-readable discriminator.
