import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    TEST_PUSH_DATA,
    UNKNOWN_DEVICE_ID,
    WRONG_KEY,
} from "../fixtures/scenarios.ts";
import { bearer, type Harness, makeHarness } from "./helpers.ts";

/**
 * Device-auth error paths with the decision-13 fix:
 *   - unknown-device access returns 401 `auth_required` (not the legacy
 *     500 that leaked the "not found" exception);
 *   - a wrong secret returns 401;
 *   - a missing bearer returns 401.
 */

describe("device auth", () => {
    let harness: Harness;
    beforeEach(() => {
        harness = makeHarness();
    });
    afterEach(() => {
        harness.teardown();
    });

    async function registerDevice(): Promise<{ id: string; secret: string }> {
        const res = await harness.app.request("/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: TEST_PUSH_DATA }),
        });
        const body = (await res.json()) as {
            data: { id: string; secret: string };
        };
        return body.data;
    }

    const authRequired = {
        successful: false,
        error: {
            type: "auth_required",
            message: "Authorization header invalid",
        },
    };

    it("unknown device id -> 401 auth_required (decision-13 fix)", async () => {
        const res = await harness.app.request(
            `/api/device/${UNKNOWN_DEVICE_ID}`,
            { headers: bearer(WRONG_KEY) },
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual(authRequired);
    });

    it("existing device + wrong secret -> 401", async () => {
        const { id } = await registerDevice();
        const res = await harness.app.request(`/api/device/${id}`, {
            headers: bearer(WRONG_KEY),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual(authRequired);
    });

    it("existing device + missing bearer -> 401", async () => {
        const { id } = await registerDevice();
        const res = await harness.app.request(`/api/device/${id}`);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual(authRequired);
    });

    it("existing device + 'Basic' scheme -> 401", async () => {
        const { id, secret } = await registerDevice();
        const res = await harness.app.request(`/api/device/${id}`, {
            headers: { Authorization: `Basic ${secret}` },
        });
        expect(res.status).toBe(401);
    });

    it("existing device + lowercase bearer scheme is accepted", async () => {
        const { id, secret } = await registerDevice();
        const res = await harness.app.request(`/api/device/${id}`, {
            headers: { Authorization: `bearer ${secret}` },
        });
        expect(res.status).toBe(200);
    });

    it("PATCH on unknown device id -> 401", async () => {
        const res = await harness.app.request(
            `/api/device/${UNKNOWN_DEVICE_ID}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...bearer(WRONG_KEY),
                },
                body: JSON.stringify({ web_push_data: TEST_PUSH_DATA }),
            },
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual(authRequired);
    });

    it("DELETE on unknown device id -> 401", async () => {
        const res = await harness.app.request(
            `/api/device/${UNKNOWN_DEVICE_ID}`,
            { method: "DELETE", headers: bearer(WRONG_KEY) },
        );
        expect(res.status).toBe(401);
    });
});
