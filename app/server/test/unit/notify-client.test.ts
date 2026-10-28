import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    notifyCommand,
    postNotification,
    resolveNotifyUrl,
} from "../../src/cli/notify-client.ts";

/**
 * `notify notify` client (port of `client/mod.ts`): endpoint resolution
 * from `--remote`, the Bearer header, the shared `Message` payload and
 * error-envelope extraction.
 */

type Call = { url: string; init: RequestInit };
let calls: Call[];
let nextResponse: () => Response;

beforeEach(() => {
    calls = [];
    nextResponse = () => new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return nextResponse();
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("resolveNotifyUrl", () => {
    it.each([
        ["http://localhost:8787", "http://localhost:8787/api/notify"],
        ["http://localhost:8787/", "http://localhost:8787/api/notify"],
        ["https://example.com/notify", "https://example.com/notify/api/notify"],
        [
            "https://example.com/notify/",
            "https://example.com/notify/api/notify",
        ],
        [
            "https://example.com/notify/api/notify",
            "https://example.com/notify/api/notify",
        ],
    ])("%s -> %s", (remote, expected) => {
        expect(resolveNotifyUrl(remote)).toBe(expected);
    });
});

describe("notifyCommand", () => {
    it("posts the shared Message shape with a Bearer key", async () => {
        await notifyCommand({
            title: "T",
            message: "M",
            icon: "https://example.com/i.png",
            tags: " a, b ,,c ",
            remote: "http://localhost:8787",
            key: "secret",
        });
        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call?.url).toBe("http://localhost:8787/api/notify");
        expect(call?.init.method).toBe("POST");
        const headers = call?.init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer secret");
        expect(headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(String(call?.init.body))).toEqual({
            title: "T",
            message: "M",
            icon: "https://example.com/i.png",
            tags: ["a", "b", "c"],
        });
        expect(process.stdout.write).toHaveBeenCalledWith(
            "Notification sent\n",
        );
    });

    it("omits Authorization, icon and tags when not given", async () => {
        await notifyCommand({
            title: "T",
            message: "M",
            remote: "http://localhost:8787",
        });
        const headers = calls[0]?.init.headers as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
            title: "T",
            message: "M",
        });
    });
});

describe("postNotification errors", () => {
    it("throws the API envelope's error message", async () => {
        nextResponse = () =>
            new Response(
                JSON.stringify({
                    successful: false,
                    error: { type: "auth_required", message: "bad key" },
                }),
                { status: 401, statusText: "Unauthorized" },
            );
        await expect(
            postNotification("http://h", { title: "t", message: "m" }),
        ).rejects.toThrow("notify failed (401): bad key");
    });

    it("falls back to statusText for a non-JSON body", async () => {
        nextResponse = () =>
            new Response("oops", { status: 502, statusText: "Bad Gateway" });
        await expect(
            postNotification("http://h", { title: "t", message: "m" }),
        ).rejects.toThrow("notify failed (502): Bad Gateway");
    });
});
