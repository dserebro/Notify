import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    checkIfDeviceExists,
    createDevice,
    deleteDevice,
    getVapidData,
    isPasswordProtected,
    updateDevice,
} from "../../src/services/apiservice";
import { parseResponse } from "../../src/types/apiresponse";
import type { WebPushData } from "../../src/types/webpushdata";

// The frontend's apiservice reads from `APIBASE` in `staticsettings.ts`.
// When tests run under Vitest `import.meta.env.VITE_API_BASE` is unset,
// so the default `/api` prefix is used — assertions below rely on that.
const API = "/api";

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

const samplePushData: WebPushData = {
    endpoint: "https://push.example.com/endpoint/abc",
    key: "a2V5",
    auth: "YXV0aA==",
};

describe("apiservice", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("isPasswordProtected GETs /keys/auth and unwraps the envelope", async () => {
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: true }),
        ]);

        const res = await isPasswordProtected();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API}/keys/auth`);
        expect(parseResponse(res)).toBe(true);
    });

    it("getVapidData GETs /keys and returns the public key string", async () => {
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: "pubkey" }),
        ]);

        const res = await getVapidData();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`${API}/keys`);
        expect(parseResponse(res)).toBe("pubkey");
    });

    it("createDevice POSTs /device with the web push data body", async () => {
        const fetchMock = installFetchMock([
            jsonResponse(
                { successful: true, data: { id: "d1", secret: "s1" } },
                200,
            ),
        ]);

        const [status, body] = await createDevice(samplePushData);

        expect(status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API}/device`);
        expect(init.method).toBe("POST");
        expect(init.headers).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({
            web_push_data: samplePushData,
        });
        expect(parseResponse(body)).toEqual({ id: "d1", secret: "s1" });
    });

    it("createDevice forwards the register token as a bearer header", async () => {
        const fetchMock = installFetchMock([
            jsonResponse(
                { successful: true, data: { id: "d1", secret: "s1" } },
                200,
            ),
        ]);

        await createDevice(samplePushData, "token-123");

        const init = fetchMock.mock.calls[0][1];
        expect(init.headers).toEqual({ Authorization: "Bearer token-123" });
    });

    it("createDevice surfaces 401 as the HTTP status for callers to branch on", async () => {
        installFetchMock([
            jsonResponse(
                {
                    successful: false,
                    error: { type: "auth_required", message: "login required" },
                },
                401,
            ),
        ]);

        const [status, body] = await createDevice(samplePushData);

        expect(status).toBe(401);
        // The error envelope is passed through unmodified. parseResponse
        // throws for non-success envelopes, which is how loginservice
        // detects the 401/password-required case.
        expect(() => parseResponse(body)).toThrow(/login required/);
    });

    it("checkIfDeviceExists GETs /device/{id} with a bearer header", async () => {
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: true }),
        ]);

        const res = await checkIfDeviceExists("device-1", "shh");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API}/device/device-1`);
        expect(init.method).toBeUndefined();
        expect(init.headers).toEqual({ Authorization: "Bearer shh" });
        expect(parseResponse(res)).toBe(true);
    });

    it("deleteDevice DELETEs /device/{id} with a bearer header", async () => {
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: "deleted" }),
        ]);

        const res = await deleteDevice("device-1", "shh");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API}/device/device-1`);
        expect(init.method).toBe("DELETE");
        expect(init.headers).toEqual({ Authorization: "Bearer shh" });
        expect(parseResponse(res)).toBe("deleted");
    });

    it("updateDevice PATCHes /device/{id} with the push data in the body", async () => {
        const fetchMock = installFetchMock([
            jsonResponse({ successful: true, data: undefined }),
        ]);

        await updateDevice("device-1", "shh", samplePushData);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API}/device/device-1`);
        expect(init.method).toBe("PATCH");
        expect(init.headers).toEqual({ Authorization: "Bearer shh" });
        expect(JSON.parse(init.body)).toEqual({
            web_push_data: samplePushData,
        });
    });
});
