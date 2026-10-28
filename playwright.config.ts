import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the Notify E2E smoke tests.
 *
 * The suite drives a real Chromium against the built server (via
 * `node app/server/dist/index.js run`) which also serves the
 * Vite-built frontend from `FRONTEND=./app/frontend/dist`. No Docker
 * is involved — the server is booted directly by Playwright's
 * `webServer` on port 18787 so this port never collides with the dev
 * server (5173) or the default server port (8787) used elsewhere.
 */
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
        {
            command: "node app/server/dist/index.js run",
            url: "http://127.0.0.1:18787/api/health",
            timeout: 60000,
            reuseExistingServer: !process.env.CI,
            env: {
                PORT: "18787",
                DATABASE_PATH: "./e2e/.data/notify.db",
                FRONTEND: "./app/frontend/dist",
                SENDKEY: "e2e-sendkey",
            },
        },
        {
            // Second server with LOGINKEY set, for the protected branch.
            command: "node app/server/dist/index.js run",
            url: "http://127.0.0.1:18788/api/health",
            timeout: 60000,
            reuseExistingServer: !process.env.CI,
            env: {
                PORT: "18788",
                DATABASE_PATH: "./e2e/.data/notify-protected.db",
                FRONTEND: "./app/frontend/dist",
                SENDKEY: "e2e-sendkey",
                LOGINKEY: "e2e-loginkey",
            },
        },
    ],
});
