import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { normalizeClusterUrl } from "../connection";
import { getSchema, completeAgentWorkspaceRequest } from "../tauri";
import { inheritedContext } from "./context";
import { matchesText } from "../schemaSearch";
import { useAppStore } from "../../store/appStore";
import { useContextStore } from "../../store/contextStore";
import type {
  AgentContextTarget,
  AgentWorkspaceRequest,
  AgentWorkspaceResult,
  SchemaEntityKind,
} from "../../types/agent";
import type {
  Connection,
  DatabaseSchema,
  TableSchema,
} from "../../types/kusto";

const ALLOWED_TOOLS = new Set([
  "connect_to_database",
  "get_focused_tab",
  "list_query_tabs",
  "get_database_schema",
  "get_table_schema",
  "search_schema",
  "open_query_tab",
  "replace_query_text",
  "append_query_text",
  "focus_query_tab",
]);

export async function installAgentWorkspaceBridge(): Promise<UnlistenFn> {
  return listen<AgentWorkspaceRequest>(
    "agent-workspace-request",
    async ({ payload }) => {
      let result: AgentWorkspaceResult;
      try {
        if (!ALLOWED_TOOLS.has(payload.tool)) {
          throw new Error(`Tool '${payload.tool}' is not allowed.`);
        }
        result = {
          ok: true,
          value: await executeWorkspaceTool(payload.tool, payload.arguments),
        };
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await completeAgentWorkspaceRequest(payload.id, result);
    },
  );
}

export async function executeWorkspaceTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const state = useAppStore.getState();
  switch (tool) {
    case "connect_to_database": {
      const clusterUrl = requireString(args, "clusterUrl");
      const database = requireString(args, "database");
      const connection = await state.connectDatabase({
        clusterUrl,
        database,
        name: optionalString(args.name) ?? undefined,
        tenant: optionalString(args.tenant) ?? undefined,
      });
      return {
        status: "connected",
        clusterId: connection.id,
        clusterName: connection.name,
        database,
        schemaAvailable: true,
      };
    }
    case "get_focused_tab": {
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      if (!tab) throw new Error("There is no focused query tab.");
      const connection = connectionForId(state.connections, tab.connectionId);
      return {
        id: tab.id,
        title: tab.title,
        query: tab.query,
        revision: tab.revision,
        clusterId: connection?.id ?? null,
        clusterName: connection?.name ?? null,
        database: tab.database,
      };
    }
    case "list_query_tabs":
      return state.tabs.map((tab) => {
        const connection = connectionForId(
          state.connections,
          tab.connectionId,
        );
        return {
          id: tab.id,
          title: tab.title,
          revision: tab.revision,
          clusterId: connection?.id ?? null,
          clusterName: connection?.name ?? null,
          database: tab.database,
        };
      });
    case "get_database_schema": {
      const connection = requireConnection(args.clusterId);
      const database = requireString(args, "database");
      return {
        clusterId: connection.id,
        database,
        schema: await schemaFor(connection, database),
        personalContext: inheritedContext(
          useContextStore.getState().entries,
          contextTarget(connection, database),
        ),
      };
    }
    case "get_table_schema": {
      const connection = requireConnection(args.clusterId);
      const database = requireString(args, "database");
      const entityKind = requireEntityKind(args.entityKind);
      const entityName = requireString(args, "entityName");
      const schema = await schemaFor(connection, database);
      const entity = entitiesForKind(schema, entityKind).find(
        (candidate) => candidate.name === entityName,
      );
      if (!entity) {
        throw new Error(
          `${entityKind} '${entityName}' was not found in '${database}'.`,
        );
      }
      const target = contextTarget(
        connection,
        database,
        entityKind,
        entityName,
      );
      return {
        clusterId: connection.id,
        database,
        entityKind,
        entity,
        personalContext: inheritedContext(
          useContextStore.getState().entries,
          target,
        ),
      };
    }
    case "search_schema": {
      const connection = requireConnection(args.clusterId);
      const database = requireString(args, "database");
      const query = requireString(args, "query");
      const schema = await schemaFor(connection, database);
      return searchSchema(schema, query);
    }
    case "open_query_tab": {
      const clusterId = optionalString(args.clusterId);
      if (clusterId) requireConnection(clusterId);
      const id = state.openQueryTab({
        title: requireString(args, "title"),
        query: requireString(args, "query", true),
        connectionId: clusterId,
        database: optionalString(args.database),
      });
      return { status: "opened", tabId: id };
    }
    case "replace_query_text": {
      const tabId = requireString(args, "tabId");
      const result = state.replaceTabQuery(
        tabId,
        requireString(args, "query", true),
        requireRevision(args.expectedRevision),
      );
      return mutationReceipt(result, tabId);
    }
    case "append_query_text": {
      const tabId = requireString(args, "tabId");
      const result = state.appendTabQuery(
        tabId,
        requireString(args, "query", true),
        requireRevision(args.expectedRevision),
      );
      return mutationReceipt(result, tabId);
    }
    case "focus_query_tab": {
      const tabId = requireString(args, "tabId");
      if (!state.tabs.some((tab) => tab.id === tabId)) {
        throw new Error(`Query tab '${tabId}' was not found.`);
      }
      state.setActiveTab(tabId);
      return { status: "focused", tabId };
    }
    default:
      throw new Error(`Tool '${tool}' is not implemented.`);
  }
}

function connectionForId(
  connections: Connection[],
  id: string | null,
): Connection | undefined {
  return id ? connections.find((connection) => connection.id === id) : undefined;
}

function requireConnection(value: unknown): Connection {
  if (typeof value !== "string") {
    throw new Error("clusterId must be a string.");
  }
  const normalized = normalizeClusterUrl(value);
  const connection = useAppStore
    .getState()
    .connections.find((candidate) => candidate.id === normalized);
  if (!connection) throw new Error(`Cluster '${value}' is not connected.`);
  return connection;
}

async function schemaFor(
  connection: Connection,
  database: string,
): Promise<DatabaseSchema> {
  const state = useAppStore.getState();
  const cached = state.schemaByKey[`${connection.id}::${database}`];
  if (cached) return cached;
  const response = await getSchema({
    cluster: connection.clusterUrl,
    database,
    tenant: connection.tenant,
  });
  return response.database;
}

function contextTarget(
  connection: Connection,
  database?: string,
  entityKind?: SchemaEntityKind,
  entityName?: string,
): AgentContextTarget {
  return {
    scope: entityName ? "table" : database ? "database" : "cluster",
    clusterId: connection.id,
    clusterName: connection.name,
    database,
    entityKind,
    entityName,
  };
}

function entitiesForKind(
  schema: DatabaseSchema,
  kind: SchemaEntityKind,
): TableSchema[] {
  if (kind === "materializedView") return schema.materializedViews;
  if (kind === "externalTable") return schema.externalTables;
  return schema.tables;
}

function searchSchema(schema: DatabaseSchema, query: string): unknown[] {
  const results: unknown[] = [];
  const addEntities = (kind: SchemaEntityKind, entities: TableSchema[]) => {
    for (const entity of entities) {
      const columns = entity.columns.filter(
        (column) =>
          matchesText(column.name, query) || matchesText(column.type, query),
      );
      if (
        matchesText(entity.name, query) ||
        matchesText(entity.folder, query) ||
        matchesText(entity.docString, query) ||
        columns.length
      ) {
        results.push({ kind, entity, matchingColumns: columns });
      }
      if (results.length >= 50) return;
    }
  };
  addEntities("table", schema.tables);
  addEntities("materializedView", schema.materializedViews);
  addEntities("externalTable", schema.externalTables);
  for (const fn of schema.functions) {
    if (
      results.length < 50 &&
      (matchesText(fn.name, query) ||
        matchesText(fn.folder, query) ||
        matchesText(fn.docString, query))
    ) {
      results.push({ kind: "function", entity: fn });
    }
  }
  return results.slice(0, 50);
}

function requireString(
  args: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
  const value = args[key];
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw new Error(`${key} must be a${allowEmpty ? "" : " non-empty"} string.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Expected a string or null.");
  return value;
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("expectedRevision must be a non-negative integer.");
  }
  return value as number;
}

function requireEntityKind(value: unknown): SchemaEntityKind {
  if (
    value === "table" ||
    value === "materializedView" ||
    value === "externalTable"
  ) {
    return value;
  }
  throw new Error("entityKind is not supported.");
}

function mutationReceipt(
  result: "updated" | "conflict" | "not_found",
  tabId: string,
): { status: "updated"; tabId: string } {
  if (result === "conflict") {
    throw new Error(
      `Query tab '${tabId}' changed after it was read. Read it again before editing.`,
    );
  }
  if (result === "not_found") {
    throw new Error(`Query tab '${tabId}' was not found.`);
  }
  return { status: "updated", tabId };
}
