import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for `@notify/shared`. Tests live in `test/`
 * (outside `src/`, so `tsc -b` never emits them into `dist`) and import
 * the TypeScript sources directly.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
    },
});
