import { describe, expect, it } from "vitest";

import type { KustoResultSet } from "../types/kusto";
import {
  columnDistribution,
  emptyColumnIndexes,
  isEmptyValue,
} from "./columnStats";

function makeResult(
  columns: string[],
  rows: unknown[][],
): KustoResultSet {
  return {
    columns: columns.map((name) => ({ name, type: "string" })),
    rows,
    row_count: rows.length,
  };
}

describe("isEmptyValue", () => {
  it("treats null, undefined and blank strings as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("   ")).toBe(true);
  });

  it("treats real values as non-empty", () => {
    expect(isEmptyValue("x")).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue({})).toBe(false);
  });
});

describe("emptyColumnIndexes", () => {
  it("returns indexes of columns where every cell is empty", () => {
    const result = makeResult(
      ["A", "B", "C"],
      [
        ["x", null, ""],
        ["y", "", "   "],
      ],
    );
    expect(emptyColumnIndexes(result)).toEqual([1, 2]);
  });

  it("returns nothing when there are no rows", () => {
    expect(emptyColumnIndexes(makeResult(["A", "B"], []))).toEqual([]);
  });

  it("keeps columns that have at least one value", () => {
    const result = makeResult(
      ["A", "B"],
      [
        [null, null],
        ["v", null],
      ],
    );
    expect(emptyColumnIndexes(result)).toEqual([1]);
  });
});

describe("columnDistribution", () => {
  const result = makeResult(
    ["State"],
    [["TX"], ["TX"], ["KS"], ["TX"], [null], ["CA"]],
  );

  it("counts distinct values, nulls, and percentages", () => {
    const dist = columnDistribution(result, 0);
    expect(dist.total).toBe(6);
    expect(dist.nullCount).toBe(1);
    expect(dist.distinctCount).toBe(3);

    expect(dist.top[0]).toEqual({ value: "TX", count: 3, percent: 50 });
    // KS and CA both have count 1 — tie broken alphabetically.
    expect(dist.top.map((b) => b.value)).toEqual(["TX", "CA", "KS"]);
  });

  it("respects the topN limit", () => {
    const dist = columnDistribution(result, 0, 1);
    expect(dist.top).toHaveLength(1);
    expect(dist.top[0].value).toBe("TX");
    // distinctCount reflects all groups, not just the returned ones.
    expect(dist.distinctCount).toBe(3);
  });

  it("groups values by their displayed text", () => {
    const nums = makeResult("N".split(""), [[1], [1], [2]]);
    const dist = columnDistribution(nums, 0);
    expect(dist.top).toEqual([
      { value: "1", count: 2, percent: (2 / 3) * 100 },
      { value: "2", count: 1, percent: (1 / 3) * 100 },
    ]);
  });

  it("handles an all-null column", () => {
    const dist = columnDistribution(makeResult(["A"], [[null], [null]]), 0);
    expect(dist).toEqual({
      total: 2,
      distinctCount: 0,
      nullCount: 2,
      top: [],
    });
  });
});
