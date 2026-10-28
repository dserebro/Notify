import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../../src/logger.ts";
import {
    TEST_PUSH_DATA,
    TEST_PUSH_DATA_2,
    TEST_SENDKEY,
} from "../fixtures/scenarios.ts";
import { bearer, type Harness, makeHarness } from "./helpers.ts";

/**
 * `POST /api/notify` end-to-end: fan-out hits every registered device
 * endpoint, 410 responses delete the device, and the 2048-char payload
 * ceiling is enforced before fan-out.
 */

type FetchCall = { url: string; init: RequestInit | undefined };

describe("POST /api/notify", () => {
    let harness: Harness;
    let calls: FetchCall[];
    let statusByUrl: Map<string, number>;
    let throwForUrl: Set<string>;
    let warnings: { msg: string; meta?: Record<string, unknown> }[];

    beforeEach(() => {
        calls = [];
        statusByUrl = new Map();
        throwForUrl = new Set();
        warnings = [];
        const spyLogger: Logger = {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: (msg, meta) => warnings.push({ msg, meta }),
            error: () => {},
        };
        const stubFetch: typeof fetch = async (
            input: string | URL | Request,
            init?: RequestInit,
        ) => {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
            calls.push({ url, init });
            if (throwForUrl.has(url)) {
                throw new Error("network down");
            }
            const status = statusByUrl.get(url) ?? 201;
            return new Response(status === 204 ? null : "ok", { status });
        };
        harness = makeHarness({ fetch: stubFetch, logger: spyLogger });
    });

    afterEach(() => {
        harness.teardown();
    });

    async function registerDevice(pushData: {
        endpoint: string;
        key: string;
        auth: string;
    }): Promise<{ id: string }> {
        const res = await harness.app.request("/api/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_push_data: pushData }),
        });
        const body = (await res.json()) as { data: { id: string } };
        return body.data;
    }

    it("fans out to all devices on 201", async () => {
        const d1 = await registerDevice(TEST_PUSH_DATA);
        const d2 = await registerDevice(TEST_PUSH_DATA_2);

        const res = await harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer(TEST_SENDKEY),
            },
            body: JSON.stringify({ title: "t", message: "m" }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            successful: true,
            data: { message: "notified" },
        });
        expect(calls).toHaveLength(2);
        const urls = calls.map((c) => c.url);
        expect(urls).toContain(TEST_PUSH_DATA.endpoint);
        expect(urls).toContain(TEST_PUSH_DATA_2.endpoint);

        expect(harness.repository.exists(d1.id)).toBe(true);
        expect(harness.repository.exists(d2.id)).toBe(true);
    });

    it("deletes a device when its push endpoint returns 410", async () => {
        const d1 = await registerDevice(TEST_PUSH_DATA);
        const d2 = await registerDevice(TEST_PUSH_DATA_2);
        statusByUrl.set(TEST_PUSH_DATA.endpoint, 410);

        const res = await harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer(TEST_SENDKEY),
            },
            body: JSON.stringify({ title: "t", message: "m" }),
        });
        expect(res.status).toBe(200);
        expect(harness.repository.exists(d1.id)).toBe(false);
        expect(harness.repository.exists(d2.id)).toBe(true);
    });

    async function notify(): Promise<Response> {
        return harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer(TEST_SENDKEY),
            },
            body: JSON.stringify({ title: "t", message: "m" }),
        });
    }

    const NOTIFIED = { successful: true, data: { message: "notified" } };

    it("deletes a device when its push endpoint returns 404", async () => {
        const d1 = await registerDevice(TEST_PUSH_DATA);
        const d2 = await registerDevice(TEST_PUSH_DATA_2);
        statusByUrl.set(TEST_PUSH_DATA.endpoint, 404);

        const res = await notify();
        expect(res.status).toBe(200);
        expect(harness.repository.exists(d1.id)).toBe(false);
        expect(harness.repository.exists(d2.id)).toBe(true);
    });

    // Decision-13 regression: per-device push failures are logged but
    // never surface in the API response.
    it("logs a push failure on a 500 without exposing it", async () => {
        const d1 = await registerDevice(TEST_PUSH_DATA);
        const d2 = await registerDevice(TEST_PUSH_DATA_2);
        statusByUrl.set(TEST_PUSH_DATA.endpoint, 500);

        const res = await notify();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(NOTIFIED);
        expect(warnings).toContainEqual({
            msg: "push failed",
            meta: expect.objectContaining({ id: d1.id, status: 500 }),
        });
        expect(harness.repository.exists(d1.id)).toBe(true);
        expect(harness.repository.exists(d2.id)).toBe(true);
    });

    it("logs a push failure when fetch throws without exposing it", async () => {
        const d1 = await registerDevice(TEST_PUSH_DATA);
        throwForUrl.add(TEST_PUSH_DATA.endpoint);

        const res = await notify();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(NOTIFIED);
        expect(warnings).toContainEqual({
            msg: "push failed",
            meta: expect.objectContaining({
                id: d1.id,
                error: "network down",
            }),
        });
        expect(harness.repository.exists(d1.id)).toBe(true);
    });

    it("logs an unexpected per-device rejection without exposing it", async () => {
        await registerDevice(TEST_PUSH_DATA);
        statusByUrl.set(TEST_PUSH_DATA.endpoint, 410);
        harness.repository.delete = () => {
            throw new Error("db locked");
        };

        const res = await notify();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(NOTIFIED);
        expect(warnings).toContainEqual({
            msg: "push failed",
            meta: { error: "db locked" },
        });
    });

    it("rejects an oversized body with invalid_data", async () => {
        const message = "m".repeat(3000);
        const res = await harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer(TEST_SENDKEY),
            },
            body: JSON.stringify({ title: "t", message }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
            successful: false;
            error: { type: string };
        };
        expect(body.successful).toBe(false);
        expect(body.error.type).toBe("invalid_data");
        expect(calls).toHaveLength(0);
    });

    it("rejects when the SENDKEY bearer is wrong", async () => {
        const res = await harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer("wrong-sendkey"),
            },
            body: JSON.stringify({ title: "t", message: "m" }),
        });
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
    });
});
