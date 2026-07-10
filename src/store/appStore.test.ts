import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
  runQuery: vi.fn(),
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
}));

import * as api from "../lib/tauri";
import { makeConnection } from "../lib/connection";
import { loadPersisted, savePersisted } from "./persist";
import {
  baseDataState,
  schemaKey,
  selectActiveConnection,
  useAppStore,
} from "./appStore";

const mockApi = vi.mocked(api);

function makeConn() {
  return makeConnection({ clusterUrl: "help" });
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(baseDataState());
  vi.clearAllMocks();
});

describe("addConnection", () => {
  it("adds, selects, and derives id/name", () => {
    mockApi.listDatabases.mockResolvedValue([]);
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    expect(conn.id).toBe("https://help.kusto.windows.net");
    const s = useAppStore.getState();
    expect(s.connections).toHaveLength(1);
    expect(s.activeConnectionId).toBe(conn.id);
    expect(selectActiveConnection(s)).toEqual(conn);
    // Adding kicks off a database listing.
    expect(mockApi.listDatabases).toHaveBeenCalledWith({
      cluster: "https://help.kusto.windows.net",
      tenant: undefined,
    });
  });

  it("de-duplicates by normalized id", () => {
    mockApi.listDatabases.mockResolvedValue([]);
    useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore
      .getState()
      .addConnection({ clusterUrl: "https://help.kusto.windows.net/" });
    expect(useAppStore.getState().connections).toHaveLength(1);
  });

  it("persists to localStorage", () => {
    mockApi.listDatabases.mockResolvedValue([]);
    useAppStore.getState().addConnection({ clusterUrl: "help" });
    expect(localStorage.getItem("kusto-explorer.state.v1")).toContain(
      "help.kusto.windows.net",
    );
  });
});

describe("loadDatabases", () => {
  it("stores the returned database list", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples", "TestDB"]);
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    await useAppStore.getState().loadDatabases(conn.id);
    expect(useAppStore.getState().databasesByConn[conn.id]).toEqual([
      "Samples",
      "TestDB",
    ]);
  });

  it("records an error on failure", async () => {
    mockApi.listDatabases.mockRejectedValue({
      kind: "auth",
      message: "no token",
    });
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    await useAppStore.getState().loadDatabases(conn.id);
    expect(useAppStore.getState().error).toEqual({
      kind: "auth",
      message: "no token",
    });
  });
});

describe("setActiveDatabase", () => {
  it("selects the database and loads its schema once", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples"]);
    mockApi.getSchema.mockResolvedValue({
      database: { name: "Samples", tables: [], functions: [] },
      raw: { Databases: {} },
    });
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.getState().setActiveDatabase("Samples");
    // let the async loadSchema resolve
    await vi.waitFor(() =>
      expect(
        useAppStore.getState().schemaByKey[schemaKey(conn.id, "Samples")],
      ).toBeDefined(),
    );
    expect(useAppStore.getState().activeDatabase).toBe("Samples");
    expect(mockApi.getSchema).toHaveBeenCalledTimes(1);

    // Selecting again should not refetch (cached).
    useAppStore.getState().setActiveDatabase("Samples");
    expect(mockApi.getSchema).toHaveBeenCalledTimes(1);
  });
});

describe("runActiveQuery", () => {
  it("requires a connection", async () => {
    await useAppStore.getState().runActiveQuery();
    expect(useAppStore.getState().error).toBe("Select a connection first.");
  });

  it("requires a database", async () => {
    mockApi.listDatabases.mockResolvedValue([]);
    useAppStore.getState().addConnection({ clusterUrl: "help" });
    await useAppStore.getState().runActiveQuery();
    expect(useAppStore.getState().error).toBe("Select a database first.");
  });

  it("runs and stores the result", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples"]);
    mockApi.runQuery.mockResolvedValue({
      columns: [{ name: "n", type: "long" }],
      rows: [[1]],
      row_count: 1,
      elapsed_ms: 12,
    });
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.setState({ activeDatabase: "Samples", query: "T | count" });
    await useAppStore.getState().runActiveQuery();
    const s = useAppStore.getState();
    expect(mockApi.runQuery).toHaveBeenCalledWith({
      cluster: conn.clusterUrl,
      database: "Samples",
      query: "T | count",
      tenant: undefined,
    });
    expect(s.result?.row_count).toBe(1);
    expect(s.running).toBe(false);
    expect(s.error).toBeNull();
  });

  it("captures a query error and clears the result", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples"]);
    mockApi.runQuery.mockRejectedValue({ kind: "kusto", message: "Syntax" });
    useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.setState({ activeDatabase: "Samples", query: "bad" });
    await useAppStore.getState().runActiveQuery();
    const s = useAppStore.getState();
    expect(s.error).toEqual({ kind: "kusto", message: "Syntax" });
    expect(s.result).toBeNull();
  });
});

describe("removeConnection", () => {
  it("removes and reselects the first remaining connection", () => {
    mockApi.listDatabases.mockResolvedValue([]);
    const a = useAppStore.getState().addConnection({ clusterUrl: "a" });
    const b = useAppStore.getState().addConnection({ clusterUrl: "b" });
    expect(useAppStore.getState().activeConnectionId).toBe(b.id);
    useAppStore.getState().removeConnection(b.id);
    const s = useAppStore.getState();
    expect(s.connections).toHaveLength(1);
    expect(s.activeConnectionId).toBe(a.id);
  });
});

describe("query tabs", () => {
  it("starts with a single default tab mirrored into the active fields", () => {
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].query).toBe(s.query);
    expect(s.tabs[0].title).toBe("Query 1");
  });

  it("addTab creates an empty tab, selects it, and clears the mirror", () => {
    useAppStore.setState({ result: { columns: [], rows: [], row_count: 0, elapsed_ms: 1 } });
    const id = useAppStore.getState().addTab();
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabId).toBe(id);
    expect(s.tabs[1].title).toBe("Query 2");
    expect(s.query).toBe("");
    expect(s.result).toBeNull();
  });

  it("keeps per-tab query text isolated", () => {
    const first = useAppStore.getState().activeTabId;
    useAppStore.getState().setQuery("first tab query");
    const second = useAppStore.getState().addTab();
    useAppStore.getState().setQuery("second tab query");

    useAppStore.getState().setActiveTab(first);
    expect(useAppStore.getState().query).toBe("first tab query");
    useAppStore.getState().setActiveTab(second);
    expect(useAppStore.getState().query).toBe("second tab query");
  });

  it("keeps per-tab results isolated across a run", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples"]);
    mockApi.runQuery.mockResolvedValue({
      columns: [{ name: "n", type: "long" }],
      rows: [[1]],
      row_count: 1,
      elapsed_ms: 3,
    });
    useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.setState({ activeDatabase: "Samples" });

    const first = useAppStore.getState().activeTabId;
    await useAppStore.getState().runActiveQuery();
    expect(useAppStore.getState().result?.row_count).toBe(1);

    // A fresh tab has no result of its own.
    const second = useAppStore.getState().addTab();
    expect(useAppStore.getState().result).toBeNull();

    // Switching back restores the first tab's result.
    useAppStore.getState().setActiveTab(first);
    expect(useAppStore.getState().result?.row_count).toBe(1);
    useAppStore.getState().setActiveTab(second);
    expect(useAppStore.getState().result).toBeNull();
  });

  it("keeps per-tab connection/database context isolated", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples", "Other"]);
    mockApi.getSchema.mockResolvedValue({
      database: { name: "Samples", tables: [], functions: [] },
      raw: {},
    });
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.getState().setActiveDatabase("Samples");

    const first = useAppStore.getState().activeTabId;
    expect(useAppStore.getState().tabs[0].connectionId).toBe(conn.id);
    expect(useAppStore.getState().tabs[0].database).toBe("Samples");

    // New tab inherits the active context, then diverges.
    const second = useAppStore.getState().addTab();
    expect(useAppStore.getState().activeConnectionId).toBe(conn.id);
    expect(useAppStore.getState().activeDatabase).toBe("Samples");
    useAppStore.getState().setActiveDatabase("Other");
    expect(useAppStore.getState().activeDatabase).toBe("Other");

    // Switching back restores the first tab's database into the mirror.
    useAppStore.getState().setActiveTab(first);
    expect(useAppStore.getState().activeDatabase).toBe("Samples");
    useAppStore.getState().setActiveTab(second);
    expect(useAppStore.getState().activeDatabase).toBe("Other");
  });

  it("drops a removed connection from every tab", () => {
    mockApi.listDatabases.mockResolvedValue([]);
    const a = useAppStore.getState().addConnection({ clusterUrl: "a" });
    useAppStore.getState().addTab();
    const b = useAppStore.getState().addConnection({ clusterUrl: "b" });
    // tab 1 -> a, tab 2 -> b (active)
    useAppStore.getState().removeConnection(b.id);
    const s = useAppStore.getState();
    expect(s.tabs.every((t) => t.connectionId !== b.id)).toBe(true);
    // The active tab falls back to the first remaining connection.
    expect(s.activeConnectionId).toBe(a.id);
  });

  it("closeTab removes the tab and selects the left neighbour", () => {
    const first = useAppStore.getState().activeTabId;
    const second = useAppStore.getState().addTab();
    useAppStore.getState().setActiveTab(second);
    useAppStore.getState().closeTab(second);
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(first);
  });

  it("closing the last remaining tab replaces it with a fresh default", () => {
    const only = useAppStore.getState().activeTabId;
    useAppStore.getState().closeTab(only);
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).not.toBe(only);
    expect(s.tabs[0].query).toBe("StormEvents\n| take 100");
    expect(s.query).toBe("StormEvents\n| take 100");
  });

  it("renameTab updates the title but ignores blank names", () => {
    const id = useAppStore.getState().activeTabId;
    useAppStore.getState().renameTab(id, "My analysis");
    expect(useAppStore.getState().tabs[0].title).toBe("My analysis");
    useAppStore.getState().renameTab(id, "   ");
    expect(useAppStore.getState().tabs[0].title).toBe("My analysis");
  });

  it("persists tabs and restores them on store re-creation", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples"]);
    const conn = useAppStore.getState().addConnection({ clusterUrl: "help" });
    useAppStore.getState().setQuery("tab one");
    useAppStore.getState().setActiveDatabase("Samples");
    useAppStore.getState().addTab();
    useAppStore.getState().setQuery("tab two");
    expect(loadPersisted().tabs).toHaveLength(2);

    vi.resetModules();
    const fresh = await import("./appStore");
    const s = fresh.useAppStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs.map((t) => t.query)).toEqual(["tab one", "tab two"]);
    // Per-tab connection/database context survives a reload.
    expect(s.tabs[0].connectionId).toBe(conn.id);
    expect(s.tabs[0].database).toBe("Samples");
  });
});

describe("query persistence", () => {
  it("persists the query on setQuery", () => {
    useAppStore.getState().setQuery("Persisted | take 3");
    expect(loadPersisted().query).toBe("Persisted | take 3");
  });

  it("persists the query on appendToQuery", () => {
    useAppStore.setState({ query: "Base" });
    useAppStore.getState().appendToQuery("MyTable");
    expect(loadPersisted().query).toBe("Base\nMyTable");
  });

  it("hydrates the query from persisted state on store (re)creation", async () => {
    savePersisted({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      query: "Remembered | take 7",
    });
    vi.resetModules();
    const fresh = await import("./appStore");
    expect(fresh.useAppStore.getState().query).toBe("Remembered | take 7");
  });

  it("falls back to DEFAULT_QUERY when no query is persisted", async () => {
    vi.resetModules();
    const fresh = await import("./appStore");
    expect(fresh.useAppStore.getState().query).toBe(fresh.DEFAULT_QUERY);
  });
});

describe("refresh (force reload)", () => {
  it("keeps existing databases when a refresh fails", async () => {
    mockApi.listDatabases.mockRejectedValue({ kind: "net", message: "down" });
    const conn = makeConn();
    useAppStore.setState({
      connections: [conn],
      activeConnectionId: conn.id,
      databasesByConn: { [conn.id]: ["Samples", "TestDB"] },
    });
    await useAppStore.getState().refreshDatabases(conn.id);
    const s = useAppStore.getState();
    expect(s.databasesByConn[conn.id]).toEqual(["Samples", "TestDB"]);
    expect(s.error).toEqual({ kind: "net", message: "down" });
  });

  it("replaces databases on a successful refresh", async () => {
    mockApi.listDatabases.mockResolvedValue(["A", "B", "C"]);
    const conn = makeConn();
    useAppStore.setState({
      connections: [conn],
      databasesByConn: { [conn.id]: ["Samples"] },
    });
    await useAppStore.getState().refreshDatabases(conn.id);
    expect(useAppStore.getState().databasesByConn[conn.id]).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("keeps existing schema when a schema refresh fails", async () => {
    mockApi.getSchema.mockRejectedValue({ kind: "net", message: "down" });
    const conn = makeConn();
    const key = schemaKey(conn.id, "Samples");
    const existing = { name: "Samples", tables: [], functions: [] };
    useAppStore.setState({
      connections: [conn],
      schemaByKey: { [key]: existing },
    });
    await useAppStore.getState().refreshSchema(conn.id, "Samples");
    const s = useAppStore.getState();
    expect(s.schemaByKey[key]).toBe(existing);
    expect(s.error).toEqual({ kind: "net", message: "down" });
  });

  it("bypasses the schema cache guard on a forced refresh", async () => {
    const fresh = { name: "Samples", tables: [], functions: [] };
    mockApi.getSchema.mockResolvedValue({ database: fresh, raw: {} });
    const conn = makeConn();
    const key = schemaKey(conn.id, "Samples");
    useAppStore.setState({
      connections: [conn],
      schemaByKey: { [key]: { name: "Samples", tables: [], functions: [] } },
    });
    await useAppStore.getState().refreshSchema(conn.id, "Samples");
    expect(mockApi.getSchema).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().schemaByKey[key]).toBe(fresh);
  });
});
