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
} from "../types/kusto";
import { errorMessage } from "../types/kusto";
import { loadPersisted, savePersisted } from "./persist";

export const DEFAULT_QUERY = "StormEvents\n| take 100";

/** Compose the cache key for a (connection, database) schema entry. */
export function schemaKey(connectionId: string, database: string): string {
  return `${connectionId}::${database}`;
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
  setQuery(query: string): void;
  appendToQuery(text: string): void;
  clearError(): void;
  loadDatabases(connectionId: string): Promise<void>;
  loadSchema(connectionId: string, database: string): Promise<void>;
  runActiveQuery(): Promise<void>;
}

export type AppStore = DataState & Actions;

/** Fresh, empty data state (used for init and to reset in tests). */
export function baseDataState(): DataState {
  return {
    connections: [],
    activeConnectionId: null,
    activeDatabase: null,
    databasesByConn: {},
    loadingDbByConn: {},
    schemaByKey: {},
    rawSchemaByKey: {},
    loadingSchemaByKey: {},
    query: DEFAULT_QUERY,
    result: null,
    running: false,
    error: null,
  };
}

function initialState(): DataState {
  const persisted = loadPersisted();
  return {
    ...baseDataState(),
    connections: persisted.connections,
    activeConnectionId: persisted.activeConnectionId,
    activeDatabase: persisted.activeDatabase,
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
        activeConnectionId: conn.id,
        activeDatabase: null,
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
      const activeConnectionId =
        s.activeConnectionId === id
          ? (connections[0]?.id ?? null)
          : s.activeConnectionId;
      const activeDatabase =
        s.activeConnectionId === id ? null : s.activeDatabase;
      return { connections, activeConnectionId, activeDatabase };
    });
    persist(get());
  },

  setActiveConnection(id) {
    if (get().activeConnectionId === id) return;
    set({ activeConnectionId: id, activeDatabase: null });
    persist(get());
    void get().loadDatabases(id);
  },

  setActiveDatabase(database) {
    set({ activeDatabase: database });
    persist(get());
    const connId = get().activeConnectionId;
    if (connId) void get().loadSchema(connId, database);
  },

  setQuery(query) {
    set({ query });
  },

  appendToQuery(text) {
    set((s) => {
      const base = s.query.replace(/\s+$/, "");
      const next = base === "" ? text : `${base}\n${text}`;
      return { query: next };
    });
  },

  clearError() {
    set({ error: null });
  },

  async loadDatabases(connectionId) {
    const conn = get().connections.find((c) => c.id === connectionId);
    if (!conn) return;
    if (get().loadingDbByConn[connectionId]) return;
    set((s) => ({
      loadingDbByConn: { ...s.loadingDbByConn, [connectionId]: true },
      error: null,
    }));
    try {
      const databases = await api.listDatabases({
        cluster: conn.clusterUrl,
        tenant: conn.tenant,
      });
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

  async loadSchema(connectionId, database) {
    const conn = get().connections.find((c) => c.id === connectionId);
    if (!conn) return;
    const key = schemaKey(connectionId, database);
    if (get().schemaByKey[key] || get().loadingSchemaByKey[key]) return;
    set((s) => ({
      loadingSchemaByKey: { ...s.loadingSchemaByKey, [key]: true },
    }));
    try {
      const res = await api.getSchema({
        cluster: conn.clusterUrl,
        database,
        tenant: conn.tenant,
      });
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

    set({ running: true, error: null });
    try {
      const result = await api.runQuery({
        cluster: conn.clusterUrl,
        database: state.activeDatabase,
        query,
        tenant: conn.tenant,
      });
      set({ result });
    } catch (err) {
      set({ error: toError(err), result: null });
    } finally {
      set({ running: false });
    }
  },
}));

function persist(state: DataState): void {
  savePersisted({
    connections: state.connections,
    activeConnectionId: state.activeConnectionId,
    activeDatabase: state.activeDatabase,
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
