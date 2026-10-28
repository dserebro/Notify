import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the Notify E2E smoke tests.
 *
 * Two server modes, both on host ports 18787 (open) and 18788
 * (LOGINKEY-protected) so they never collide with the dev server (5173)
 * or the default server port (8787):
 *
 * - `E2E_IMAGE=<tag>` (CI): each server is the built Docker image,
 *   started with `docker run` and a throwaway anonymous `/data` volume,
 *   so the entrypoint, non-root user, volume and native better-sqlite3
 *   build are exercised end to end.
 * - unset (local default): the built server is booted directly via
 *   `node app/server/dist/index.js run`, serving the Vite build from
 *   `FRONTEND=./app/frontend/dist`.
 */
const e2eImage = process.env.E2E_IMAGE;

type ServerOpts = {
    port: number;
    db: string;
    env: Record<string, string>;
};

function server({ port, db, env }: ServerOpts) {
    const common = {
        url: `http://127.0.0.1:${port}/api/health`,
        timeout: 60000,
        reuseExistingServer: !process.env.CI,
    };
    if (e2eImage) {
        // The image already sets PORT/FRONTEND/DATABASE_PATH defaults;
        // `--rm` also discards the anonymous /data volume.
        const envFlags = Object.entries(env)
            .map(([key, value]) => `-e ${key}=${value}`)
            .join(" ");
        return {
            ...common,
            command: `docker run --rm -p ${port}:8787 -v /data ${envFlags} ${e2eImage}`,
        };
    }
    return {
        ...common,
        command: "node app/server/dist/index.js run",
        env: {
            PORT: String(port),
            DATABASE_PATH: db,
            FRONTEND: "./app/frontend/dist",
            ...env,
        },
    };
}

// The JSON report goes to the sandbox harness location when MCODE_DIR is
// set; otherwise to the gitignored `playwright-report/` directory.
const jsonReportFile = process.env.MCODE_DIR
    ? `${process.env.MCODE_DIR}/fe_testing/playwright-results.json`
    : "playwright-report/results.json";

export default defineConfig({
    testDir: "e2e",
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ["list"],
        [
            "json",
            {
                outputFile: jsonReportFile,
            },
        ],
    ],
    use: {
        baseURL: "http://127.0.0.1:18787",
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
    webServer: [
        server({
            port: 18787,
            db: "./e2e/.data/notify.db",
            env: { SENDKEY: "e2e-sendkey" },
        }),
        // Second server with LOGINKEY set, for the protected branch.
        server({
            port: 18788,
            db: "./e2e/.data/notify-protected.db",
            env: { SENDKEY: "e2e-sendkey", LOGINKEY: "e2e-loginkey" },
        }),
    ],
});
