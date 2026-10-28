import FDBFactory from "fake-indexeddb/lib/FDBFactory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginStatus, login, logoff } from "../../src/services/loginservice";

// Rewire the subscription helpers to a vi.fn() so we never touch the real
// ServiceWorker / PushManager (which happy-dom does not implement).
vi.mock("../../src/services/webpush", () => ({
    createSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
}));

import { getDatabase } from "../../src/database/message";
import * as webpush from "../../src/services/webpush";
import { DBNAME } from "../../src/staticsettings";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function installFetchMock(responses: Response[]): FetchMock {
    const queue = [...responses];
    const mock: FetchMock = vi.fn(async () => {
        const next = queue.shift();
        if (!next) {
            throw new Error("fetch mock exhausted");
        }
        return next;
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    return mock;
}

function freshIndexedDB(): void {
    // Each test gets its own in-memory IndexedDB. Constructing a new
    // factory wipes the previous database state so test order can never
    // leak user records between cases.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
        new FDBFactory();
}

const samplePushData = {
    endpoint: "https://push.example.com/endpoint/abc",
    key: new Uint8Array([1, 2, 3, 4]).buffer,
    auth: new Uint8Array([5, 6, 7, 8]).buffer,
    expirationTime: undefined,
};

describe("loginservice", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        freshIndexedDB();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("login(): fetches vapid data, subscribes, creates a device and returns LOGGED_IN", async () => {
        vi.mocked(webpush.createSubscription).mockResolvedValue(samplePushData);

        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: "server-public-key" }),
            jsonResponse({
                successful: true,
                data: { id: "device-1", secret: "shh" },
            }),
        ]);

        const [status, device] = await login();

        expect(status).toBe(LoginStatus.LOGGED_IN);
        expect(device).toEqual({ id: "device-1", secret: "shh" });
        expect(webpush.createSubscription).toHaveBeenCalledWith(
            "server-public-key",
        );
        // Two network calls: GET /api/keys, POST /api/device.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/keys");
        expect(fetchMock.mock.calls[1][0]).toBe("/api/device");
    });

    it("login(): returns LOGIN_PASSWORD_REQUIRED on a 401 from createDevice", async () => {
        vi.mocked(webpush.createSubscription).mockResolvedValue(samplePushData);

        installFetchMock([
            jsonResponse({ successful: true, data: "server-public-key" }),
            jsonResponse(
                {
                    successful: false,
                    error: { type: "auth_required", message: "login required" },
                },
                401,
            ),
        ]);

        const [status, device] = await login();

        expect(status).toBe(LoginStatus.LOGIN_PASSWORD_REQUIRED);
        expect(device).toBeNull();
    });

    it("login(): marks the webpush info as expired when the subscription has an expirationTime", async () => {
        vi.mocked(webpush.createSubscription).mockResolvedValue({
            ...samplePushData,
            expirationTime: 1234,
        });

        installFetchMock([
            jsonResponse({ successful: true, data: "server-public-key" }),
            jsonResponse({
                successful: true,
                data: { id: "device-1", secret: "shh" },
            }),
        ]);

        const [status] = await login();
        expect(status).toBe(LoginStatus.LOGGED_IN_WITH_EXPIRED_WEBPUSH_INFO);
    });

    it("login(): forwards the password to createDevice as a bearer token", async () => {
        vi.mocked(webpush.createSubscription).mockResolvedValue(samplePushData);

        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: "server-public-key" }),
            jsonResponse({
                successful: true,
                data: { id: "device-1", secret: "shh" },
            }),
        ]);

        await login("hunter2");

        const createInit = fetchMock.mock.calls[1][1];
        expect(createInit.headers).toEqual({ Authorization: "Bearer hunter2" });
    });

    it("logoff(): clears the stored user, deletes the device on the server, and returns LOGGED_OUT", async () => {
        // Prime IndexedDB with a stored user record so logoff has
        // something to clean up.
        const db = await getDatabase();
        expect(db.name).toBe(DBNAME);
        await db.add("user", { id: "device-1", secret: "shh" });
        db.close();

        vi.mocked(webpush.deleteSubscription).mockResolvedValue(undefined);
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: "deleted" }),
        ]);

        const status = await logoff();

        expect(status).toBe(LoginStatus.LOGGED_OUT);
        expect(webpush.deleteSubscription).toHaveBeenCalledTimes(1);
        // DELETE /api/device/device-1 with the bearer secret.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/device/device-1");
        expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");

        // Re-open the DB and confirm the user store was cleared.
        const after = await getDatabase();
        const users = await after.getAll("user");
        after.close();
        expect(users).toEqual([]);
    });
});
