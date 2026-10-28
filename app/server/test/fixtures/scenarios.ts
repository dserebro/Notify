/**
 * Characterization scenarios for the Notify HTTP API.
 *
 * This module is the single source of truth for the request sequences that
 * were recorded against the legacy Deno/Oak backend (`record.ts`) and that the
 * Node/Hono contract tests replay in-process via `app.request()`.
 *
 * - A scenario GROUP needs one specific server configuration (LOGINKEY and
 *   SENDKEY set or unset). Each group is recorded into `<group>.json` next to
 *   this file, against a fresh, empty device database.
 * - A SCENARIO is an ordered list of steps. Variables captured by a step (for
 *   example the id/secret of a registered device) are visible to the later
 *   steps of the same scenario. Scenarios of a group run in order against the
 *   same server, so state (registered devices) accumulates across scenarios.
 * - Placeholders `{{NAME}}` are substituted in the path, header values and
 *   string values of the JSON body. Config placeholders: `{{SENDKEY}}`,
 *   `{{LOGINKEY}}`; captured placeholders: e.g. `{{device.id}}`,
 *   `{{device.secret}}`.
 * - Dynamic response values are replaced by matchers (`<id32>`, `<secret32>`,
 *   `<base64url>`, `<string>`, `<any>`) in the recorded fixtures.
 * - Steps that capture a decision-13 defect carry `legacyDefect` (the reason)
 *   and `corrected` (what the new server must return instead).
 *
 * Plain, erasable TypeScript only (no enums/namespaces/parameter properties),
 * no runtime-specific APIs, so it runs under `node --experimental-strip-types`,
 * tsx and Vitest alike.
 */

/* ------------------------------------------------------------------------ */
/* Test-only configuration                                                   */
/* ------------------------------------------------------------------------ */

/**
 * TEST FIXTURE KEYS — throwaway values generated solely for recording and
 * replaying these fixtures. They are not used by any real deployment and are
 * intentionally committed. Never use them outside of tests.
 */
export const TEST_VAPID_KEY =
    "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwiYWxnIjoiRVMyNTYiLCJ4IjoidC1jaVJNMWtKQVZFcWR0ZmVzaHFvY3FrSmRHMHRFeDFqcllWSEk3YUlTZyIsInkiOiJwNmZzbDRGU2tMQVJTY1R4TG1EalN4QU4yYmVid0ZmLW1QWHh1RzdzLXJzIiwiZCI6Ikt1NlNzVVoxTTRrbVpzNmJjZGRyXzlGR1RqTTN0UDVfUTB6ODFXbE1kdUEiLCJrZXlfb3BzIjpbInNpZ24iXSwiZXh0Ijp0cnVlfQ==";
/** Public key served by `GET /api/keys` for TEST_VAPID_KEY (base64url). */
export const TEST_VAPID_PUBLIC_KEY =
    "BLfnIkTNZCQFRKnbX3rIaqHKpCXRtLRMdY62FRyO2iEop6fsl4FSkLARScTxLmDjSxAN2bebwFf-mPXxuG7s-rs";
export const TEST_SUB = "mailto:test@example.com";
export const TEST_SENDKEY = "test-fixture-sendkey-3b9f0c1e7a";
export const TEST_LOGINKEY = "test-fixture-loginkey-5d2a8e4f61";
/** Bearer token that is never a valid key/secret in any group. */
export const WRONG_KEY = "test-fixture-wrong-key-000000000";
/** A well-formed (32 lowercase hex) device id that is never registered. */
export const UNKNOWN_DEVICE_ID = "0123456789abcdef0123456789abcdef";

/**
 * Push subscriptions used for registered devices. Real P-256 public keys and
 * 16-byte auth secrets (so encryption succeeds), but every endpoint points at
 * the closed local port 9: no push message can ever be delivered anywhere.
 */
export const TEST_PUSH_DATA = {
    endpoint: "http://127.0.0.1:9/notify-fixture/device-1",
    key: "BLk+xYVGJ7Uew15f7riD2YOhRklJSkrqirpEzQP9zd9ctk2GUAh3H2B4RZsV4hwT3RiKv4saWq0VeV81ErZsw1M=",
    auth: "oyKCFMzRZ5qIBsIqU9b9kQ==",
} as const;
export const TEST_PUSH_DATA_2 = {
    endpoint: "http://127.0.0.1:9/notify-fixture/device-2",
    key: "BEKyjDj7o0ZWNw6cBvi0JSGahbNu1tG7do1ijxcwyYGqtP98whntXan4hBr8/1cglZ8QbpgE5eegossre0eBfSM=",
    auth: "mVhWv5rCcws/k/a2YXOHrw==",
} as const;
export const TEST_PUSH_DATA_3 = {
    endpoint: "http://127.0.0.1:9/notify-fixture/device-3",
    key: "BBlYZIHvC5gHXFCF7UofsaV2FS8fuemacPX+9L3DyZ26JQh9FDiOJfgZtaV9z7MzQnlNGwb9eXqnOz8gMyiR5OI=",
    auth: "AnNpPBuvrijw7VPipmNpWw==",
} as const;

/* ------------------------------------------------------------------------ */
/* DSL types                                                                 */
/* ------------------------------------------------------------------------ */

export type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "OPTIONS";

/** Server configuration a group is recorded/replayed with. */
export interface GroupConfig {
    /** base64(JWK) VAPID private key (env VAPID_KEY). */
    vapidKey: string;
    /** VAPID subject (env SUB). */
    sub: string;
    /** env SENDKEY; null = unset (notify is open). */
    sendkey: string | null;
    /** env LOGINKEY; null = unset (device registration is open). */
    loginkey: string | null;
    /** env CORS. */
    cors: boolean;
}

export interface StepRequest {
    method: HttpMethod;
    /** Path incl. query, may contain placeholders. */
    path: string;
    /** Header values may contain placeholders. */
    headers?: Record<string, string>;
    /**
     * JSON body (serialized with JSON.stringify; `Content-Type:
     * application/json` is added unless a content-type header is given).
     */
    json?: unknown;
    /** Raw body sent verbatim (for malformed JSON cases). */
    rawBody?: string;
}

/** Placeholder-free matcher tokens usable anywhere in an expected body. */
export type Matcher =
    | "<id32>"
    | "<secret32>"
    | "<hex32>"
    | "<base64url>"
    | "<string>"
    | "<any>";

export interface Capture {
    /** Dot path into the JSON response body, e.g. `data.id`. */
    from: string;
    /** Variable name, referenced later as `{{as}}`. */
    as: string;
    /** Matcher that replaces the captured value in the recorded fixture. */
    matcher: Matcher;
}

/**
 * Which parts of the response are compared on replay.
 * - `full`: status, content-type, cache-control and body (default)
 * - `status+contentType`: status and content-type only
 * - `status`: status only (used for framework-generated responses such as
 *   Oak's empty 404/405 bodies where only the status is contractual)
 *
 * The mode applies to the recorded legacy `response` only. A `corrected`
 * expectation (legacy-defect steps) is always compared with `full`.
 * Content-type values are compared case-insensitively.
 */
export type CompareMode = "full" | "status+contentType" | "status";

/** An expected response (used for recorded and corrected expectations). */
export interface ExpectedResponse {
    status: number;
    /** Full content-type header value, null when absent. */
    contentType: string | null;
    /** Cache-control header value, null when absent. */
    cacheControl: string | null;
    /** Parsed JSON body (with matchers) when the response is JSON. */
    body?: unknown;
    /** Text marker / verbatim short text when the response is not JSON. */
    text?: string;
}

export interface Step {
    name: string;
    description?: string;
    request: StepRequest;
    capture?: Capture[];
    compare?: CompareMode;
    /** Reason, when the recorded legacy response is a decision-13 defect. */
    legacyDefect?: string;
    /** The response the new server must produce instead (with matchers). */
    corrected?: ExpectedResponse;
    /** Free-form remark about surprising but preserved legacy behavior. */
    note?: string;
}

export interface Scenario {
    name: string;
    description: string;
    steps: Step[];
}

export interface ScenarioGroup {
    name: string;
    description: string;
    config: GroupConfig;
    scenarios: Scenario[];
}

/* ------------------------------------------------------------------------ */
/* Recorded fixture file format (<group>.json)                               */
/* ------------------------------------------------------------------------ */

export interface RecordedStep {
    name: string;
    description?: string;
    /** Request template exactly as sent, with placeholders unresolved. */
    request: {
        method: HttpMethod;
        path: string;
        headers: Record<string, string>;
        json?: unknown;
        rawBody?: string;
    };
    capture?: Capture[];
    compare: CompareMode;
    /** Legacy response with dynamic values replaced by matchers. */
    response: ExpectedResponse;
    legacyDefect?: string;
    corrected?: ExpectedResponse;
    note?: string;
}

export interface FixtureFile {
    group: string;
    description: string;
    recordedWith: {
        server: string;
        runtime: string;
        recordedAt: string;
    };
    /** Server config used for recording (TEST keys only). */
    config: GroupConfig;
    scenarios: Array<{
        name: string;
        description: string;
        steps: RecordedStep[];
    }>;
}

/* ------------------------------------------------------------------------ */
/* Helpers shared by recorder and replayer                                   */
/* ------------------------------------------------------------------------ */

export type Vars = Record<string, string>;

/** Initial variables for a group: config keys plus fixed test values. */
export function configVars(config: GroupConfig): Vars {
    const vars: Vars = {
        WRONG_KEY,
        UNKNOWN_DEVICE_ID,
    };
    if (config.sendkey !== null) vars.SENDKEY = config.sendkey;
    if (config.loginkey !== null) vars.LOGINKEY = config.loginkey;
    return vars;
}

const PLACEHOLDER = /\{\{([A-Za-z0-9_.]+)\}\}/g;

/** Replace `{{name}}` placeholders in a string; unknown names throw. */
export function substituteString(template: string, vars: Vars): string {
    return template.replace(PLACEHOLDER, (_m, name: string) => {
        const value = vars[name];
        if (value === undefined) {
            throw new Error(`Unknown placeholder {{${name}}}`);
        }
        return value;
    });
}

/** Deeply substitute placeholders in all string values of a JSON value. */
export function substitute(value: unknown, vars: Vars): unknown {
    if (typeof value === "string") return substituteString(value, vars);
    if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = substitute(v, vars);
        }
        return out;
    }
    return value;
}

/** Request headers incl. the implicit JSON content-type (unresolved). */
export function templateHeaders(req: StepRequest): Record<string, string> {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    const hasContentType = Object.keys(headers).some(
        (h) => h.toLowerCase() === "content-type",
    );
    if (req.json !== undefined && !hasContentType) {
        headers["Content-Type"] = "application/json";
    }
    return headers;
}

export interface ResolvedRequest {
    method: HttpMethod;
    path: string;
    headers: Record<string, string>;
    body?: string;
}

/** Build the concrete request for a step (placeholders resolved). */
export function resolveRequest(req: StepRequest, vars: Vars): ResolvedRequest {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(templateHeaders(req))) {
        headers[k] = substituteString(v, vars);
    }
    let body: string | undefined;
    if (req.json !== undefined) {
        body = JSON.stringify(substitute(req.json, vars));
    } else if (req.rawBody !== undefined) {
        body = substituteString(req.rawBody, vars);
    }
    return {
        method: req.method,
        path: substituteString(req.path, vars),
        headers,
        body,
    };
}

/** Read a dot path (`data.id`) from a JSON value. */
export function getPath(value: unknown, path: string): unknown {
    let cur: unknown = value;
    for (const part of path.split(".")) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

/** Apply the step's captures to `vars`; returns value→matcher pairs. */
export function applyCaptures(
    captures: Capture[] | undefined,
    body: unknown,
    vars: Vars,
): void {
    for (const c of captures ?? []) {
        const value = getPath(body, c.from);
        if (typeof value !== "string") {
            throw new Error(
                `Capture ${c.as}: ${c.from} is not a string in response`,
            );
        }
        vars[c.as] = value;
        vars[`${c.as}#matcher`] = c.matcher;
    }
}

/**
 * Replace string values that equal a captured variable by that variable's
 * matcher (captures register `<name>#matcher` entries in vars).
 */
export function normalizeBody(body: unknown, vars: Vars): unknown {
    if (typeof body === "string") {
        for (const [name, value] of Object.entries(vars)) {
            if (name.endsWith("#matcher")) continue;
            const matcher = vars[`${name}#matcher`];
            if (matcher && value === body) return matcher;
        }
        return body;
    }
    if (Array.isArray(body)) return body.map((v) => normalizeBody(v, vars));
    if (body !== null && typeof body === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body)) {
            out[k] = normalizeBody(v, vars);
        }
        return out;
    }
    return body;
}

const MATCHERS: Record<Matcher, (v: unknown) => boolean> = {
    "<id32>": (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v),
    "<secret32>": (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v),
    "<hex32>": (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v),
    "<base64url>": (v) => typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v),
    "<string>": (v) => typeof v === "string",
    "<any>": () => true,
};

export function isMatcher(value: unknown): value is Matcher {
    return typeof value === "string" && value in MATCHERS;
}

/**
 * Compare an actual JSON value with an expected value that may contain
 * matcher tokens. Returns a list of human-readable mismatches (empty = ok).
 */
export function diffJson(
    expected: unknown,
    actual: unknown,
    path = "$",
): string[] {
    if (isMatcher(expected)) {
        return MATCHERS[expected](actual)
            ? []
            : [`${path}: ${JSON.stringify(actual)} does not match ${expected}`];
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) {
            return [`${path}: expected array, got ${JSON.stringify(actual)}`];
        }
        if (expected.length !== actual.length) {
            return [
                `${path}: expected length ${expected.length}, got ${actual.length}`,
            ];
        }
        return expected.flatMap((e, i) =>
            diffJson(e, actual[i], `${path}[${i}]`),
        );
    }
    if (expected !== null && typeof expected === "object") {
        if (
            actual === null ||
            typeof actual !== "object" ||
            Array.isArray(actual)
        ) {
            return [`${path}: expected object, got ${JSON.stringify(actual)}`];
        }
        const e = expected as Record<string, unknown>;
        const a = actual as Record<string, unknown>;
        const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
        return [...keys].flatMap((k) =>
            k in e
                ? k in a
                    ? diffJson(e[k], a[k], `${path}.${k}`)
                    : [`${path}.${k}: missing`]
                : [`${path}.${k}: unexpected`],
        );
    }
    return Object.is(expected, actual)
        ? []
        : [
              `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          ];
}

/** Compare an actual response against an expectation under a compare mode. */
export function diffResponse(
    expected: ExpectedResponse,
    actual: ExpectedResponse,
    mode: CompareMode,
): string[] {
    const out: string[] = [];
    if (expected.status !== actual.status) {
        out.push(`status: expected ${expected.status}, got ${actual.status}`);
    }
    if (mode === "status") return out;
    if (
        expected.contentType?.toLowerCase() !==
        actual.contentType?.toLowerCase()
    ) {
        out.push(
            `content-type: expected ${expected.contentType}, got ${actual.contentType}`,
        );
    }
    if (mode === "status+contentType") return out;
    if (expected.cacheControl !== actual.cacheControl) {
        out.push(
            `cache-control: expected ${expected.cacheControl}, got ${actual.cacheControl}`,
        );
    }
    if (expected.body !== undefined) {
        out.push(...diffJson(expected.body, actual.body, "body"));
    } else if (expected.text !== undefined && expected.text !== actual.text) {
        out.push(
            `text: expected ${JSON.stringify(expected.text)}, got ${JSON.stringify(actual.text)}`,
        );
    }
    return out;
}

/* ------------------------------------------------------------------------ */
/* Expectation builders                                                      */
/* ------------------------------------------------------------------------ */

function jsonResponse(status: number, body: unknown): ExpectedResponse {
    return {
        status,
        contentType: "application/json",
        cacheControl: "no-cache",
        body,
    };
}

const AUTH_REQUIRED = jsonResponse(401, {
    successful: false,
    error: { type: "auth_required", message: "Authorization header invalid" },
});

const INVALID_JSON_CORRECTED = jsonResponse(400, {
    successful: false,
    error: { type: "invalid_data", message: "<string>" },
});

const DEFECT_UNKNOWN_DEVICE =
    "validateDeviceSecret lets databaseGetDevice's 'not found' exception " +
    "escape as an Oak 500 text/plain response (decision 13: must be 401 " +
    "auth_required)";

const DEFECT_PATCH_SECRET =
    "PATCH /api/device/:id persists the whole Authorization header " +
    "('Bearer <secret>') as the new secret, so the original secret no " +
    "longer authenticates (decision 13: PATCH keeps the existing secret)";

const DEFECT_BAD_JSON =
    "a request body that is not a JSON object (malformed JSON / empty / " +
    "null) escapes as 500 internal_error leaking the parser message " +
    "(decision 13 status codes: invalid data is 400)";

/* ------------------------------------------------------------------------ */
/* Step builders                                                             */
/* ------------------------------------------------------------------------ */

function bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

const DEVICE_CAPTURE = (prefix: string): Capture[] => [
    { from: "data.id", as: `${prefix}.id`, matcher: "<id32>" },
    { from: "data.secret", as: `${prefix}.secret`, matcher: "<secret32>" },
];

function registerStep(
    prefix: string,
    pushData: unknown,
    headers: Record<string, string> = {},
): Step {
    return {
        name: `register ${prefix}`,
        request: {
            method: "POST",
            path: "/api/device",
            headers,
            json: { web_push_data: pushData },
        },
        capture: DEVICE_CAPTURE(prefix),
    };
}

/** POST /api/device with invalid web_push_data (expects 400). */
function invalidRegistration(
    name: string,
    body: unknown,
    headers: Record<string, string> = {},
): Step {
    return {
        name,
        request: { method: "POST", path: "/api/device", headers, json: body },
    };
}

function notifyStep(
    name: string,
    json: unknown,
    headers: Record<string, string>,
    extra: Partial<Step> = {},
): Step {
    return {
        name,
        request: { method: "POST", path: "/api/notify", headers, json },
        ...extra,
    };
}

const repeat = (ch: string, n: number): string => ch.repeat(n);

/* ------------------------------------------------------------------------ */
/* Reusable scenarios                                                        */
/* ------------------------------------------------------------------------ */

function keysScenario(): Scenario {
    return {
        name: "keys",
        description: "GET /api/keys and GET /api/keys/auth (never protected)",
        steps: [
            {
                name: "GET /api/keys returns the VAPID public key",
                request: { method: "GET", path: "/api/keys" },
            },
            {
                name: "GET /api/keys ignores a wrong bearer",
                request: {
                    method: "GET",
                    path: "/api/keys",
                    headers: bearer("{{WRONG_KEY}}"),
                },
            },
            {
                name: "GET /api/keys/ (trailing slash)",
                request: { method: "GET", path: "/api/keys/" },
            },
            {
                name: "GET /api/keys/auth reports whether LOGINKEY is set",
                request: { method: "GET", path: "/api/keys/auth" },
            },
        ],
    };
}

/**
 * Validation failures of POST /api/device. `auth` = headers that pass the
 * registration auth of the group.
 */
function registrationValidationScenario(
    auth: Record<string, string>,
): Scenario {
    const ok = TEST_PUSH_DATA_3;
    return {
        name: "device-registration-validation",
        description:
            "POST /api/device with invalid or unusual web_push_data / bodies",
        steps: [
            invalidRegistration("empty object body", {}, auth),
            invalidRegistration(
                "web_push_data null",
                { web_push_data: null },
                auth,
            ),
            invalidRegistration(
                "web_push_data is a string",
                { web_push_data: "nope" },
                auth,
            ),
            invalidRegistration(
                "endpoint is not a URL",
                { web_push_data: { ...ok, endpoint: "not-a-url" } },
                auth,
            ),
            invalidRegistration(
                "endpoint longer than 1024 chars",
                {
                    web_push_data: {
                        ...ok,
                        endpoint: `http://127.0.0.1:9/${repeat("e", 1010)}`,
                    },
                },
                auth,
            ),
            invalidRegistration(
                "missing endpoint",
                { web_push_data: { key: ok.key, auth: ok.auth } },
                auth,
            ),
            invalidRegistration(
                "missing key",
                { web_push_data: { endpoint: ok.endpoint, auth: ok.auth } },
                auth,
            ),
            invalidRegistration(
                "missing auth",
                { web_push_data: { endpoint: ok.endpoint, key: ok.key } },
                auth,
            ),
            invalidRegistration(
                "key is not base64",
                { web_push_data: { ...ok, key: "not base64!" } },
                auth,
            ),
            invalidRegistration(
                "key is base64url (not standard base64)",
                { web_push_data: { ...ok, key: "ab-_" } },
                auth,
            ),
            invalidRegistration(
                "key longer than 512 chars",
                { web_push_data: { ...ok, key: repeat("A", 516) } },
                auth,
            ),
            invalidRegistration(
                "auth is not base64",
                { web_push_data: { ...ok, auth: "x" } },
                auth,
            ),
            invalidRegistration(
                "auth longer than 256 chars",
                { web_push_data: { ...ok, auth: repeat("A", 260) } },
                auth,
            ),
            invalidRegistration(
                "key is a number",
                { web_push_data: { ...ok, key: 42 } },
                auth,
            ),
            {
                name: "malformed JSON body",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: { ...auth, "Content-Type": "application/json" },
                    rawBody: "{not json",
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_BAD_JSON,
                corrected: INVALID_JSON_CORRECTED,
            },
            {
                name: "no body at all",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: auth,
                },
                legacyDefect: DEFECT_BAD_JSON,
                corrected: INVALID_JSON_CORRECTED,
            },
            {
                name: "JSON null body",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: { ...auth, "Content-Type": "application/json" },
                    rawBody: "null",
                },
                legacyDefect: DEFECT_BAD_JSON,
                corrected: INVALID_JSON_CORRECTED,
            },
            {
                name: "empty key and auth strings are accepted",
                note: "the legacy base64 regex matches the empty string",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: auth,
                    json: {
                        web_push_data: { ...ok, key: "", auth: "" },
                    },
                },
                capture: DEVICE_CAPTURE("emptykeys"),
            },
            {
                name: "unknown extra fields are ignored",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: auth,
                    json: {
                        web_push_data: { ...ok, expirationTime: null },
                        extra: "ignored",
                    },
                },
                capture: DEVICE_CAPTURE("extra"),
            },
            {
                name: "cleanup: delete empty-keys device",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{emptykeys.id}}",
                    headers: bearer("{{emptykeys.secret}}"),
                },
            },
            {
                name: "cleanup: delete extra-fields device",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{extra.id}}",
                    headers: bearer("{{extra.secret}}"),
                },
            },
        ],
    };
}

/** Full device lifecycle: register, read, auth failures, delete. */
function deviceLifecycleScenario(auth: Record<string, string>): Scenario {
    return {
        name: "device-lifecycle",
        description:
            "register → GET (auth variants) → DELETE (auth variants) → " +
            "access after delete",
        steps: [
            registerStep("device", TEST_PUSH_DATA, auth),
            registerStep("other", TEST_PUSH_DATA_2, auth),
            {
                name: "GET with device secret",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                },
            },
            {
                name: "GET with lowercase 'bearer' scheme",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: { Authorization: "bearer {{device.secret}}" },
                },
            },
            {
                name: "GET without Authorization",
                request: { method: "GET", path: "/api/device/{{device.id}}" },
            },
            {
                name: "GET with wrong bearer",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{WRONG_KEY}}"),
                },
            },
            {
                name: "GET with another device's secret",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{other.secret}}"),
                },
            },
            {
                name: "GET with Basic scheme",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: { Authorization: "Basic {{device.secret}}" },
                },
            },
            {
                name: "GET with 'Bearer' and no token",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: { Authorization: "Bearer" },
                },
            },
            {
                name: "GET with secret without scheme",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: { Authorization: "{{device.secret}}" },
                },
            },
            {
                name: "GET with the device id as bearer",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: { Authorization: "Bearer {{device.id}}" },
                },
            },
            {
                name: "DELETE without Authorization",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{device.id}}",
                },
            },
            {
                name: "DELETE with wrong bearer",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{WRONG_KEY}}"),
                },
            },
            {
                name: "DELETE with another device's secret",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{other.secret}}"),
                },
            },
            {
                name: "device still exists after rejected DELETEs",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                },
            },
            {
                name: "DELETE with device secret",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                },
            },
            {
                name: "GET deleted device with its old secret",
                request: {
                    method: "GET",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_UNKNOWN_DEVICE,
                corrected: AUTH_REQUIRED,
            },
            {
                name: "DELETE deleted device again",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_UNKNOWN_DEVICE,
                corrected: AUTH_REQUIRED,
            },
            {
                name: "PATCH deleted device",
                request: {
                    method: "PATCH",
                    path: "/api/device/{{device.id}}",
                    headers: bearer("{{device.secret}}"),
                    json: { web_push_data: TEST_PUSH_DATA },
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_UNKNOWN_DEVICE,
                corrected: AUTH_REQUIRED,
            },
            {
                name: "other device unaffected",
                request: {
                    method: "GET",
                    path: "/api/device/{{other.id}}",
                    headers: bearer("{{other.secret}}"),
                },
            },
            {
                name: "cleanup: delete other device",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{other.id}}",
                    headers: bearer("{{other.secret}}"),
                },
            },
        ],
    };
}

function devicePatchScenario(auth: Record<string, string>): Scenario {
    const path = "/api/device/{{patched.id}}";
    return {
        name: "device-patch",
        description:
            "PATCH /api/device/:id: auth, validation, success and the " +
            "secret-corruption defect",
        steps: [
            registerStep("patched", TEST_PUSH_DATA, auth),
            {
                name: "PATCH without Authorization",
                request: {
                    method: "PATCH",
                    path,
                    json: { web_push_data: TEST_PUSH_DATA_2 },
                },
            },
            {
                name: "PATCH with wrong bearer",
                request: {
                    method: "PATCH",
                    path,
                    headers: bearer("{{WRONG_KEY}}"),
                    json: { web_push_data: TEST_PUSH_DATA_2 },
                },
            },
            {
                name: "PATCH without auth and invalid data (auth first)",
                request: {
                    method: "PATCH",
                    path,
                    json: { web_push_data: { endpoint: "bad" } },
                },
            },
            {
                name: "PATCH with invalid web_push_data",
                request: {
                    method: "PATCH",
                    path,
                    headers: bearer("{{patched.secret}}"),
                    json: {
                        web_push_data: { endpoint: "bad", key: "x", auth: "y" },
                    },
                },
            },
            {
                name: "PATCH with missing web_push_data",
                request: {
                    method: "PATCH",
                    path,
                    headers: bearer("{{patched.secret}}"),
                    json: {},
                },
            },
            {
                name: "PATCH with malformed JSON",
                request: {
                    method: "PATCH",
                    path,
                    headers: {
                        ...bearer("{{patched.secret}}"),
                        "Content-Type": "application/json",
                    },
                    rawBody: "{not json",
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_BAD_JSON,
                corrected: INVALID_JSON_CORRECTED,
            },
            {
                name: "device still readable after rejected PATCHes",
                request: {
                    method: "GET",
                    path,
                    headers: bearer("{{patched.secret}}"),
                },
            },
            {
                name: "PATCH with valid web_push_data",
                request: {
                    method: "PATCH",
                    path,
                    headers: bearer("{{patched.secret}}"),
                    json: { web_push_data: TEST_PUSH_DATA_2 },
                },
            },
            {
                name: "GET with original secret after successful PATCH",
                request: {
                    method: "GET",
                    path,
                    headers: bearer("{{patched.secret}}"),
                },
                legacyDefect: DEFECT_PATCH_SECRET,
                corrected: jsonResponse(200, {
                    successful: true,
                    data: { exists: true },
                }),
            },
            {
                name: "second PATCH with original secret",
                request: {
                    method: "PATCH",
                    path,
                    headers: bearer("{{patched.secret}}"),
                    json: { web_push_data: TEST_PUSH_DATA },
                },
                legacyDefect: DEFECT_PATCH_SECRET,
                corrected: jsonResponse(200, { successful: true, data: true }),
            },
            {
                name: "DELETE with original secret after PATCH",
                request: {
                    method: "DELETE",
                    path,
                    headers: bearer("{{patched.secret}}"),
                },
                legacyDefect: DEFECT_PATCH_SECRET,
                corrected: jsonResponse(200, { successful: true, data: true }),
            },
            {
                name: "GET after DELETE attempt",
                note:
                    "legacy: device still exists but the secret no longer " +
                    "matches → 401; corrected: device deleted → 401. Both 401.",
                request: {
                    method: "GET",
                    path,
                    headers: bearer("{{patched.secret}}"),
                },
            },
        ],
    };
}

function unknownDeviceScenario(): Scenario {
    const unknown = "/api/device/{{UNKNOWN_DEVICE_ID}}";
    const defect = {
        compare: "status+contentType" as CompareMode,
        legacyDefect: DEFECT_UNKNOWN_DEVICE,
        corrected: AUTH_REQUIRED,
    };
    return {
        name: "device-unknown",
        description: "GET/PATCH/DELETE on device ids that do not exist",
        steps: [
            {
                name: "GET unknown device with a bearer",
                request: {
                    method: "GET",
                    path: unknown,
                    headers: bearer("{{WRONG_KEY}}"),
                },
                ...defect,
            },
            {
                name: "GET unknown device without Authorization",
                request: { method: "GET", path: unknown },
                ...defect,
            },
            {
                name: "PATCH unknown device",
                request: {
                    method: "PATCH",
                    path: unknown,
                    headers: bearer("{{WRONG_KEY}}"),
                    json: { web_push_data: TEST_PUSH_DATA },
                },
                ...defect,
            },
            {
                name: "DELETE unknown device",
                request: {
                    method: "DELETE",
                    path: unknown,
                    headers: bearer("{{WRONG_KEY}}"),
                },
                ...defect,
            },
            {
                name: "GET non-hex short device id",
                request: {
                    method: "GET",
                    path: "/api/device/not-a-device",
                    headers: bearer("{{WRONG_KEY}}"),
                },
                ...defect,
            },
        ],
    };
}

/** Message validation of POST /api/notify. `auth` passes notify auth. */
function notifyValidationScenario(auth: Record<string, string>): Scenario {
    const t1012 = repeat("t", 1012);
    return {
        name: "notify-validation",
        description: "POST /api/notify message validation and the 2048 limit",
        steps: [
            notifyStep("empty title", { title: "", message: "x" }, auth),
            notifyStep("empty message", { title: "x", message: "" }, auth),
            notifyStep("missing title", { message: "x" }, auth),
            notifyStep("missing message", { title: "x" }, auth),
            notifyStep("empty object", {}, auth),
            notifyStep("title is a number", { title: 1, message: "x" }, auth),
            notifyStep(
                "title longer than 1024 chars",
                { title: repeat("t", 1025), message: "x" },
                auth,
            ),
            notifyStep(
                "message longer than 1024 chars",
                { title: "x", message: repeat("m", 1025) },
                auth,
            ),
            notifyStep(
                "icon is not a URL",
                { title: "x", message: "y", icon: "not a url" },
                auth,
            ),
            notifyStep(
                "icon is a relative path",
                { title: "x", message: "y", icon: "/assets/icon.png" },
                auth,
            ),
            notifyStep(
                "icon longer than 1024 chars",
                {
                    title: "x",
                    message: "y",
                    icon: `https://example.com/${repeat("i", 1010)}`,
                },
                auth,
            ),
            notifyStep(
                "tags is not an array",
                { title: "x", message: "y", tags: "a,b" },
                auth,
            ),
            notifyStep(
                "tags contains an empty string",
                { title: "x", message: "y", tags: ["ok", ""] },
                auth,
            ),
            notifyStep(
                "tag longer than 256 chars",
                { title: "x", message: "y", tags: [repeat("g", 257)] },
                auth,
            ),
            notifyStep(
                "serialized message over 2048 (each field within limits)",
                {
                    title: repeat("a", 1000),
                    message: repeat("a", 1000),
                    tags: [repeat("b", 200)],
                },
                auth,
            ),
            notifyStep(
                "serialized message exactly 2049 chars",
                { title: t1012, message: repeat("m", 1012) },
                auth,
            ),
            notifyStep(
                "serialized message exactly 2048 chars is accepted",
                { title: t1012, message: repeat("m", 1011) },
                auth,
                {
                    note:
                        '{"title":"…","message":"…"} has 25 chars of JSON ' +
                        "syntax: 25 + 1012 + 1011 = 2048",
                },
            ),
            notifyStep(
                "non-ASCII: 2048 limit counts UTF-16 units, not bytes",
                { title: repeat("é", 1000), message: repeat("€", 1000) },
                auth,
                {
                    note:
                        "~2024 UTF-16 code units but ~5000 UTF-8 bytes; the " +
                        "legacy check is JSON.stringify(msg).length > 2048",
                },
            ),
            notifyStep(
                "unknown fields are stripped before the size check",
                { title: "x", message: "y", extra: repeat("z", 3000) },
                auth,
            ),
            notifyStep(
                "valid icon URL and tags",
                {
                    title: "Fixture",
                    message: "with icon and tags",
                    icon: "https://example.com/icon.png",
                    tags: ["one", "two"],
                },
                auth,
            ),
            notifyStep(
                "javascript: URL is accepted as icon",
                { title: "x", message: "y", icon: "javascript:alert(1)" },
                auth,
                { note: "zod 3 .url() accepts any scheme parseable by URL" },
            ),
            notifyStep(
                "empty tags array",
                { title: "x", message: "y", tags: [] },
                auth,
            ),
            {
                name: "malformed JSON",
                request: {
                    method: "POST",
                    path: "/api/notify",
                    headers: { ...auth, "Content-Type": "application/json" },
                    rawBody: "{not json",
                },
                compare: "status+contentType",
                legacyDefect: DEFECT_BAD_JSON,
                corrected: INVALID_JSON_CORRECTED,
            },
            {
                name: "no body",
                request: { method: "POST", path: "/api/notify", headers: auth },
            },
            {
                name: "JSON without content-type header",
                request: {
                    method: "POST",
                    path: "/api/notify",
                    headers: auth,
                    rawBody: '{"title":"no content-type","message":"x"}',
                },
            },
        ],
    };
}

function notifyWithDeviceScenario(
    registerAuth: Record<string, string>,
    notifyAuth: Record<string, string>,
): Scenario {
    return {
        name: "notify-with-device",
        description:
            "notify fan-out to a registered device whose push endpoint is a " +
            "closed local port (push fails with a network error)",
        steps: [
            registerStep("pushdev", TEST_PUSH_DATA, registerAuth),
            notifyStep(
                "notify with a registered (unreachable) device",
                { title: "Fixture", message: "fan-out", tags: ["fixture"] },
                notifyAuth,
                {
                    note:
                        "per-device push failures are swallowed; the response " +
                        "is still 200 notified",
                },
            ),
            {
                name: "device kept after a network push failure",
                note:
                    "only 400/401/404/410 push responses delete a device; a " +
                    "network error keeps it",
                request: {
                    method: "GET",
                    path: "/api/device/{{pushdev.id}}",
                    headers: bearer("{{pushdev.secret}}"),
                },
            },
            {
                name: "cleanup: delete push device",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{pushdev.id}}",
                    headers: bearer("{{pushdev.secret}}"),
                },
            },
        ],
    };
}

function notFoundScenario(): Scenario {
    const st = (name: string, method: HttpMethod, path: string): Step => ({
        name,
        request: { method, path },
        compare: "status",
    });
    return {
        name: "not-found",
        description:
            "unknown /api paths (404) and unsupported methods (405); only the " +
            "status is contractual (Oak sends an empty body)",
        steps: [
            st("unknown api path", "GET", "/api/does-not-exist"),
            st("unknown nested api path", "GET", "/api/keys/nope"),
            st("GET /api/device without id", "GET", "/api/device"),
            st("PUT /api/keys", "PUT", "/api/keys"),
            st("POST /api/keys", "POST", "/api/keys"),
            st("GET /api/notify", "GET", "/api/notify"),
            st(
                "PUT /api/device/:id",
                "PUT",
                "/api/device/{{UNKNOWN_DEVICE_ID}}",
            ),
        ],
    };
}

function staticScenario(): Scenario {
    return {
        name: "static",
        description:
            "frontend is served for / (only status and content-type are " +
            "recorded; the frontend build changes)",
        steps: [
            {
                name: "GET / serves index.html",
                request: { method: "GET", path: "/" },
                compare: "status+contentType",
            },
        ],
    };
}

/** Notify auth checks for a group with SENDKEY set. */
function notifyAuthScenario(extraWrong: Step[] = []): Scenario {
    const msg = { title: "Fixture", message: "auth check" };
    return {
        name: "notify-auth",
        description: "POST /api/notify bearer SENDKEY checks",
        steps: [
            notifyStep("no Authorization", msg, {}),
            notifyStep("wrong bearer", msg, bearer("{{WRONG_KEY}}")),
            notifyStep("Basic scheme with SENDKEY", msg, {
                Authorization: "Basic {{SENDKEY}}",
            }),
            notifyStep("SENDKEY without scheme", msg, {
                Authorization: "{{SENDKEY}}",
            }),
            notifyStep(
                "no Authorization and invalid message (auth first)",
                { title: "" },
                {},
            ),
            ...extraWrong,
            notifyStep("lowercase bearer scheme", msg, {
                Authorization: "bearer {{SENDKEY}}",
            }),
            notifyStep("valid SENDKEY", msg, bearer("{{SENDKEY}}")),
        ],
    };
}

/** Notify without SENDKEY: any/no Authorization is accepted. */
function notifyOpenScenario(): Scenario {
    const msg = { title: "Fixture", message: "open notify" };
    return {
        name: "notify-open",
        description: "POST /api/notify when SENDKEY is unset",
        steps: [
            notifyStep("no Authorization", msg, {}),
            notifyStep(
                "arbitrary bearer is ignored",
                msg,
                bearer("{{WRONG_KEY}}"),
            ),
            notifyStep("invalid message", { title: "" }, {}),
        ],
    };
}

/** Registration auth checks for a group with LOGINKEY set. */
function registrationAuthScenario(): Scenario {
    const data = { web_push_data: TEST_PUSH_DATA };
    const reg = (name: string, headers: Record<string, string>): Step => ({
        name,
        request: { method: "POST", path: "/api/device", headers, json: data },
    });
    return {
        name: "device-registration-auth",
        description: "POST /api/device requires bearer LOGINKEY",
        steps: [
            reg("no Authorization", {}),
            reg("wrong bearer", bearer("{{WRONG_KEY}}")),
            reg("Basic scheme with LOGINKEY", {
                Authorization: "Basic {{LOGINKEY}}",
            }),
            {
                name: "no Authorization and invalid data (auth first)",
                request: {
                    method: "POST",
                    path: "/api/device",
                    json: { web_push_data: { endpoint: "bad" } },
                },
            },
            {
                name: "no Authorization and malformed JSON (auth first)",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: { "Content-Type": "application/json" },
                    rawBody: "{not json",
                },
            },
            registerStep("logindev", TEST_PUSH_DATA, {
                Authorization: "bearer {{LOGINKEY}}",
            }),
            {
                name: "LOGINKEY does not authenticate device access",
                request: {
                    method: "GET",
                    path: "/api/device/{{logindev.id}}",
                    headers: bearer("{{LOGINKEY}}"),
                },
            },
            {
                name: "device secret authenticates device access",
                request: {
                    method: "GET",
                    path: "/api/device/{{logindev.id}}",
                    headers: bearer("{{logindev.secret}}"),
                },
            },
            {
                name: "device secret does not authenticate registration",
                request: {
                    method: "POST",
                    path: "/api/device",
                    headers: bearer("{{logindev.secret}}"),
                    json: data,
                },
            },
            {
                name: "cleanup: delete login device",
                request: {
                    method: "DELETE",
                    path: "/api/device/{{logindev.id}}",
                    headers: bearer("{{logindev.secret}}"),
                },
            },
        ],
    };
}

/* ------------------------------------------------------------------------ */
/* Groups                                                                    */
/* ------------------------------------------------------------------------ */

const LOGIN_AUTH = bearer("{{LOGINKEY}}");
const SEND_AUTH = bearer("{{SENDKEY}}");

function baseConfig(
    sendkey: string | null,
    loginkey: string | null,
): GroupConfig {
    return {
        vapidKey: TEST_VAPID_KEY,
        sub: TEST_SUB,
        sendkey,
        loginkey,
        cors: false,
    };
}

export const SCENARIO_GROUPS: ScenarioGroup[] = [
    {
        name: "open",
        description:
            "LOGINKEY unset (registration open), SENDKEY set (notify protected)",
        config: baseConfig(TEST_SENDKEY, null),
        scenarios: [
            keysScenario(),
            registrationValidationScenario({}),
            deviceLifecycleScenario({}),
            devicePatchScenario({}),
            unknownDeviceScenario(),
            notifyAuthScenario([
                notifyStep(
                    "LOGINKEY-like bearer is rejected",
                    { title: "Fixture", message: "auth check" },
                    bearer(TEST_LOGINKEY),
                ),
            ]),
            notifyValidationScenario(SEND_AUTH),
            notifyWithDeviceScenario({}, SEND_AUTH),
            notFoundScenario(),
            staticScenario(),
        ],
    },
    {
        name: "protected",
        description: "LOGINKEY set (registration protected) and SENDKEY set",
        config: baseConfig(TEST_SENDKEY, TEST_LOGINKEY),
        scenarios: [
            keysScenario(),
            registrationAuthScenario(),
            registrationValidationScenario(LOGIN_AUTH),
            deviceLifecycleScenario(LOGIN_AUTH),
            devicePatchScenario(LOGIN_AUTH),
            unknownDeviceScenario(),
            notifyAuthScenario([
                notifyStep(
                    "LOGINKEY does not authenticate notify",
                    { title: "Fixture", message: "auth check" },
                    LOGIN_AUTH,
                ),
            ]),
            notifyValidationScenario(SEND_AUTH),
            notifyWithDeviceScenario(LOGIN_AUTH, SEND_AUTH),
            notFoundScenario(),
        ],
    },
    {
        name: "nosendkey",
        description: "LOGINKEY unset and SENDKEY unset (everything open)",
        config: baseConfig(null, null),
        scenarios: [
            keysScenario(),
            notifyOpenScenario(),
            notifyValidationScenario({}),
            notifyWithDeviceScenario({}, {}),
            deviceLifecycleScenario({}),
        ],
    },
    {
        name: "loginonly",
        description: "LOGINKEY set, SENDKEY unset (notify open)",
        config: baseConfig(null, TEST_LOGINKEY),
        scenarios: [
            keysScenario(),
            registrationAuthScenario(),
            notifyOpenScenario(),
            notifyWithDeviceScenario(LOGIN_AUTH, {}),
        ],
    },
];

export function getGroup(name: string): ScenarioGroup {
    const group = SCENARIO_GROUPS.find((g) => g.name === name);
    if (!group) {
        throw new Error(
            `Unknown scenario group "${name}" (known: ${SCENARIO_GROUPS.map((g) => g.name).join(", ")})`,
        );
    }
    return group;
}
