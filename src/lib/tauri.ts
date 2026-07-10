// Typed wrappers around Tauri `invoke` calls. Keeping the command names and
// argument shapes in one place makes the rest of the app easy to test (mock
// this module) and keeps the string command names from leaking everywhere.

import { invoke } from "@tauri-apps/api/core";

import type {
  DatabaseSchema,
  ExportFormat,
  KustoResultSet,
  QueryResponse,
  SchemaResponse,
  ShareMode,
} from "../types/kusto";

/** Run a KQL query or `.`-prefixed management command. */
export function runQuery(args: {
  cluster: string;
  database: string;
  query: string;
  tenant?: string;
}): Promise<QueryResponse> {
  return invoke<QueryResponse>("run_query", {
    cluster: args.cluster,
    database: args.database,
    query: args.query,
    tenant: args.tenant ?? null,
  });
}

/** List database names on a cluster. */
export function listDatabases(args: {
  cluster: string;
  tenant?: string;
}): Promise<string[]> {
  return invoke<string[]>("list_databases", {
    cluster: args.cluster,
    tenant: args.tenant ?? null,
  });
}

/** Fetch a database's schema (structured tree + raw payload for IntelliSense). */
export function getSchema(args: {
  cluster: string;
  database: string;
  tenant?: string;
}): Promise<SchemaResponse> {
  return invoke<SchemaResponse>("get_schema", {
    cluster: args.cluster,
    database: args.database,
    tenant: args.tenant ?? null,
  });
}

/** Build clipboard text for the Share button. */
export function formatShare(args: {
  mode: ShareMode;
  query: string;
  result: KustoResultSet;
}): Promise<string> {
  return invoke<string>("format_share", {
    mode: args.mode,
    query: args.query,
    result: args.result,
  });
}

/** Write a result set to `path` as CSV. */
export function exportCsv(args: {
  path: string;
  result: KustoResultSet;
}): Promise<void> {
  return invoke<void>("export_csv", {
    path: args.path,
    result: args.result,
  });
}

/** Write a result set to `path` in the requested format (CSV/JSON/TSV). */
export function exportResult(args: {
  path: string;
  format: ExportFormat;
  result: KustoResultSet;
}): Promise<void> {
  return invoke<void>("export_result", {
    path: args.path,
    format: args.format,
    result: args.result,
  });
}

export type { DatabaseSchema };
