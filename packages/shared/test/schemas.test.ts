import { describe, expect, it } from "vitest";
import {
    ApiResponseSchema,
    DeviceSchema,
    failure,
    isSuccess,
    success,
    WebPushDataSchema,
} from "../src/index.ts";

const pushData = {
    endpoint: "https://push.example.com/abc",
    key: "BOr7Zr0vZ6Rp1Q==",
    auth: "c2VjcmV0",
};

describe("WebPushDataSchema", () => {
    it("accepts a valid subscription", () => {
        expect(WebPushDataSchema.safeParse(pushData).success).toBe(true);
    });

    it.each([
        ["non-URL endpoint", { ...pushData, endpoint: "nope" }],
        ["non-base64 key", { ...pushData, key: "not base64!" }],
        ["non-base64 auth", { ...pushData, auth: "@@@" }],
        ["over-long key", { ...pushData, key: "A".repeat(516) }],
    ])("rejects %s", (_label, input) => {
        expect(WebPushDataSchema.safeParse(input).success).toBe(false);
    });
});

describe("DeviceSchema", () => {
    const device = {
        id: "a".repeat(32),
        secret: "b".repeat(32),
        pushData,
        createdAt: 1,
        updatedAt: 2,
    };

    it("accepts a valid device", () => {
        expect(DeviceSchema.safeParse(device).success).toBe(true);
    });

    it.each([
        ["short id", { ...device, id: "a".repeat(31) }],
        [
            "legacy 'Bearer ' secret",
            { ...device, secret: `Bearer ${"b".repeat(32)}` },
        ],
        ["negative timestamp", { ...device, createdAt: -1 }],
        ["invalid pushData", { ...device, pushData: { endpoint: "x" } }],
    ])("rejects %s", (_label, input) => {
        expect(DeviceSchema.safeParse(input).success).toBe(false);
    });
});

describe("api-response helpers", () => {
    it("success() and failure() build the envelopes", () => {
        expect(success({ id: 1 })).toEqual({
            successful: true,
            data: { id: 1 },
        });
        expect(failure("auth_required", "nope")).toEqual({
            successful: false,
            error: { type: "auth_required", message: "nope" },
        });
    });

    it("isSuccess() narrows on `successful`", () => {
        expect(isSuccess(success(true))).toBe(true);
        expect(isSuccess(failure("internal_error", "x"))).toBe(false);
    });

    it("ApiResponseSchema validates both envelope shapes", () => {
        expect(ApiResponseSchema.safeParse(success(1)).success).toBe(true);
        expect(
            ApiResponseSchema.safeParse(failure("not_found", "x")).success,
        ).toBe(true);
        expect(
            ApiResponseSchema.safeParse({
                successful: false,
                error: { type: "bogus", message: "x" },
            }).success,
        ).toBe(false);
    });
});
