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
export default defineConfig({
    testDir: "e2e",
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: "http://127.0.0.1:18787",
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
    webServer: {
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
});
