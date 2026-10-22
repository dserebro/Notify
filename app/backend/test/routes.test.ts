import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

// The wrangler.jsonc config already points to src/index.ts as the main entry,
// so SELF will serve requests through our Hono app.

describe("Device API", () => {
    // Helper to create a device and return its id and secret
    async function createDevice() {
        const pushData = {
            endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
            key: "BPXZ8WLXN1c3Yp8Y4X2Z",  // simplified for testing
            auth: "dGVzdA==",
        };
        const res = await SELF.fetch("https://example.com/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: pushData }),
        });
        const json = await res.json() as any;
        return { id: json.data.id, secret: json.data.secret };
    }

    it("POST /api/device — creates a device", async () => {
        const pushData = {
            endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
            key: "BPXZ8WLXN1c3Yp8Y4X2Z",
            auth: "dGVzdA==",
        };
        const res = await SELF.fetch("https://example.com/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: pushData }),
        });
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
        expect(json.data.id).toBeDefined();
        expect(json.data.secret).toBeDefined();
        expect(typeof json.data.id).toBe("string");
        expect(typeof json.data.secret).toBe("string");
    });

    it("POST /api/device — rejects invalid push data", async () => {
        const res = await SELF.fetch("https://example.com/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: { invalid: true } }),
        });
        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.successful).toBe(false);
        expect(json.error.type).toBe("invalid_data");
    });

    it("GET /api/device/:id — returns device exists with valid auth", async () => {
        const device = await createDevice();
        const res = await SELF.fetch(`https://example.com/api/device/${device.id}`, {
            headers: { "Authorization": `Bearer ${device.secret}` },
        });
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
        expect(json.data.exists).toBe(true);
    });

    it("GET /api/device/:id — rejects without auth", async () => {
        const device = await createDevice();
        const res = await SELF.fetch(`https://example.com/api/device/${device.id}`);
        expect(res.status).toBe(401);
        const json = await res.json() as any;
        expect(json.successful).toBe(false);
        expect(json.error.type).toBe("auth_required");
    });

    it("GET /api/device/:id — rejects with wrong auth", async () => {
        const device = await createDevice();
        const res = await SELF.fetch(`https://example.com/api/device/${device.id}`, {
            headers: { "Authorization": "Bearer wrong-secret" },
        });
        expect(res.status).toBe(401);
    });

    it("PATCH /api/device/:id — updates device with valid auth", async () => {
        const device = await createDevice();
        const newPushData = {
            endpoint: "https://fcm.googleapis.com/fcm/send/new-endpoint",
            key: "BPXZ8WLXN1c3Yp8Y4X2Z",
            auth: "dGVzdA==",
        };
        const res = await SELF.fetch(`https://example.com/api/device/${device.id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${device.secret}`,
            },
            body: JSON.stringify({ web_push_data: newPushData }),
        });
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
    });

    it("DELETE /api/device/:id — deletes device with valid auth", async () => {
        const device = await createDevice();
        const res = await SELF.fetch(`https://example.com/api/device/${device.id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${device.secret}` },
        });
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);

        // Verify device is gone
        const checkRes = await SELF.fetch(`https://example.com/api/device/${device.id}`, {
            headers: { "Authorization": `Bearer ${device.secret}` },
        });
        expect(checkRes.status).toBe(401); // device not found, auth fails
    });
});

describe("Keys API", () => {
    it("GET /api/keys — returns VAPID public key", async () => {
        const res = await SELF.fetch("https://example.com/api/keys");
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
        expect(typeof json.data).toBe("string");
        expect(json.data.length).toBeGreaterThan(0);
    });

    it("GET /api/keys/auth — returns auth status", async () => {
        const res = await SELF.fetch("https://example.com/api/keys/auth");
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
        expect(typeof json.data).toBe("boolean");
    });
});

describe("Notify API", () => {
    it("POST /api/notify — accepts valid notification", async () => {
        const res = await SELF.fetch("https://example.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "Test Notification",
                message: "Hello World",
            }),
        });
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.successful).toBe(true);
    });

    it("POST /api/notify — rejects invalid notification", async () => {
        const res = await SELF.fetch("https://example.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invalid: true }),
        });
        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.successful).toBe(false);
    });

    it("POST /api/notify — rejects data too long", async () => {
        const res = await SELF.fetch("https://example.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "x".repeat(1024),
                message: "y".repeat(1024),
                tags: ["a".repeat(256)],
            }),
        });
        expect(res.status).toBe(400);
    });
});

describe("Auth Middleware", () => {
    it("POST /api/device — works without loginkey configured (open registration)", async () => {
        // The default test env has no LOGINKEY, so registration should be open
        const pushData = {
            endpoint: "https://fcm.googleapis.com/fcm/send/test",
            key: "BPXZ8WLXN1c3Yp8Y4X2Z",
            auth: "dGVzdA==",
        };
        const res = await SELF.fetch("https://example.com/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: pushData }),
        });
        expect(res.status).toBe(200);
    });
});
