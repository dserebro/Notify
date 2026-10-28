import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { AppDeps } from "../../src/app.ts";
import { createApp } from "../../src/app.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { DeviceRepository } from "../../src/db/index.ts";
import { createSqliteRepository } from "../../src/db/sqlite.ts";
import type { Logger } from "../../src/logger.ts";
import type {
    ExpectedResponse,
    FixtureFile,
    GroupConfig,
    RecordedStep,
} from "../fixtures/scenarios.ts";
import {
    applyCaptures,
    configVars,
    diffResponse,
    resolveRequest,
} from "../fixtures/scenarios.ts";

/**
 * Contract-replay suite: for every scenario group that has a recorded
 * fixture JSON next to this file (`test/fixtures/<group>.json`), spin
 * up a fresh app from that group's config and replay every step via
 * `app.request()`, comparing the response against the recorded one
 * (status / content-type / cache-control / body).
 *
 * Steps marked `legacyDefect` are compared against their `corrected`
 * expectation instead of the recorded response — the new server fixes
 * these per decision 13 in MILESTONE.md.
 */

const FIXTURE_DIR = dirname(
    new URL("../fixtures/scenarios.ts", import.meta.url).pathname,
);
const KNOWN_GROUPS = ["open", "protected", "nosendkey", "loginonly"] as const;

const SILENT_LOGGER: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

/** Stub fetch for the push service — every endpoint "accepts" the push. */
const stubFetch: typeof fetch = async () => new Response("", { status: 201 });

type GroupHarness = {
    dataDir: string;
    repository: DeviceRepository;
    app: ReturnType<typeof createApp>;
    teardown: () => void;
};

function buildHarness(config: GroupConfig, frontendDir: string): GroupHarness {
    const dataDir = mkdtempSync(join(tmpdir(), "notify-replay-"));
    const dbPath = join(dataDir, "notify.db");
    const resolvedConfig = ConfigSchema.parse({
        port: 8787,
        host: "127.0.0.1",
        vapidKey: config.vapidKey,
        sub: config.sub,
        cors: config.cors,
        frontend: frontendDir,
        sendkey: config.sendkey,
        loginkey: config.loginkey,
        databasePath: dbPath,
        logLevel: "error",
        trustProxy: false,
    });
    const repository = createSqliteRepository(dbPath);
    const deps: AppDeps = {
        config: resolvedConfig,
        repository,
        fetch: stubFetch,
        logger: SILENT_LOGGER,
    };
    const app = createApp(deps);
    return {
        dataDir,
        repository,
        app,
        teardown: () => {
            repository.close();
            rmSync(dataDir, { recursive: true, force: true });
        },
    };
}

/** Read a response from Hono into the fixture ExpectedResponse shape. */
async function readResponse(res: Response): Promise<ExpectedResponse> {
    const contentType = res.headers.get("content-type");
    const cacheControl = res.headers.get("cache-control");
    const text = await res.text();
    const base = { status: res.status, contentType, cacheControl };
    if (contentType?.includes("json")) {
        try {
            return { ...base, body: JSON.parse(text) as unknown };
        } catch {
            // fall through
        }
    }
    return { ...base, text };
}

/**
 * Static frontend used by the `static` scenario. A tiny HTML file is
 * enough — the static scenario only checks `status + contentType`.
 */
function makeFrontendDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "notify-replay-fe-"));
    const index = "<!doctype html><html><body>contract</body></html>";
    writeFileSync(join(dir, "index.html"), index);
    return dir;
}

for (const name of KNOWN_GROUPS) {
    const fixturePath = join(FIXTURE_DIR, `${name}.json`);
    if (!existsSync(fixturePath)) {
        describe.skip(`contract replay: ${name} (no recorded fixture)`, () => {
            it("skipped", () => {
                /* no-op */
            });
        });
        continue;
    }
    const file = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;

    describe(`contract replay: ${name}`, () => {
        let harness: GroupHarness;
        let frontendDir: string;

        beforeAll(() => {
            frontendDir = makeFrontendDir();
            harness = buildHarness(file.config, frontendDir);
        });

        afterAll(() => {
            harness.teardown();
            rmSync(frontendDir, { recursive: true, force: true });
        });

        for (const scenario of file.scenarios) {
            // One `describe` per scenario so a failure's position in
            // the suite reads as "<group>/<scenario>/<step>".
            describe(scenario.name, () => {
                // Variables accumulated across the steps of ONE
                // scenario (captures). Each scenario gets its own
                // vars, matching how the recorder worked.
                const vars = configVars(file.config);

                for (const step of scenario.steps) {
                    it(step.name, async () => {
                        await replayStep(harness, step, vars);
                    });
                }
            });
        }
    });
}

async function replayStep(
    harness: GroupHarness,
    step: RecordedStep,
    vars: Record<string, string>,
): Promise<void> {
    const req = resolveRequest(
        {
            method: step.request.method,
            path: step.request.path,
            headers: step.request.headers,
            json: step.request.json,
            rawBody: step.request.rawBody,
        },
        vars,
    );
    const res = await harness.app.request(req.path, {
        method: req.method,
        headers: req.headers,
        body: req.body,
    });
    const actual = await readResponse(res);

    // Captures feed later steps and also drive matcher substitution
    // in the recorded body — but on replay we use the recorded
    // response (which already carries matchers) directly, so we only
    // need the live id/secret values for subsequent steps.
    applyCaptures(step.capture, actual.body, vars);

    const expected = step.corrected ?? step.response;
    const mode = step.corrected ? "full" : step.compare;
    const diffs = diffResponse(expected, actual, mode);
    if (diffs.length > 0) {
        const kind = step.corrected ? "corrected" : "recorded";
        throw new Error(
            [
                `Step '${step.name}' response does not match the ${kind} expectation:`,
                ...diffs.map((d) => `  - ${d}`),
                `  request: ${req.method} ${req.path}`,
            ].join("\n"),
        );
    }
}
