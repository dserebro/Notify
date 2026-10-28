import { createProgram } from "./cli/index.js";

/**
 * Top-level entrypoint. Builds the commander program and parses
 * `process.argv`. Kept minimal so a concurrent task can add the
 * `createApp` import once `src/app.ts` and `src/webpush/*` land —
 * the CLI module owns all other imports today.
 */
const program = createProgram();
await program.parseAsync(process.argv);
