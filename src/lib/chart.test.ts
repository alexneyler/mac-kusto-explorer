import { describe, expect, it } from "vitest";

import {
  MAX_CHART_POINTS,
  buildChartModel,
  detectChartConfig,
  firstDatetimeIndex,
  isDatetimeType,
  isNumericType,
  numericColumnIndices,
  seriesKeysFor,
} from "./chart";
import type { KustoColumn, KustoResultSet } from "../types/kusto";

const cols = (...defs: [string, string][]): KustoColumn[] =>
  defs.map(([name, type]) => ({ name, type }));

describe("type predicates", () => {
  it("recognises numeric Kusto types (case-insensitive)", () => {
    for (const t of ["long", "int", "Integer", "real", "DOUBLE", "decimal"]) {
      expect(isNumericType(t)).toBe(true);
    }
    for (const t of ["string", "datetime", "bool", "dynamic", "guid"]) {
      expect(isNumericType(t)).toBe(false);
    }
  });

  it("recognises datetime types", () => {
    expect(isDatetimeType("datetime")).toBe(true);
    expect(isDatetimeType("DateTime")).toBe(true);
    expect(isDatetimeType("timespan")).toBe(false);
    expect(isDatetimeType("string")).toBe(false);
  });
});

describe("column detection helpers", () => {
  it("finds numeric column indices in order", () => {
    const columns = cols(
      ["State", "string"],
      ["Count", "long"],
      ["Ratio", "real"],
    );
    expect(numericColumnIndices(columns)).toEqual([1, 2]);
  });

  it("finds the first datetime column, or -1", () => {
    expect(
      firstDatetimeIndex(cols(["ts", "datetime"], ["v", "long"])),
    ).toBe(0);
    expect(firstDatetimeIndex(cols(["a", "string"], ["b", "long"]))).toBe(-1);
  });
});

describe("detectChartConfig", () => {
  it("uses a datetime column as X and defaults to a time chart", () => {
    const columns = cols(
      ["Timestamp", "datetime"],
      ["Value", "real"],
      ["Count", "long"],
    );
    expect(detectChartConfig(columns)).toEqual({
      type: "time",
      xIndex: 0,
      seriesIndices: [1, 2],
    });
  });

  it("uses the first non-numeric column as X and defaults to column", () => {
    const columns = cols(["State", "string"], ["Count", "long"]);
    expect(detectChartConfig(columns)).toEqual({
      type: "column",
      xIndex: 0,
      seriesIndices: [1],
    });
  });

  it("falls back to column 0 as X when every column is numeric", () => {
    const columns = cols(["a", "long"], ["b", "real"]);
    expect(detectChartConfig(columns)).toEqual({
      type: "column",
      xIndex: 0,
      seriesIndices: [1],
    });
  });

  it("yields no series when there are no numeric columns", () => {
    const columns = cols(["State", "string"], ["Name", "string"]);
    expect(detectChartConfig(columns)).toEqual({
      type: "column",
      xIndex: 0,
      seriesIndices: [],
    });
  });
});

describe("seriesKeysFor", () => {
  it("disambiguates duplicate column names", () => {
    const columns = cols(
      ["x", "string"],
      ["Count", "long"],
      ["Count", "long"],
    );
    expect(seriesKeysFor(columns, [1, 2])).toEqual(["Count", "Count (2)"]);
  });
});

describe("buildChartModel", () => {
  const result: KustoResultSet = {
    columns: cols(["State", "string"], ["Count", "long"], ["Ratio", "real"]),
    rows: [
      ["TX", 10, 1.5],
      ["KS", 20, "2.5"],
      ["CA", null, 3],
    ],
    row_count: 3,
  };

  it("maps rows into points keyed by series name", () => {
    const model = buildChartModel(result, {
      type: "column",
      xIndex: 0,
      seriesIndices: [1, 2],
    });
    expect(model.xName).toBe("State");
    expect(model.seriesKeys).toEqual(["Count", "Ratio"]);
    expect(model.capped).toBe(false);
    expect(model.points).toEqual([
      { x: "TX", Count: 10, Ratio: 1.5 },
      { x: "KS", Count: 20, Ratio: 2.5 },
      { x: "CA", Count: null, Ratio: 3 },
    ]);
  });

  it("coerces X values to string labels", () => {
    const numeric: KustoResultSet = {
      columns: cols(["k", "long"], ["v", "long"]),
      rows: [[1, 100]],
      row_count: 1,
    };
    const model = buildChartModel(numeric, {
      type: "scatter",
      xIndex: 0,
      seriesIndices: [1],
    });
    expect(model.points[0].x).toBe("1");
  });

  it("caps the number of points and reports the total", () => {
    const many: KustoResultSet = {
      columns: cols(["x", "string"], ["v", "long"]),
      rows: Array.from({ length: 5 }, (_, i) => [`r${i}`, i]),
      row_count: 5,
    };
    const model = buildChartModel(
      many,
      { type: "line", xIndex: 0, seriesIndices: [1] },
      3,
    );
    expect(model.capped).toBe(true);
    expect(model.totalRows).toBe(5);
    expect(model.points).toHaveLength(3);
  });

  it("does not cap when under the default limit", () => {
    const model = buildChartModel(result, {
      type: "column",
      xIndex: 0,
      seriesIndices: [1],
    });
    expect(model.capped).toBe(false);
    expect(MAX_CHART_POINTS).toBeGreaterThan(result.rows.length);
  });
});
