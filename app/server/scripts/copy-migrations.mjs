#!/usr/bin/env node
/**
 * Copy SQL migration files from src/db/migrations/ to dist/db/migrations/.
 *
 * The server reads migrations at runtime with `fs.readdirSync` relative to
 * `import.meta.dirname`, so once compiled they must sit next to the
 * compiled `sqlite.js`. `tsc` does not copy non-TS assets, hence this
 * post-build step.
 */
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(scriptDir);
const srcDir = join(packageDir, "src", "db", "migrations");
const outDir = join(packageDir, "dist", "db", "migrations");

if (!existsSync(srcDir)) {
    console.error(
        `copy-migrations: source directory not found: ${srcDir}`,
    );
    process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter((name) => name.endsWith(".sql"));
for (const file of files) {
    copyFileSync(join(srcDir, file), join(outDir, file));
}

console.log(
    `copy-migrations: copied ${files.length} file(s) to dist/db/migrations/`,
);
