import { describe, expect, it } from "vitest";

import { formatCell } from "./cell";

describe("formatCell", () => {
  it("renders null/undefined as a muted placeholder", () => {
    expect(formatCell(null)).toEqual({
      text: "null",
      numeric: false,
      isNull: true,
      dynamic: false,
    });
    expect(formatCell(undefined).isNull).toBe(true);
  });

  it("marks numbers as numeric", () => {
    const d = formatCell(42);
    expect(d.text).toBe("42");
    expect(d.numeric).toBe(true);
  });

  it("renders booleans as text", () => {
    expect(formatCell(true).text).toBe("true");
    expect(formatCell(false).text).toBe("false");
  });

  it("passes strings through untouched", () => {
    expect(formatCell("hello").text).toBe("hello");
  });

  it("serializes dynamic objects and arrays as JSON", () => {
    expect(formatCell({ a: 1 })).toMatchObject({
      text: '{"a":1}',
      dynamic: true,
    });
    expect(formatCell([1, 2, 3]).text).toBe("[1,2,3]");
  });
});
