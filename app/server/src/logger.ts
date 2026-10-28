/**
 * Minimal structured JSON-lines logger used across the server.
 *
 * Each call writes a single JSON line to stdout (`trace`/`debug`/
 * `info`) or stderr (`warn`/`error`), with the configured level
 * filtering out quieter messages. The CLI wires this in during
 * startup; tests can swap in a no-op logger that satisfies the same
 * interface.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export type LogFn = (msg: string, meta?: Record<string, unknown>) => void;

export type Logger = {
    trace: LogFn;
    debug: LogFn;
    info: LogFn;
    warn: LogFn;
    error: LogFn;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
};

function emit(
    stream: NodeJS.WriteStream,
    level: LogLevel,
    msg: string,
    meta?: Record<string, unknown>,
): void {
    const line: Record<string, unknown> = {
        time: new Date().toISOString(),
        level,
        msg,
    };
    if (meta !== undefined) {
        for (const [key, value] of Object.entries(meta)) {
            if (key === "time" || key === "level" || key === "msg") {
                continue;
            }
            line[key] = value;
        }
    }
    stream.write(`${JSON.stringify(line)}\n`);
}

/**
 * Build a logger that filters at `level` and writes JSON lines. Info
 * and quieter go to stdout; warn and error go to stderr so operators
 * can split them without a parser.
 */
export function createLogger(level: LogLevel = "info"): Logger {
    const threshold = LEVEL_ORDER[level];
    const make = (lvl: LogLevel, stream: NodeJS.WriteStream): LogFn => {
        if (LEVEL_ORDER[lvl] < threshold) {
            return () => {};
        }
        return (msg, meta) => emit(stream, lvl, msg, meta);
    };
    return {
        trace: make("trace", process.stdout),
        debug: make("debug", process.stdout),
        info: make("info", process.stdout),
        warn: make("warn", process.stderr),
        error: make("error", process.stderr),
    };
}
