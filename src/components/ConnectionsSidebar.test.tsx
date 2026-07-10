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
});
