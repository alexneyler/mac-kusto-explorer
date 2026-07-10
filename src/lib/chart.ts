// Pure axis/series-detection and data-shaping logic for the results chart view.
// Kept free of React and recharts so the type-driven rules can be unit-tested in
// isolation from rendering.

import type { KustoColumn, KustoResultSet } from "../types/kusto";

/** Chart types offered in the Chart view, mirroring Kusto.Explorer. */
export type ChartType =
  | "line"
  | "column"
  | "bar"
  | "area"
  | "stackedArea"
  | "pie"
  | "scatter"
  | "time";

export const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "line", label: "Line" },
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "area", label: "Area" },
  { type: "stackedArea", label: "Stacked area" },
  { type: "pie", label: "Pie" },
  { type: "scatter", label: "Scatter" },
  { type: "time", label: "Time chart" },
];

/** Cap the number of points fed to the chart to keep rendering responsive. */
export const MAX_CHART_POINTS = 30_000;

// Kusto scalar type names (lower-cased) that hold a plottable number.
const NUMERIC_TYPES = new Set([
  "long",
  "int",
  "integer",
  "real",
  "double",
  "float",
  "decimal",
]);

// Kusto scalar type names (lower-cased) that hold a point-in-time value.
const DATETIME_TYPES = new Set(["datetime", "date"]);

/** True when a Kusto column type holds a numeric value we can plot. */
export function isNumericType(type: string): boolean {
  return NUMERIC_TYPES.has(type.trim().toLowerCase());
}

/** True when a Kusto column type holds a datetime value. */
export function isDatetimeType(type: string): boolean {
  return DATETIME_TYPES.has(type.trim().toLowerCase());
}

/** Indices of all numeric columns, in column order. */
export function numericColumnIndices(columns: KustoColumn[]): number[] {
  return columns.reduce<number[]>((acc, col, i) => {
    if (isNumericType(col.type)) acc.push(i);
    return acc;
  }, []);
}

/** Index of the first datetime column, or -1 if none. */
export function firstDatetimeIndex(columns: KustoColumn[]): number {
  return columns.findIndex((col) => isDatetimeType(col.type));
}

/** Resolved chart configuration: which column is X and which are Y series. */
export interface ChartConfig {
  type: ChartType;
  xIndex: number;
  seriesIndices: number[];
}

/**
 * Auto-detect a sensible chart configuration from the column types:
 * - X axis: first datetime column, else first non-numeric column, else column 0.
 * - Y series: every numeric column that isn't the chosen X column.
 * - Type: "time" when a datetime column drives X, otherwise "column".
 */
export function detectChartConfig(columns: KustoColumn[]): ChartConfig {
  const numeric = numericColumnIndices(columns);
  const datetimeIndex = firstDatetimeIndex(columns);

  let xIndex: number;
  let type: ChartType;
  if (datetimeIndex !== -1) {
    xIndex = datetimeIndex;
    type = "time";
  } else {
    const firstNonNumeric = columns.findIndex((_, i) => !numeric.includes(i));
    xIndex = firstNonNumeric !== -1 ? firstNonNumeric : 0;
    type = "column";
  }

  const seriesIndices = numeric.filter((i) => i !== xIndex);
  return { type, xIndex, seriesIndices };
}

/** A single plotted point: an `x` label plus one keyed value per series. */
export interface ChartPoint {
  x: string;
  [series: string]: string | number | null;
}

/** Everything the chart component needs to render a result set. */
export interface ChartModel {
  points: ChartPoint[];
  /** Series display/data keys, disambiguated when column names collide. */
  seriesKeys: string[];
  xName: string;
  /** True when rows were truncated to `MAX_CHART_POINTS`. */
  capped: boolean;
  totalRows: number;
}

/** Coerce an arbitrary cell value into a finite number, or null. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Render an X value as a stable label. */
function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Build disambiguated series keys from the chosen series column indices. When
 * two columns share a name, later ones are suffixed (e.g. `Count (2)`) so
 * recharts data keys stay unique.
 */
export function seriesKeysFor(
  columns: KustoColumn[],
  seriesIndices: number[],
): string[] {
  const seen = new Map<string, number>();
  return seriesIndices.map((i) => {
    const base = columns[i]?.name ?? `col${i}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/**
 * Shape a result set into chart points for the given config. Rows beyond
 * `maxPoints` are dropped and `capped` is set. Series values coerce to finite
 * numbers, falling back to null for unplottable cells.
 */
export function buildChartModel(
  result: KustoResultSet,
  config: ChartConfig,
  maxPoints: number = MAX_CHART_POINTS,
): ChartModel {
  const { xIndex, seriesIndices } = config;
  const xName = result.columns[xIndex]?.name ?? "";
  const seriesKeys = seriesKeysFor(result.columns, seriesIndices);

  const totalRows = result.rows.length;
  const capped = totalRows > maxPoints;
  const rows = capped ? result.rows.slice(0, maxPoints) : result.rows;

  const points: ChartPoint[] = rows.map((row) => {
    const point: ChartPoint = { x: toLabel(row[xIndex]) };
    seriesIndices.forEach((colIndex, s) => {
      point[seriesKeys[s]] = toNumber(row[colIndex]);
    });
    return point;
  });

  return { points, seriesKeys, xName, capped, totalRows };
}
