// Shared types mirroring the Rust backend's serialized shapes.

/** A result column: name + Kusto scalar type (e.g. `string`, `long`, `datetime`). */
export interface KustoColumn {
  name: string;
  type: string;
}

/** A tabular result. Cells keep their native JSON type. */
export interface KustoResultSet {
  columns: KustoColumn[];
  rows: unknown[][];
  row_count: number;
}

/** `run_query` response: a result set plus round-trip time in milliseconds. */
export interface QueryResponse extends KustoResultSet {
  elapsed_ms: number;
}

/** A column within a schema table. */
export interface ColumnSchema {
  name: string;
  type: string;
}

/** A table (or view) with ordered columns. */
export interface TableSchema {
  name: string;
  folder?: string;
  docString?: string;
  columns: ColumnSchema[];
}

/** A stored function. */
export interface FunctionSchema {
  name: string;
  folder?: string;
  docString?: string;
}

/** A database's tables and functions, sorted for stable display. */
export interface DatabaseSchema {
  name: string;
  tables: TableSchema[];
  functions: FunctionSchema[];
}

/** `get_schema` response: structured tree + raw payload for monaco-kusto. */
export interface SchemaResponse {
  database: DatabaseSchema;
  // Raw `showSchema.Result` consumed by monaco-kusto's setSchemaFromShowSchema.
  raw: unknown;
}

/** What to include when sharing to the clipboard. */
export type ShareMode =
  | "query"
  | "results"
  | "both"
  | "json"
  | "tsv"
  | "datatable";

/** A file export format for saving results to disk. */
export type ExportFormat = "csv" | "json" | "tsv";

/** Serialized backend error: `{ kind, message }`. */
export interface AppError {
  kind: string;
  message: string;
}

/** A saved cluster connection. */
export interface Connection {
  id: string;
  name: string;
  clusterUrl: string;
  tenant?: string;
}

/**
 * A single query tab. Each tab carries its own editor text, its own
 * result/running/error state, and its own connection/database context.
 */
export interface QueryTab {
  id: string;
  title: string;
  query: string;
  result: QueryResponse | null;
  running: boolean;
  error: AppError | string | null;
  connectionId: string | null;
  database: string | null;
}

/** Type guard for the backend's `{ kind, message }` error shape. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value
  );
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(value: unknown): string {
  if (isAppError(value)) return value.message;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return String(value);
}
