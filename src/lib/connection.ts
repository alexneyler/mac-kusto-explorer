// Pure helpers for turning user-typed cluster input into canonical connections.
// Mirrors the backend's `normalize_cluster_url` so the frontend displays and
// de-duplicates connections the same way the backend addresses them.

import type { Connection } from "../types/kusto";

/**
 * Normalize a user-typed cluster reference into a canonical URL.
 *
 * - `https://help.kusto.windows.net/` → `https://help.kusto.windows.net`
 * - `help.kusto.windows.net` → `https://help.kusto.windows.net`
 * - `help` → `https://help.kusto.windows.net`
 *
 * Throws if the input is empty.
 */
export function normalizeClusterUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Cluster URL is empty");
  }
  let withScheme: string;
  if (trimmed.includes("://")) {
    withScheme = trimmed;
  } else if (trimmed.includes(".") || trimmed.includes(":")) {
    withScheme = `https://${trimmed}`;
  } else {
    withScheme = `https://${trimmed}.kusto.windows.net`;
  }
  return withScheme.replace(/\/+$/, "");
}

/** Derive a short, friendly display name from a canonical cluster URL. */
export function deriveConnectionName(clusterUrl: string): string {
  let host = clusterUrl;
  try {
    host = new URL(clusterUrl).host;
  } catch {
    host = clusterUrl.replace(/^[a-z]+:\/\//i, "");
  }
  // `help.kusto.windows.net` → `help`; keep richer hosts mostly intact.
  const firstLabel = host.split(".")[0];
  return firstLabel || host;
}

/** Build a `Connection` from user input, normalizing the URL and name. */
export function makeConnection(input: {
  clusterUrl: string;
  name?: string;
  tenant?: string;
}): Connection {
  const clusterUrl = normalizeClusterUrl(input.clusterUrl);
  const name = input.name?.trim() || deriveConnectionName(clusterUrl);
  const tenant = input.tenant?.trim() || undefined;
  return { id: clusterUrl, name, clusterUrl, tenant };
}
