import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
  runQuery: vi.fn(),
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
}));

import * as api from "../lib/tauri";
import {
  baseDataState,
  schemaKey,
  selectActiveConnection,
  useAppStore,
} from "./appStore";

const mockApi = vi.mocked(api);

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
