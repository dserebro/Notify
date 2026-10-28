import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the Node/Hono server.
 *
 * `environment: "node"` because every test (unit, API via `app.request()`
 * and contract replay) runs server-side code with no DOM.
 *
 * `resolve.conditions: ["source"]` matches the `source` entry in
 * `@notify/shared`'s `exports` map so the TypeScript sources are
 * imported directly, with no prior `tsc -b` required. The explicit
 * alias is a belt-and-braces fallback for Vite's prebundler, which
 * occasionally short-circuits the exports resolver for workspace
 * packages.
 *
 * The 20s `testTimeout` is generous for the contract-replay suite:
 * each group spins up a fresh SQLite file and executes dozens of
 * `app.request()` calls, which comfortably fits in that budget on a
 * cold CI runner.
 */
const sharedSource = fileURLToPath(
    new URL("../../packages/shared/src/index.ts", import.meta.url),
);

export default defineConfig({
    resolve: {
        conditions: ["source", "module", "node", "import", "default"],
        alias: [{ find: /^@notify\/shared$/, replacement: sharedSource }],
    },
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        testTimeout: 20000,
    },
});
