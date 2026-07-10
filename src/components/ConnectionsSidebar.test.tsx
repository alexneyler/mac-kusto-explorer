import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  runQuery: vi.fn(),
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
}));

import { makeConnection } from "../lib/connection";
import * as api from "../lib/tauri";
import { baseDataState, useAppStore } from "../store/appStore";
import type { DatabaseSchema } from "../types/kusto";
import { ConnectionsSidebar } from "./ConnectionsSidebar";

const mockApi = vi.mocked(api);

const SCHEMA: DatabaseSchema = {
  name: "Samples",
  tables: [
    {
      name: "StormEvents",
      columns: [
        { name: "State", type: "string" },
        { name: "DeathsDirect", type: "long" },
      ],
    },
  ],
  functions: [],
};

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(baseDataState());
  vi.clearAllMocks();
});

function seedActive() {
  const conn = makeConnection({ clusterUrl: "help" });
  useAppStore.setState({
    connections: [conn],
    activeConnectionId: conn.id,
    databasesByConn: { [conn.id]: ["Samples"] },
  });
  return conn;
}

describe("ConnectionsSidebar", () => {
  it("shows the empty state when there are no connections", () => {
    render(<ConnectionsSidebar />);
    expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
  });

  it("shows databases for the active (auto-expanded) connection", () => {
    seedActive();
    render(<ConnectionsSidebar />);
    expect(screen.getByText("help")).toBeInTheDocument();
    expect(screen.getByText("Samples")).toBeInTheDocument();
  });

  it("selecting a database loads and renders its tables and columns", async () => {
    mockApi.getSchema.mockResolvedValue({ database: SCHEMA, raw: {} });
    seedActive();
    render(<ConnectionsSidebar />);

    await userEvent.click(screen.getByText("Samples"));
    expect(useAppStore.getState().activeDatabase).toBe("Samples");

    // Table appears once the schema resolves.
    const table = await screen.findByText("StormEvents");
    expect(table).toBeInTheDocument();

    // Expand the table to reveal columns.
    await userEvent.click(table);
    expect(await screen.findByText("State")).toBeInTheDocument();
    expect(screen.getByText("DeathsDirect")).toBeInTheDocument();
  });

  it("double-clicking a table inserts its name into the query", async () => {
    mockApi.getSchema.mockResolvedValue({ database: SCHEMA, raw: {} });
    seedActive();
    useAppStore.setState({ query: "" });
    render(<ConnectionsSidebar />);

    await userEvent.click(screen.getByText("Samples"));
    const table = await screen.findByText("StormEvents");
    await userEvent.dblClick(table);

    expect(useAppStore.getState().query).toContain("StormEvents");
  });

  it("auto-loads databases for the persisted active connection on mount", async () => {
    mockApi.listDatabases.mockResolvedValue(["Samples", "TestDB"]);
    const conn = makeConnection({ clusterUrl: "help" });
    // Active + expanded, but databases not yet loaded (simulates app reload).
    useAppStore.setState({
      connections: [conn],
      activeConnectionId: conn.id,
    });
    render(<ConnectionsSidebar />);

    expect(await screen.findByText("Samples")).toBeInTheDocument();
    expect(mockApi.listDatabases).toHaveBeenCalledWith({
      cluster: conn.clusterUrl,
      tenant: undefined,
    });
  });

  it("loads databases when expanding a non-active connection", async () => {
    mockApi.listDatabases.mockResolvedValue(["OtherDB"]);
    const active = makeConnection({ clusterUrl: "help" });
    const other = makeConnection({ clusterUrl: "other" });
    useAppStore.setState({
      connections: [active, other],
      activeConnectionId: active.id,
      databasesByConn: { [active.id]: [] },
    });
    render(<ConnectionsSidebar />);

    // The non-active connection starts collapsed; expanding it loads dbs.
    await userEvent.click(screen.getByText("other"));
    expect(await screen.findByText("OtherDB")).toBeInTheDocument();
    expect(mockApi.listDatabases).toHaveBeenCalledWith({
      cluster: other.clusterUrl,
      tenant: undefined,
    });
  });

  it("refresh does not clear existing databases when the re-fetch fails", async () => {
    mockApi.listDatabases.mockRejectedValue({ kind: "net", message: "down" });
    const conn = seedActive();
    render(<ConnectionsSidebar />);

    expect(screen.getByText("Samples")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Refresh help databases/i }),
    );

    // Old list stays visible; error is recorded.
    expect(screen.getByText("Samples")).toBeInTheDocument();
    expect(useAppStore.getState().databasesByConn[conn.id]).toEqual([
      "Samples",
    ]);
    expect(useAppStore.getState().error).toEqual({
      kind: "net",
      message: "down",
    });
  });

  it("refresh replaces databases on success", async () => {
    mockApi.listDatabases.mockResolvedValue(["Fresh1", "Fresh2"]);
    seedActive();
    render(<ConnectionsSidebar />);

    await userEvent.click(
      screen.getByRole("button", { name: /Refresh help databases/i }),
    );
    expect(await screen.findByText("Fresh1")).toBeInTheDocument();
    expect(screen.getByText("Fresh2")).toBeInTheDocument();
  });
});
