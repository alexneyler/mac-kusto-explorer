import { describe, expect, it } from "vitest";

import { queryAtCursor } from "./queryExecution";

const QUERY = `table
| project x, y, z

| summarize x by z`;

describe("queryAtCursor", () => {
  it.each([
    [0, "table\n| project x, y, z"],
    [QUERY.indexOf("| project"), "table\n| project x, y, z"],
    [QUERY.indexOf("\n\n") + 1, "table\n| project x, y, z"],
    [QUERY.indexOf("| summarize"), "| summarize x by z"],
  ])("resolves the command at offset %i", (offset, expected) => {
    expect(queryAtCursor(QUERY, offset)).toBe(expected);
  });

  it("returns selected text instead of the cursor command", () => {
    const start = QUERY.indexOf("project");
    expect(queryAtCursor(QUERY, start, start + "project x".length)).toBe(
      "project x",
    );
  });

  it("uses the first command when the document starts with blank lines", () => {
    expect(queryAtCursor("\n\nT | count", 0)).toBe("T | count");
  });
});
