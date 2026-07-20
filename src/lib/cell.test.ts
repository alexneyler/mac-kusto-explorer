import { describe, expect, it } from "vitest";

import {
  cellJson,
  formatCell,
  kustoLiteral,
  rowAsJson,
  rowAsMarkdown,
  rowAsTsv,
} from "./cell";

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

describe("context menu cell formatting", () => {
  it("formats safe Kusto literals", () => {
    expect(kustoLiteral(null)).toBe("null");
    expect(kustoLiteral(42)).toBe("42");
    expect(kustoLiteral('a "quoted" value')).toBe('"a \\"quoted\\" value"');
    expect(kustoLiteral({ ok: true })).toBe('dynamic("{\\"ok\\":true}")');
  });

  it("formats cells and rows for clipboard actions", () => {
    const columns = [{ name: "State" }, { name: "Count" }];
    const row = ["TEXAS", 2];
    expect(cellJson(row[0])).toBe('"TEXAS"');
    expect(rowAsTsv(row)).toBe("TEXAS\t2");
    expect(rowAsJson(columns, row)).toBe(
      '{\n  "State": "TEXAS",\n  "Count": 2\n}',
    );
    expect(rowAsMarkdown(columns, row)).toContain("| TEXAS | 2 |");
  });
});
