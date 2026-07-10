// Pure, client-side statistics over a loaded result set. Kept separate from the
// grid component so the grouping/aggregation rules can be unit-tested without a
// DOM. All functions operate on the rows already in memory — no KQL, no I/O.

import type { KustoResultSet } from "../types/kusto";
import { formatCell } from "./cell";

/**
 * Whether a raw cell value counts as "empty": null/undefined, or a string that
 * is empty or whitespace-only. Used for hiding empty columns and for the null
 * bucket of a distribution so both agree on what "no value" means.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/**
 * Indexes of columns whose every cell is empty (see {@link isEmptyValue}).
 * A result with no rows reports no empty columns — there is nothing to hide.
 */
export function emptyColumnIndexes(result: KustoResultSet): number[] {
  if (result.rows.length === 0) return [];
  const empty: number[] = [];
  for (let col = 0; col < result.columns.length; col++) {
    let allEmpty = true;
    for (const row of result.rows) {
      if (!isEmptyValue(row[col])) {
        allEmpty = false;
        break;
      }
    }
    if (allEmpty) empty.push(col);
  }
  return empty;
}

/** A single value bucket within a column distribution. */
export interface DistributionBucket {
  value: string;
  count: number;
  percent: number;
}

/** Aggregated value distribution for one column of a result set. */
export interface ColumnDistribution {
  /** Total number of rows considered. */
  total: number;
  /** Number of distinct non-empty values. */
  distinctCount: number;
  /** Number of empty (null/blank) cells. */
  nullCount: number;
  /** Top buckets by count (desc), ties broken by value (asc). */
  top: DistributionBucket[];
}

/**
 * Compute the value distribution for `columnIndex` from the loaded rows. Values
 * are grouped by their displayed text (via {@link formatCell}) so buckets match
 * exactly what the user sees in the grid. Empty cells are counted separately as
 * `nullCount` rather than forming a bucket. Percentages are of `total` rows.
 */
export function columnDistribution(
  result: KustoResultSet,
  columnIndex: number,
  topN = 10,
): ColumnDistribution {
  const total = result.rows.length;
  const counts = new Map<string, number>();
  let nullCount = 0;

  for (const row of result.rows) {
    const value = row[columnIndex];
    if (isEmptyValue(value)) {
      nullCount++;
      continue;
    }
    const key = formatCell(value).text;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count,
      percent: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, Math.max(0, topN));

  return { total, distinctCount: counts.size, nullCount, top };
}
