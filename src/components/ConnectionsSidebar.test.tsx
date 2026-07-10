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
    {
      name: "PopulationData",
      columns: [
        { name: "State", type: "string" },
        { name: "Population", type: "long" },
      ],
    },
  ],
  functions: [{ name: "MyStormFn" }],
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

function seedActiveWithSchema() {
  const conn = seedActive();
  useAppStore.setState({
    schemaByKey: { [`${conn.id}::Samples`]: SCHEMA },
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

describe("ConnectionsSidebar schema filter", () => {
  it("hides the search box when there are no connections", () => {
    render(<ConnectionsSidebar />);
    expect(
      screen.queryByRole("searchbox", { name: /filter schema/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the search box once a connection exists", () => {
    seedActive();
    render(<ConnectionsSidebar />);
    expect(
      screen.getByRole("searchbox", { name: /filter schema/i }),
    ).toBeInTheDocument();
  });

  it("filters loaded tables by name and hides non-matches", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    // Both tables visible once the Samples database is expanded.
    await userEvent.click(screen.getByText("Samples"));
    expect(await screen.findByText("StormEvents")).toBeInTheDocument();
    expect(screen.getByText("PopulationData")).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /filter schema/i }),
      "storm",
    );

    // Matching labels are split by the highlight; assert via the <mark> runs.
    // StormEvents (table) and MyStormFn (function) each contain "Storm".
    expect(
      screen.getAllByText("Storm", { selector: "mark" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.queryByText("PopulationData")).not.toBeInTheDocument();
  });

  it("highlights the matching substring in labels", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    await userEvent.type(
      screen.getByRole("searchbox", { name: /filter schema/i }),
      "storm",
    );

    // The matched run is wrapped in a <mark>; the remainder is not.
    const mark = screen.getAllByText("Storm", { selector: "mark" })[0];
    expect(mark.tagName).toBe("MARK");
    expect(screen.getByText("Events")).toBeInTheDocument();
  });

  it("shows a match count while filtering", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    await userEvent.type(
      screen.getByRole("searchbox", { name: /filter schema/i }),
      "storm",
    );

    // StormEvents (table) + MyStormFn (function) = 2 matches.
    expect(screen.getByText("2 matches")).toBeInTheDocument();
  });

  it("focuses the search box on Ctrl+F", async () => {
    seedActive();
    render(<ConnectionsSidebar />);
    const box = screen.getByRole("searchbox", { name: /filter schema/i });
    expect(box).not.toHaveFocus();

    await userEvent.keyboard("{Control>}f{/Control}");
    expect(box).toHaveFocus();
  });

  it("auto-expands a table to reveal a matching column", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    await userEvent.type(
      screen.getByRole("searchbox", { name: /filter schema/i }),
      "deaths",
    );

    // The matching table is revealed and expanded to show the matched column,
    // without any user clicks. The column label is highlighted (split), so
    // assert via its <mark> run.
    expect(screen.getByText("StormEvents")).toBeInTheDocument();
    expect(screen.getByText("Deaths", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByText("Direct")).toBeInTheDocument();
    expect(screen.queryByText("PopulationData")).not.toBeInTheDocument();
  });

  it("shows a no-match message and clears the filter with the clear button", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    const box = screen.getByRole("searchbox", { name: /filter schema/i });
    await userEvent.type(box, "zzz-nothing");
    expect(screen.getAllByText(/No matching entities/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Samples")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(screen.getByText("Samples")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("clears the filter with the Escape key", async () => {
    seedActiveWithSchema();
    render(<ConnectionsSidebar />);

    const box = screen.getByRole("searchbox", { name: /filter schema/i });
    await userEvent.type(box, "zzz-nothing");
    expect(screen.queryByText("Samples")).not.toBeInTheDocument();

    await userEvent.type(box, "{Escape}");
    expect(box).toHaveValue("");
    expect(screen.getByText("Samples")).toBeInTheDocument();
  });

  it("does not trigger schema loads while filtering unloaded databases", async () => {
    // Databases are known but their schema is NOT loaded.
    seedActive();
    render(<ConnectionsSidebar />);

    await userEvent.type(
      screen.getByRole("searchbox", { name: /filter schema/i }),
      "storm",
    );

    // "storm" matches neither the connection nor the (name-only) database, and
    // the schema is unloaded — so nothing is shown and no fetch is made.
    expect(screen.getAllByText(/No matching entities/i).length).toBeGreaterThan(
      0,
    );
    expect(mockApi.getSchema).not.toHaveBeenCalled();
  });
});
