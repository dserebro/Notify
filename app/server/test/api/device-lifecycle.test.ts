import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_PUSH_DATA, TEST_PUSH_DATA_2 } from "../fixtures/scenarios.ts";
import { bearer, type Harness, makeHarness } from "./helpers.ts";

/**
 * Full lifecycle for a single device, with an emphasis on the
 * decision-13 fix: after a `PATCH /api/device/:id` the ORIGINAL secret
 * must still authenticate the device (the legacy backend overwrote the
 * stored secret with the raw Authorization header, so follow-up GETs
 * with the original secret returned 401).
 */

describe("device lifecycle", () => {
    let harness: Harness;
    beforeEach(() => {
        harness = makeHarness();
    });
    afterEach(() => {
        harness.teardown();
    });

    it("register -> check -> patch -> check with ORIGINAL secret -> delete -> gone", async () => {
        // Register
        const register = await harness.app.request("/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: TEST_PUSH_DATA }),
        });
        expect(register.status).toBe(200);
        const registerBody = (await register.json()) as {
            successful: true;
            data: { id: string; secret: string };
        };
        expect(registerBody.successful).toBe(true);
        expect(registerBody.data.id).toMatch(/^[0-9a-f]{32}$/);
        expect(registerBody.data.secret).toMatch(/^[0-9a-f]{32}$/);
        const { id, secret } = registerBody.data;

        // Check: exists:true
        const check1 = await harness.app.request(`/api/device/${id}`, {
            headers: bearer(secret),
        });
        expect(check1.status).toBe(200);
        expect(await check1.json()).toEqual({
            successful: true,
            data: { exists: true },
        });

        // Patch pushData
        const patched = await harness.app.request(`/api/device/${id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                ...bearer(secret),
            },
            body: JSON.stringify({ web_push_data: TEST_PUSH_DATA_2 }),
        });
        expect(patched.status).toBe(200);
        expect(await patched.json()).toEqual({ successful: true, data: true });

        // Decision-13 fix: the ORIGINAL secret must still authenticate.
        const check2 = await harness.app.request(`/api/device/${id}`, {
            headers: bearer(secret),
        });
        expect(check2.status).toBe(200);
        expect(await check2.json()).toEqual({
            successful: true,
            data: { exists: true },
        });

        // Repository reflects the new pushData.
        const stored = harness.repository.get(id);
        expect(stored?.pushData).toEqual(TEST_PUSH_DATA_2);
        expect(stored?.secret).toBe(secret);

        // Delete
        const deleted = await harness.app.request(`/api/device/${id}`, {
            method: "DELETE",
            headers: bearer(secret),
        });
        expect(deleted.status).toBe(200);
        expect(await deleted.json()).toEqual({ successful: true, data: true });

        // Follow-up GET returns the auth_required envelope (unknown
        // id -> 401, matching the decision-13 fix).
        const gone = await harness.app.request(`/api/device/${id}`, {
            headers: bearer(secret),
        });
        expect(gone.status).toBe(401);
        expect(await gone.json()).toEqual({
            successful: false,
            error: {
                type: "auth_required",
                message: "Authorization header invalid",
            },
        });
    });
});
