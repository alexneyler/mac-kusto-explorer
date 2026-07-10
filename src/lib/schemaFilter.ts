// Pure helpers for filtering the schema tree by a search query. Kept free of
// React/store so the matching rules can be unit-tested in isolation.

import type {
  ColumnSchema,
  Connection,
  DatabaseSchema,
  FunctionSchema,
  TableSchema,
} from "../types/kusto";

/** Normalize a raw search box value: trimmed + lower-cased for comparison. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Whether `query` is active (non-empty after trimming). */
export function isFiltering(query: string): boolean {
  return normalizeQuery(query) !== "";
}

/**
 * Case-insensitive substring match. An empty (or whitespace-only) query matches
 * everything, which keeps callers simple when the filter is inactive.
 */
export function matchesText(text: string | undefined | null, query: string): boolean {
  const q = normalizeQuery(query);
  if (q === "") return true;
  if (!text) return false;
  return text.toLowerCase().includes(q);
}

/** Columns whose name (or type) matches the query. */
export function filterColumns(
  columns: ColumnSchema[],
  query: string,
): ColumnSchema[] {
  if (!isFiltering(query)) return columns;
  return columns.filter(
    (c) => matchesText(c.name, query) || matchesText(c.type, query),
  );
}

/** A table matches "itself" when its name or folder matches. */
export function tableSelfMatches(table: TableSchema, query: string): boolean {
  return matchesText(table.name, query) || matchesText(table.folder, query);
}

/** A table is a match when it matches itself or has any matching column. */
export function tableMatches(table: TableSchema, query: string): boolean {
  if (!isFiltering(query)) return true;
  return tableSelfMatches(table, query) || filterColumns(table.columns, query).length > 0;
}

/**
 * Columns to display for a table under the current query. When the table name
 * itself matches, all columns are shown; otherwise only the matching columns.
 */
export function visibleColumns(
  table: TableSchema,
  query: string,
): ColumnSchema[] {
  if (!isFiltering(query) || tableSelfMatches(table, query)) {
    return table.columns;
  }
  return filterColumns(table.columns, query);
}

/** A function matches when its name or folder matches. */
export function functionMatches(fn: FunctionSchema, query: string): boolean {
  return matchesText(fn.name, query) || matchesText(fn.folder, query);
}

/** Tables in a schema that should be shown for the query. */
export function visibleTables(
  schema: DatabaseSchema,
  query: string,
): TableSchema[] {
  if (!isFiltering(query)) return schema.tables;
  return schema.tables.filter((t) => tableMatches(t, query));
}

/** Functions in a schema that should be shown for the query. */
export function visibleFunctions(
  schema: DatabaseSchema,
  query: string,
): FunctionSchema[] {
  if (!isFiltering(query)) return schema.functions;
  return schema.functions.filter((fn) => functionMatches(fn, query));
}

/** Whether any table or function in a loaded schema matches the query. */
export function schemaHasMatch(schema: DatabaseSchema, query: string): boolean {
  if (!isFiltering(query)) return true;
  return (
    visibleTables(schema, query).length > 0 ||
    visibleFunctions(schema, query).length > 0
  );
}

/**
 * Whether a database node should be visible. A database is shown when its own
 * name matches or (if its schema is already loaded) any child matches. Schemas
 * that are not yet loaded contribute no descendant matches — filtering never
 * triggers new loads.
 */
export function databaseVisible(
  database: string,
  schema: DatabaseSchema | undefined,
  query: string,
): boolean {
  if (!isFiltering(query)) return true;
  if (matchesText(database, query)) return true;
  return schema ? schemaHasMatch(schema, query) : false;
}

/** Whether a database has matching descendants (drives filter auto-expand). */
export function databaseHasDescendantMatch(
  schema: DatabaseSchema | undefined,
  query: string,
): boolean {
  if (!isFiltering(query)) return false;
  return schema ? schemaHasMatch(schema, query) : false;
}

/** Resolve the schema for each database name (or undefined when unloaded). */
export type SchemaLookup = (database: string) => DatabaseSchema | undefined;

/**
 * Whether a connection node should be visible: its own name matches, or (if its
 * database list is loaded) any child database is visible.
 */
export function connectionVisible(
  conn: Connection,
  databases: string[] | undefined,
  lookup: SchemaLookup,
  query: string,
): boolean {
  if (!isFiltering(query)) return true;
  if (matchesText(conn.name, query)) return true;
  if (!databases) return false;
  return databases.some((db) => databaseVisible(db, lookup(db), query));
}

/** Whether a connection has matching descendants (drives filter auto-expand). */
export function connectionHasDescendantMatch(
  databases: string[] | undefined,
  lookup: SchemaLookup,
  query: string,
): boolean {
  if (!isFiltering(query) || !databases) return false;
  return databases.some((db) => databaseVisible(db, lookup(db), query));
}
