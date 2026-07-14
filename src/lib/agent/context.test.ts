import { describe, expect, it } from "vitest";

import type { AgentContextEntry, AgentContextTarget } from "../../types/agent";
import type { Connection, QueryTab } from "../../types/kusto";
import {
  buildInitialAgentContext,
  contextKey,
  inheritedContext,
} from "./context";

const connection: Connection = {
  id: "https://help.kusto.windows.net",
  name: "Help",
  clusterUrl: "https://help.kusto.windows.net",
};

const databaseTarget: AgentContextTarget = {
  scope: "database",
  clusterId: connection.id,
  clusterName: connection.name,
  database: "Samples",
};

const entries: AgentContextEntry[] = [
  {
    scope: "cluster",
    clusterId: connection.id,
    clusterName: connection.name,
    key: contextKey({
      scope: "cluster",
      clusterId: connection.id,
      clusterName: connection.name,
    }),
    content: "Use UTC.",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    ...databaseTarget,
    key: contextKey(databaseTarget),
    content: "StormEvents is the primary fact table.",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    ...databaseTarget,
    scope: "table",
    entityKind: "table",
    entityName: "StormEvents",
    key: contextKey({
      ...databaseTarget,
      scope: "table",
      entityKind: "table",
      entityName: "StormEvents",
    }),
    content: "Filter out test states.",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

it("uses stable scoped keys and distinguishes table-like kinds", () => {
  const table = {
    ...databaseTarget,
    scope: "table" as const,
    entityName: "Shared",
  };
  expect(contextKey({ ...table, entityKind: "table" })).not.toBe(
    contextKey({ ...table, entityKind: "materializedView" }),
  );
});

it("inherits table context only for an explicit table target", () => {
  expect(inheritedContext(entries, databaseTarget).map((entry) => entry.scope)).toEqual([
    "cluster",
    "database",
  ]);
  expect(
    inheritedContext(entries, {
      ...databaseTarget,
      scope: "table",
      entityKind: "table",
      entityName: "StormEvents",
    }).map((entry) => entry.scope),
  ).toEqual(["cluster", "database", "table"]);
});

describe("initial disclosure envelope", () => {
  it("includes focused editor text and cluster/database context but no table context", () => {
    const tab: QueryTab = {
      id: "tab-1",
      title: "Draft",
      query: "StormEvents | take 10",
      revision: 2,
      result: null,
      running: false,
      error: null,
      connectionId: connection.id,
      database: "Samples",
    };
    const envelope = buildInitialAgentContext({ tab, connection, entries });
    expect(envelope).toContain("StormEvents | take 10");
    expect(envelope).toContain("Use UTC.");
    expect(envelope).toContain("primary fact table");
    expect(envelope).not.toContain("Filter out test states.");
  });
});
