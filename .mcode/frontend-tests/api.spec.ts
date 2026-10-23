import { test, expect } from "@playwright/test";

/**
 * API endpoint tests.
 * Based on QA report flows: VAPID keys, auth status, device CRUD, notify.
 *
 * Device routes use path params (/api/device/:id) and Bearer token auth.
 * All responses follow { successful: true/false, data/error } envelope.
 */

test.describe("GET /api/keys — VAPID public key", () => {
  test("returns 200 with successful envelope", async ({ request }) => {
    const response = await request.get("/api/keys");
    expect(response.status()).toBe(200);

    const body = await response.json();
    // QA report: response.successful === true
    expect(body.successful).toBe(true);
  });

  test("returns non-empty VAPID public key starting with BEP", async ({
    request,
  }) => {
    const response = await request.get("/api/keys");
    const body = await response.json();

    // QA report: response.data is a non-empty string starting with "BEP"
    // (uncompressed EC public key in Base64url)
    expect(typeof body.data).toBe("string");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data).toMatch(/^BEP/);
  });
});

test.describe("GET /api/keys/auth — Auth status", () => {
  test("returns 200 with successful envelope", async ({ request }) => {
    const response = await request.get("/api/keys/auth");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.successful).toBe(true);
  });

  test("returns false when LOGINKEY is not configured", async ({ request }) => {
    const response = await request.get("/api/keys/auth");
    const body = await response.json();

    // QA report: data === false when LOGINKEY is not set (registration is open)
    expect(body.data).toBe(false);
  });
});

test.describe("POST /api/device — Device registration", () => {
  test("creates a device and returns id and secret", async ({ request }) => {
    // QA report: POST /api/device with web_push_data returns
    // {"successful":true,"data":{"id":"<32-char hex>","secret":"<32-char hex>"}}
    // key and auth must be standard base64 (not base64url)
    const response = await request.post("/api/device", {
      data: {
        web_push_data: {
          endpoint: "https://example.com/push/test-endpoint",
          key: "dGVzdGtleQ==",
          auth: "dGVzdGF1dGg=",
        },
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.successful).toBe(true);
    expect(typeof body.data.id).toBe("string");
    expect(body.data.id.length).toBeGreaterThan(0);
    expect(typeof body.data.secret).toBe("string");
    expect(body.data.secret.length).toBeGreaterThan(0);
  });

  test("device id is a hex string", async ({ request }) => {
    const response = await request.post("/api/device", {
      data: {
        web_push_data: {
          endpoint: "https://example.com/push/test-endpoint-2",
          key: "dGVzdGtleQ==",
          auth: "dGVzdGF1dGg=",
        },
      },
    });

    const body = await response.json();
    // QA report: response.data.id is a non-empty string (32-char hex)
    expect(body.data.id).toMatch(/^[0-9a-f]+$/i);
  });
});

test.describe("Device CRUD — GET, PATCH, DELETE", () => {
  let deviceId: string;
  let deviceSecret: string;

  test.beforeEach(async ({ request }) => {
    const reg = await request.post("/api/device", {
      data: {
        web_push_data: {
          endpoint: `https://example.com/push/crud-test-${Date.now()}`,
          key: "dGVzdGtleQ==",
          auth: "dGVzdGF1dGg=",
        },
      },
    });
    const regBody = await reg.json();
    deviceId = regBody.data.id;
    deviceSecret = regBody.data.secret;
  });

  test("GET /api/device/:id returns the registered device", async ({
    request,
  }) => {
    // Device routes use Bearer token auth (Authorization: Bearer <secret>)
    const response = await request.get(`/api/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${deviceSecret}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
    expect(body.data.exists).toBe(true);
  });

  test("PATCH /api/device/:id updates the device endpoint", async ({
    request,
  }) => {
    const response = await request.patch(`/api/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${deviceSecret}` },
      data: {
        web_push_data: {
          endpoint: `https://example.com/push/updated-${Date.now()}`,
          key: "dXBkYXRlZGtleQ==",
          auth: "dXBkYXRlZGF1dGg=",
        },
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
  });

  test("DELETE /api/device/:id removes the device", async ({ request }) => {
    const response = await request.delete(`/api/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${deviceSecret}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
  });

  test("GET after DELETE returns 401 (device no longer exists)", async ({
    request,
  }) => {
    // Delete first
    await request.delete(`/api/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${deviceSecret}` },
    });

    // Subsequent GET should fail since the device was deleted
    const response = await request.get(`/api/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${deviceSecret}` },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("POST /api/notify — Notification dispatch", () => {
  test("returns notified response when SENDKEY not set", async ({
    request,
  }) => {
    // QA report: POST /api/notify → returns "notified" message
    // Since SENDKEY is not configured, the endpoint is open (no auth required).
    // notifyAll dispatches to all registered devices; with no real devices
    // it still returns success with message: "notified".
    const response = await request.post("/api/notify", {
      data: {
        title: "Test notification",
        message: "E2E test message",
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
    expect(body.data.message).toBe("notified");
  });
});
