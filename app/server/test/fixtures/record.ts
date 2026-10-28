/**
 * Records characterization fixtures from the LEGACY Deno/Oak backend.
 *
 * For every scenario group in `scenarios.ts` it drives a live legacy server
 * over HTTP, records each step's status, `content-type`, `cache-control` and
 * JSON body (dynamic values replaced by matchers) and writes `<group>.json`
 * next to this file. The contract tests of the Node server replay these files.
 *
 * How to re-record (Node 24, from the repository root; the legacy backend
 * must still exist in app/backend and its Deno modules must be cached, e.g.
 * via the origin lifecycle `install` step; GET / needs app/frontend/build):
 *
 *   # Easiest: let the recorder start one fresh legacy server per group
 *   # (random port, isolated Deno KV via a unique --location):
 *   DENO_BIN=~/.deno/bin/deno \
 *     node app/server/test/fixtures/record.ts --spawn --all
 *
 *   # Or against a server you started yourself with the group's config.
 *   # `--print-env <group>` prints the env vars to start it with; the
 *   # database must be empty (use a fresh `--location`):
 *   node app/server/test/fixtures/record.ts --print-env protected
 *   cd app/backend && env $(node ../server/test/fixtures/record.ts \
 *     --print-env protected) deno run --allow-net --allow-read \
 *     --allow-write --allow-env --unstable --location http://rec-1.test/ \
 *     deploy.ts
 *   LEGACY_BASE_URL=http://127.0.0.1:8787 \
 *     node app/server/test/fixtures/record.ts protected
 *
 * Afterwards format the output (JSON.stringify differs from Biome's JSON
 * style): `npx biome format --write app/server/test/fixtures`.
 *
 * Before recording, a preflight checks that the server's VAPID public key,
 * LOGINKEY and SENDKEY state match the group's config. All registered device
 * push endpoints point to the closed port 127.0.0.1:9, so nothing is pushed.
 * Works with `node` (native type stripping) or `npx tsx`.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import type {
    ExpectedResponse,
    FixtureFile,
    GroupConfig,
    RecordedStep,
    ScenarioGroup,
    Vars,
} from "./scenarios.ts";
import {
    applyCaptures,
    configVars,
    getGroup,
    normalizeBody,
    resolveRequest,
    SCENARIO_GROUPS,
    TEST_VAPID_PUBLIC_KEY,
    templateHeaders,
} from "./scenarios.ts";

const FIXTURE_DIR = import.meta.dirname;
const BACKEND_DIR = path.resolve(FIXTURE_DIR, "../../../backend");
const MAX_VERBATIM_TEXT = 256;

function envForGroup(
    config: GroupConfig,
    port: number,
): Record<string, string> {
    return {
        PORT: String(port),
        VAPID_KEY: config.vapidKey,
        SUB: config.sub,
        CORS: String(config.cors),
        SENDKEY: config.sendkey ?? "",
        LOGINKEY: config.loginkey ?? "",
        FRONTEND: "../frontend/build",
    };
}

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            const port = typeof addr === "object" && addr ? addr.port : 0;
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(
    baseUrl: string,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/api/keys`);
            if (res.ok) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`legacy server at ${baseUrl} did not come up`);
}

async function spawnLegacy(
    group: ScenarioGroup,
): Promise<{ baseUrl: string; child: ChildProcess; version: string }> {
    const deno = process.env.DENO_BIN ?? "deno";
    const port = await freePort();
    const location = `http://notify-fixture-${group.name}-${Date.now()}.test/`;
    const child = spawn(
        deno,
        [
            "run",
            "--allow-net",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--unstable",
            `--location=${location}`,
            "deploy.ts",
        ],
        {
            cwd: BACKEND_DIR,
            env: { ...process.env, ...envForGroup(group.config, port) },
            stdio: ["ignore", "ignore", "inherit"],
        },
    );
    const killChild = (): void => {
        child.kill("SIGTERM");
    };
    process.once("exit", killChild);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, 60_000);
    const version = await new Promise<string>((resolve) => {
        const v = spawn(deno, ["--version"], {
            stdio: ["ignore", "pipe", "ignore"],
        });
        let out = "";
        v.stdout.on("data", (d) => {
            out += String(d);
        });
        v.on("close", () => resolve(out.split("\n")[0]?.trim() || "deno"));
    });
    return { baseUrl, child, version };
}

/** Status/headers/body of a response, without any normalization. */
async function readResponse(
    res: Response,
): Promise<ExpectedResponse & { raw?: unknown }> {
    const contentType = res.headers.get("content-type");
    const cacheControl = res.headers.get("cache-control");
    const text = await res.text();
    const base = { status: res.status, contentType, cacheControl };
    if (contentType?.includes("json")) {
        try {
            const body: unknown = JSON.parse(text);
            return { ...base, body, raw: body };
        } catch {
            // fall through to text handling
        }
    }
    const verbatim =
        text.length <= MAX_VERBATIM_TEXT &&
        (contentType === null || contentType.startsWith("text/plain"));
    return {
        ...base,
        text: verbatim
            ? text
            : `<non-json: ${contentType ?? "no content-type"}>`,
    };
}

async function preflight(baseUrl: string, config: GroupConfig): Promise<void> {
    const keys = (await (await fetch(`${baseUrl}/api/keys`)).json()) as {
        data?: unknown;
    };
    if (keys.data !== TEST_VAPID_PUBLIC_KEY) {
        throw new Error(
            `preflight: server VAPID public key ${String(keys.data)} does not match the TEST key`,
        );
    }
    const auth = (await (await fetch(`${baseUrl}/api/keys/auth`)).json()) as {
        data?: unknown;
    };
    if (auth.data !== (config.loginkey !== null)) {
        throw new Error(
            `preflight: LOGINKEY state mismatch (server says ${String(auth.data)})`,
        );
    }
    // Side-effect free: an invalid message is rejected with 401 when SENDKEY
    // is set (auth runs first) and with 400 when it is not.
    const probe = await fetch(`${baseUrl}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    await probe.body?.cancel();
    const expected = config.sendkey !== null ? 401 : 400;
    if (probe.status !== expected) {
        throw new Error(
            `preflight: SENDKEY state mismatch (probe returned ${probe.status}, expected ${expected})`,
        );
    }
    if (config.sendkey !== null) {
        const ok = await fetch(`${baseUrl}/api/notify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.sendkey}`,
            },
            body: "{}",
        });
        await ok.body?.cancel();
        if (ok.status !== 400) {
            throw new Error(
                "preflight: server SENDKEY differs from the TEST key",
            );
        }
    }
}

async function recordGroup(
    group: ScenarioGroup,
    baseUrl: string,
    runtime: string,
): Promise<FixtureFile> {
    await preflight(baseUrl, group.config);
    const file: FixtureFile = {
        group: group.name,
        description: group.description,
        recordedWith: {
            server: "app/backend/deploy.ts (legacy Deno/Oak/Deno KV)",
            runtime,
            recordedAt: new Date().toISOString(),
        },
        config: group.config,
        scenarios: [],
    };
    for (const scenario of group.scenarios) {
        const vars: Vars = configVars(group.config);
        const steps: RecordedStep[] = [];
        for (const step of scenario.steps) {
            const req = resolveRequest(step.request, vars);
            const res = await fetch(`${baseUrl}${req.path}`, {
                method: req.method,
                headers: req.headers,
                body: req.body,
            });
            const { raw, ...response } = await readResponse(res);
            applyCaptures(step.capture, raw, vars);
            if (response.body !== undefined) {
                response.body = normalizeBody(response.body, vars);
            }
            const recorded: RecordedStep = {
                name: step.name,
                ...(step.description ? { description: step.description } : {}),
                request: {
                    method: step.request.method,
                    path: step.request.path,
                    headers: templateHeaders(step.request),
                    ...(step.request.json !== undefined
                        ? { json: step.request.json }
                        : {}),
                    ...(step.request.rawBody !== undefined
                        ? { rawBody: step.request.rawBody }
                        : {}),
                },
                ...(step.capture ? { capture: step.capture } : {}),
                compare: step.compare ?? "full",
                response,
                ...(step.legacyDefect
                    ? {
                          legacyDefect: step.legacyDefect,
                          corrected: step.corrected,
                      }
                    : {}),
                ...(step.note ? { note: step.note } : {}),
            };
            steps.push(recorded);
            const tag = step.legacyDefect ? " [legacy-defect]" : "";
            console.log(
                `  ${group.name}/${scenario.name}: ${req.method} ${step.request.path} -> ${response.status}${tag}  (${step.name})`,
            );
        }
        file.scenarios.push({
            name: scenario.name,
            description: scenario.description,
            steps,
        });
    }
    return file;
}

function usage(): never {
    console.error(
        [
            "usage:",
            "  node record.ts --spawn (--all | <group>...)   start legacy servers itself (DENO_BIN)",
            "  LEGACY_BASE_URL=<url> node record.ts <group>   record against a running server",
            "  node record.ts --print-env <group> [port]      env vars for starting a server",
            `groups: ${SCENARIO_GROUPS.map((g) => g.name).join(", ")}`,
        ].join("\n"),
    );
    process.exit(2);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args[0] === "--print-env") {
        const group = getGroup(args[1] ?? usage());
        const env = envForGroup(group.config, Number(args[2] ?? 8787));
        console.log(
            Object.entries(env)
                .map(([k, v]) => `${k}=${v}`)
                .join(" "),
        );
        return;
    }
    const spawnMode = args.includes("--spawn");
    const names = args.includes("--all")
        ? SCENARIO_GROUPS.map((g) => g.name)
        : args.filter((a) => !a.startsWith("--"));
    if (names.length === 0) usage();
    const groups = names.map(getGroup);

    if (!spawnMode) {
        const baseUrl = process.env.LEGACY_BASE_URL;
        if (!baseUrl) usage();
        const [group] = groups;
        if (!group || groups.length !== 1) {
            throw new Error(
                "without --spawn, record exactly one group per server (each group needs its own config and an empty database)",
            );
        }
        const file = await recordGroup(
            group,
            baseUrl.replace(/\/$/, ""),
            process.env.LEGACY_RUNTIME ?? "deno (external server)",
        );
        writeFixture(file);
        return;
    }

    if (!existsSync(path.join(BACKEND_DIR, "deploy.ts"))) {
        throw new Error(`legacy backend not found at ${BACKEND_DIR}`);
    }
    for (const group of groups) {
        console.log(`recording group "${group.name}" (fresh legacy server)`);
        const { baseUrl, child, version } = await spawnLegacy(group);
        try {
            writeFixture(await recordGroup(group, baseUrl, version));
        } finally {
            child.kill("SIGTERM");
        }
    }
}

function writeFixture(file: FixtureFile): void {
    const out = path.join(FIXTURE_DIR, `${file.group}.json`);
    writeFileSync(out, `${JSON.stringify(file, null, 4)}\n`);
    const steps = file.scenarios.reduce((n, s) => n + s.steps.length, 0);
    const defects = file.scenarios.reduce(
        (n, s) => n + s.steps.filter((st) => st.legacyDefect).length,
        0,
    );
    console.log(`wrote ${out} (${steps} steps, ${defects} legacy-defect)`);
}

await main();
