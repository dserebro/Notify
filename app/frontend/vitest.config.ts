import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

// Vitest config for the frontend workspace.
// - happy-dom gives us a DOM-ish global environment for browser code.
// - test/setup.ts loads fake-indexeddb and other polyfills.
// - resolve.conditions includes "source" so `@notify/shared` resolves to
//   its TypeScript sources (same mechanism as vite.config.ts), avoiding
//   a prebuild step for the shared package.
export default defineConfig({
    plugins: [preact()],
    resolve: {
        conditions: ["source"],
    },
    test: {
        environment: "happy-dom",
        setupFiles: ["test/setup.ts"],
        include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
        globals: false,
    },
});
