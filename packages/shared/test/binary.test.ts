import { describe, expect, it } from "vitest";
import { fromBinary, toBinary } from "../src/index.ts";

describe("toBinary / fromBinary", () => {
    it.each(["", "Hello", "éàñ 中文 😀"])("round-trips %j", (input) => {
        expect(fromBinary(toBinary(input))).toBe(input);
    });

    it("emits two little-endian bytes per UTF-16 code unit", () => {
        expect(toBinary("A")).toBe("A\u0000");
        expect(toBinary("中")).toBe("-N");
        expect(toBinary("😀")).toHaveLength(4);
    });
});
