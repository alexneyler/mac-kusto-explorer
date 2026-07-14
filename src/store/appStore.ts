// Central application store (zustand). Holds connections, the lazily-loaded
// schema tree, editor text, and the current result/error. All Tauri access
// goes through `../lib/tauri` so tests can mock a single module.

import { create } from "zustand";

import * as api from "../lib/tauri";
import { makeConnection } from "../lib/connection";
import type {
  AppError,
  Connection,
  DatabaseSchema,
  QueryResponse,
  QueryTab,
} from "../types/kusto";
import { errorMessage } from "../types/kusto";
import { loadPersisted, savePersisted } from "./persist";

export const DEFAULT_QUERY = "StormEvents\n| take 100";
export type TabMutationResult = "updated" | "conflict" | "not_found";

/** Compose the cache key for a (connection, database) schema entry. */
export function schemaKey(connectionId: string, database: string): string {
  return `${connectionId}::${database}`;
}

// Monotonic counter for unique tab ids within a session.
let tabIdSeq = 0;
function newTabId(): string {
  tabIdSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabIdSeq}`;
}

/** Build a fresh tab with transient (result/running/error) fields reset. */
function makeTab(
  title: string,
  query: string,
  connectionId: string | null = null,
  database: string | null = null,
): QueryTab {
  return {
    id: newTabId(),
    title,
    query,
    revision: 0,
    result: null,
    running: false,
    error: null,
    connectionId,
    database,
  };
}

/** Next auto title ("Query N") given the existing tabs. */
function nextTabTitle(tabs: QueryTab[]): string {
  let max = 0;
  for (const t of tabs) {
    const m = /^Query (\d+)$/.exec(t.title);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Query ${max + 1}`;
}

interface DataState {
  connections: Connection[];
  activeConnectionId: string | null;
  activeDatabase: string | null;

  databasesByConn: Record<string, string[]>;
  loadingDbByConn: Record<string, boolean>;

  schemaByKey: Record<string, DatabaseSchema>;
  rawSchemaByKey: Record<string, unknown>;
  loadingSchemaByKey: Record<string, boolean>;

  // Open query tabs and the id of the active one.
  tabs: QueryTab[];
  activeTabId: string;

  // Live mirror of the active tab, kept so existing components/selectors can
  // keep reading `query/result/running/error` directly.
  query: string;
  result: QueryResponse | null;
  running: boolean;
  error: AppError | string | null;
}

interface Actions {
  addConnection(input: {
    clusterUrl: string;
    name?: string;
    tenant?: string;
  }): Connection;
  removeConnection(id: string): void;
  setActiveConnection(id: string): void;
  setActiveDatabase(database: string): void;
  connectDatabase(input: {
    clusterUrl: string;
    database: string;
    name?: string;
    tenant?: string;
  }): Promise<Connection>;
  setQuery(query: string): void;
  appendToQuery(text: string): void;
  clearError(): void;
  addTab(): string;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  renameTab(id: string, title: string): void;
  openQueryTab(input: {
    title?: string;
    query: string;
    connectionId?: string | null;
    database?: string | null;
  }): string;
  replaceTabQuery(
    id: string,
    query: string,
    expectedRevision: number,
  ): TabMutationResult;
  appendTabQuery(
    id: string,
    text: string,
    expectedRevision: number,
  ): TabMutationResult;
  loadDatabases(connectionId: string, force?: boolean): Promise<void>;
  loadSchema(
    connectionId: string,
    database: string,
    force?: boolean,
  ): Promise<void>;
  refreshDatabases(connectionId: string): Promise<void>;
  refreshSchema(connectionId: string, database: string): Promise<void>;
  runActiveQuery(): Promise<void>;
}

export type AppStore = DataState & Actions;

/** Fields shared between a tab and the top-level active mirror. */
type ActivePatch = Partial<
  Pick<
    QueryTab,
    | "query"
    | "revision"
    | "result"
    | "running"
    | "error"
    | "connectionId"
    | "database"
  >
>;

/**
 * Build a state update that patches both the matching entry in `tabs` and the
 * top-level active mirror. The mirror keeps `query/result/running/error` (same
 * names) plus `activeConnectionId`/`activeDatabase` (renamed from the tab's
 * `connectionId`/`database`) so existing components/selectors keep working.
 */
function patchActive(s: DataState, patch: ActivePatch): Partial<DataState> {
  const tabs = s.tabs.map((t) =>
    t.id === s.activeTabId ? { ...t, ...patch } : t,
  );
  const mirror: Partial<DataState> = { tabs };
  if ("query" in patch) mirror.query = patch.query;
  if ("result" in patch) mirror.result = patch.result;
  if ("running" in patch) mirror.running = patch.running;
  if ("error" in patch) mirror.error = patch.error;
  if ("connectionId" in patch)
    mirror.activeConnectionId = patch.connectionId ?? null;
  if ("database" in patch) mirror.activeDatabase = patch.database ?? null;
  return mirror;
}

/** Project a tab's fields into the top-level active mirror. */
function mirrorOf(tab: QueryTab): Partial<DataState> {
  return {
    activeConnectionId: tab.connectionId,
    activeDatabase: tab.database,
    query: tab.query,
    result: tab.result,
    running: tab.running,
    error: tab.error,
  };
}

/** Fresh, empty data state (used for init and to reset in tests). */
export function baseDataState(): DataState {
  const tab = makeTab("Query 1", DEFAULT_QUERY);
  return {
    connections: [],
    activeConnectionId: tab.connectionId,
    activeDatabase: tab.database,
    databasesByConn: {},
    loadingDbByConn: {},
    schemaByKey: {},
    rawSchemaByKey: {},
    loadingSchemaByKey: {},
    tabs: [tab],
    activeTabId: tab.id,
    query: tab.query,
    result: tab.result,
    running: tab.running,
    error: tab.error,
  };
}

function initialState(): DataState {
  const persisted = loadPersisted();
  const base = baseDataState();

  let tabs: QueryTab[];
  let activeTabId: string;
  if (persisted.tabs && persisted.tabs.length > 0) {
    tabs = persisted.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      query: t.query,
      revision: t.revision,
      result: null,
      running: false,
      error: null,
      connectionId: t.connectionId ?? null,
      database: t.database ?? null,
    }));
    activeTabId =
      persisted.activeTabId && tabs.some((t) => t.id === persisted.activeTabId)
        ? persisted.activeTabId
        : tabs[0].id;
  } else {
    // Migrate legacy single-workspace persisted state into one default tab.
    const query =
      typeof persisted.query === "string" && persisted.query.length > 0
        ? persisted.query
        : DEFAULT_QUERY;
    const tab = makeTab(
      "Query 1",
      query,
      persisted.activeConnectionId,
      persisted.activeDatabase,
    );
    tabs = [tab];
    activeTabId = tab.id;
  }

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  return {
    ...base,
    connections: persisted.connections,
    tabs,
    activeTabId,
    ...mirrorOf(active),
  };
}

export const useAppStore = create<AppStore>((set, get) => ({
  ...initialState(),

  addConnection(input) {
    const conn = makeConnection(input);
    set((s) => {
      const exists = s.connections.some((c) => c.id === conn.id);
      const connections = exists
        ? s.connections.map((c) => (c.id === conn.id ? conn : c))
        : [...s.connections, conn];
      return {
        connections,
        // Point the active tab at the freshly-added connection.
        ...patchActive(s, { connectionId: conn.id, database: null }),
      };
    });
    persist(get());
    // Kick off a database listing for the freshly-selected connection.
    void get().loadDatabases(conn.id);
    return conn;
  },

  removeConnection(id) {
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id);
      // Drop the removed connection from any tab that referenced it, so no tab
      // is left pointing at a connection that no longer exists.
      const fallback = connections[0]?.id ?? null;
      const tabs = s.tabs.map((t) =>
        t.connectionId === id
          ? { ...t, connectionId: fallback, database: null }
          : t,
      );
      const active = tabs.find((t) => t.id === s.activeTabId) ?? tabs[0];
      return { connections, tabs, ...mirrorOf(active) };
    });
    persist(get());
  },

  setActiveConnection(id) {
    if (get().activeConnectionId === id) return;
    set((s) => patchActive(s, { connectionId: id, database: null }));
    persist(get());
    void get().loadDatabases(id);
  },

  setActiveDatabase(database) {
    set((s) => patchActive(s, { database }));
    persist(get());
    const connId = get().activeConnectionId;
    if (connId) void get().loadSchema(connId, database);
  },

  async connectDatabase(input) {
    const targetTabId = get().activeTabId;
    const requested = makeConnection({
      clusterUrl: input.clusterUrl,
      name: input.name,
      tenant: input.tenant,
    });
    const existing = get().connections.find(
      (connection) => connection.id === requested.id,
    );
    const connection: Connection = {
      ...requested,
      name: input.name?.trim() || existing?.name || requested.name,
      tenant: input.tenant?.trim() || existing?.tenant,
    };
    const response = await api.getSchema({
      cluster: connection.clusterUrl,
      database: input.database,
      tenant: connection.tenant,
    });
    if (!get().tabs.some((tab) => tab.id === targetTabId)) {
      throw new Error("The focused query tab was closed before connecting.");
    }
    const key = schemaKey(connection.id, input.database);
    set((state) => {
      const connections = existing
        ? state.connections.map((candidate) =>
            candidate.id === connection.id ? connection : candidate,
          )
        : [...state.connections, connection];
      const databases = state.databasesByConn[connection.id] ?? [];
      const tabs = state.tabs.map((tab) =>
        tab.id === targetTabId
          ? {
              ...tab,
              connectionId: connection.id,
              database: input.database,
            }
          : tab,
      );
      const activeContext =
        state.activeTabId === targetTabId
          ? {
              activeConnectionId: connection.id,
              activeDatabase: input.database,
            }
          : {};
      return {
        connections,
        tabs,
        databasesByConn: {
          ...state.databasesByConn,
          [connection.id]: databases.includes(input.database)
            ? databases
            : [...databases, input.database].sort(),
        },
        schemaByKey: {
          ...state.schemaByKey,
          [key]: response.database,
        },
        rawSchemaByKey: {
          ...state.rawSchemaByKey,
          [key]: response.raw,
        },
        error: null,
        ...activeContext,
      };
    });
    persist(get());
    void get().refreshDatabases(connection.id);
    return connection;
  },

  setQuery(query) {
    set((s) => {
      const active = s.tabs.find((tab) => tab.id === s.activeTabId);
      return patchActive(s, {
        query,
        revision: (active?.revision ?? 0) + 1,
      });
    });
    // Desktop app: localStorage writes are cheap, so persist immediately
    // rather than debouncing. This keeps the editor text across reloads.
    persist(get());
  },

  appendToQuery(text) {
    set((s) => {
      const base = s.query.replace(/\s+$/, "");
      const next = base === "" ? text : `${base}\n${text}`;
      const active = s.tabs.find((tab) => tab.id === s.activeTabId);
      return patchActive(s, {
        query: next,
        revision: (active?.revision ?? 0) + 1,
      });
    });
    persist(get());
  },

  clearError() {
    set((s) => patchActive(s, { error: null }));
  },

  addTab() {
    const s0 = get();
    // A new tab inherits the currently active connection/database so the user
    // can immediately run against the same context; it can be changed later.
    const tab = makeTab(
      nextTabTitle(s0.tabs),
      "",
      s0.activeConnectionId,
      s0.activeDatabase,
    );
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      ...mirrorOf(tab),
    }));
    persist(get());
    return tab.id;
  },

  closeTab(id) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const remaining = s.tabs.filter((t) => t.id !== id);
      // Never leave the app with zero tabs: replace the last one with a fresh
      // default tab that keeps the closed tab's connection/database context.
      if (remaining.length === 0) {
        const closed = s.tabs[idx];
        const fresh = makeTab(
          "Query 1",
          DEFAULT_QUERY,
          closed.connectionId,
          closed.database,
        );
        return { tabs: [fresh], activeTabId: fresh.id, ...mirrorOf(fresh) };
      }
      // Keep the active tab if it wasn't the one closed; otherwise select the
      // neighbour (prefer the tab to the left).
      let activeTabId = s.activeTabId;
      if (id === s.activeTabId) {
        const neighbour = remaining[Math.max(0, idx - 1)];
        activeTabId = neighbour.id;
      }
      const active = remaining.find((t) => t.id === activeTabId) ?? remaining[0];
      return { tabs: remaining, activeTabId: active.id, ...mirrorOf(active) };
    });
    persist(get());
  },

  setActiveTab(id) {
    if (get().activeTabId === id) return;
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set({ activeTabId: tab.id, ...mirrorOf(tab) });
    persist(get());
    // Make sure the newly-active tab's databases/schema are available so the
    // Toolbar selectors and IntelliSense reflect its context.
    if (tab.connectionId) {
      void get().loadDatabases(tab.connectionId);
      if (tab.database) void get().loadSchema(tab.connectionId, tab.database);
    }
  },

  renameTab(id, title) {
    const trimmed = title.trim();
    if (trimmed === "") return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    }));
    persist(get());
  },

  openQueryTab(input) {
    const s0 = get();
    const tab = makeTab(
      input.title?.trim() || nextTabTitle(s0.tabs),
      input.query,
      input.connectionId === undefined
        ? s0.activeConnectionId
        : input.connectionId,
      input.database === undefined ? s0.activeDatabase : input.database,
    );
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      ...mirrorOf(tab),
    }));
    persist(get());
    return tab.id;
  },

  replaceTabQuery(id, query, expectedRevision) {
    const tab = get().tabs.find((item) => item.id === id);
    if (!tab) return "not_found";
    if (tab.revision !== expectedRevision) return "conflict";
    const next = { ...tab, query, revision: tab.revision + 1 };
    set((s) => ({
      tabs: s.tabs.map((item) => (item.id === id ? next : item)),
      ...(s.activeTabId === id ? { query: next.query } : {}),
    }));
    persist(get());
    return "updated";
  },

  appendTabQuery(id, text, expectedRevision) {
    const tab = get().tabs.find((item) => item.id === id);
    if (!tab) return "not_found";
    if (tab.revision !== expectedRevision) return "conflict";
    const base = tab.query.replace(/\s+$/, "");
    const query = base === "" ? text : `${base}\n${text}`;
    const next = { ...tab, query, revision: tab.revision + 1 };
    set((s) => ({
      tabs: s.tabs.map((item) => (item.id === id ? next : item)),
      ...(s.activeTabId === id ? { query: next.query } : {}),
    }));
    persist(get());
    return "updated";
  },

  async loadDatabases(connectionId, force = false) {
    const conn = get().connections.find((c) => c.id === connectionId);
    if (!conn) return;
    if (get().loadingDbByConn[connectionId]) return;
    // Without `force`, skip when we already have a cached list.
    if (!force && get().databasesByConn[connectionId]) return;
    set((s) => ({
      loadingDbByConn: { ...s.loadingDbByConn, [connectionId]: true },
      error: null,
    }));
    try {
      const databases = await api.listDatabases({
        cluster: conn.clusterUrl,
        tenant: conn.tenant,
      });
      // Only replace the cached list on success, so a failed refresh never
      // wipes the databases already on screen.
      set((s) => ({
        databasesByConn: { ...s.databasesByConn, [connectionId]: databases },
      }));
    } catch (err) {
      set({ error: toError(err) });
    } finally {
      set((s) => ({
        loadingDbByConn: { ...s.loadingDbByConn, [connectionId]: false },
      }));
    }
  },

  async loadSchema(connectionId, database, force = false) {
    const conn = get().connections.find((c) => c.id === connectionId);
    if (!conn) return;
    const key = schemaKey(connectionId, database);
    if (get().loadingSchemaByKey[key]) return;
    // Without `force`, skip when the schema is already cached.
    if (!force && get().schemaByKey[key]) return;
    set((s) => ({
      loadingSchemaByKey: { ...s.loadingSchemaByKey, [key]: true },
    }));
    try {
      const res = await api.getSchema({
        cluster: conn.clusterUrl,
        database,
        tenant: conn.tenant,
      });
      // Only replace the cached schema on success; the previous value stays
      // visible until the fresh one arrives.
      set((s) => ({
        schemaByKey: { ...s.schemaByKey, [key]: res.database },
        rawSchemaByKey: { ...s.rawSchemaByKey, [key]: res.raw },
      }));
    } catch (err) {
      set({ error: toError(err) });
    } finally {
      set((s) => ({
        loadingSchemaByKey: { ...s.loadingSchemaByKey, [key]: false },
      }));
    }
  },

  refreshDatabases(connectionId) {
    return get().loadDatabases(connectionId, true);
  },

  refreshSchema(connectionId, database) {
    return get().loadSchema(connectionId, database, true);
  },

  async runActiveQuery() {
    const state = get();
    const conn = state.connections.find(
      (c) => c.id === state.activeConnectionId,
    );
    if (!conn) {
      set({ error: "Select a connection first." });
      return;
    }
    if (!state.activeDatabase) {
      set({ error: "Select a database first." });
      return;
    }
    const query = state.query.trim();
    if (query === "") {
      set({ error: "Enter a query to run." });
      return;
    }
    if (state.running) return;

    set((s) => patchActive(s, { running: true, error: null }));
    try {
      const result = await api.runQuery({
        cluster: conn.clusterUrl,
        database: state.activeDatabase,
        query,
        tenant: conn.tenant,
      });
      set((s) => patchActive(s, { result }));
    } catch (err) {
      set((s) => patchActive(s, { error: toError(err), result: null }));
    } finally {
      set((s) => patchActive(s, { running: false }));
    }
  },
}));

function persist(state: DataState): void {
  savePersisted({
    connections: state.connections,
    activeConnectionId: state.activeConnectionId,
    activeDatabase: state.activeDatabase,
    query: state.query,
    tabs: state.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      query: t.query,
      revision: t.revision,
      connectionId: t.connectionId,
      database: t.database,
    })),
    activeTabId: state.activeTabId,
  });
}

function toError(err: unknown): AppError | string {
  if (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    "message" in err
  ) {
    return err as AppError;
  }
  return errorMessage(err);
}

/** Selector: the currently active connection, if any. */
export function selectActiveConnection(s: AppStore): Connection | null {
  return s.connections.find((c) => c.id === s.activeConnectionId) ?? null;
}
