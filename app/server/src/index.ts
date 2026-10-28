import { createProgram } from "./cli/index.js";

/**
 * Top-level entrypoint. Builds the commander program and parses
 * `process.argv`; the CLI module owns all other wiring.
 */
const program = createProgram();
await program.parseAsync(process.argv);
