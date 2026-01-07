import { describe, expect, it } from "vitest";

import { applyLinePatchOps } from "../src/lib/textPatch.js";

describe("applyLinePatchOps()", () => {
  it("inserts lines at the beginning", () => {
    const input = ["a", "b", ""].join("\n");
    const result = applyLinePatchOps(input, [{ op: "insert_lines", at_line: 1, text: "x\ny" }]);
    expect(result.text).toBe(["x", "y", "a", "b", ""].join("\n"));
  });

  it("replaces a line range", () => {
    const input = ["a", "b", "c", ""].join("\n");
    const result = applyLinePatchOps(input, [
      { op: "replace_lines", from_line: 2, to_line: 3, text: "B\nC" },
    ]);
    expect(result.text).toBe(["a", "B", "C", ""].join("\n"));
  });

  it("deletes a line range", () => {
    const input = ["a", "b", "c", ""].join("\n");
    const result = applyLinePatchOps(input, [{ op: "delete_lines", from_line: 2, to_line: 2 }]);
    expect(result.text).toBe(["a", "c", ""].join("\n"));
  });

  it("preserves CRLF line endings", () => {
    const input = "a\r\nb\r\n";
    const result = applyLinePatchOps(input, [{ op: "insert_lines", at_line: 3, text: "c" }]);
    expect(result.text).toBe("a\r\nb\r\nc\r\n");
  });

  it("throws on out-of-range operations", () => {
    const input = "a\n";
    expect(() =>
      applyLinePatchOps(input, [{ op: "replace_lines", from_line: 2, to_line: 2, text: "x" }]),
    ).toThrow(/out of bounds/i);
  });
});
