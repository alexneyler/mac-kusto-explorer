import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  runQuery: vi.fn(),
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
  exportResult: vi.fn(),
}));

import { makeConnection } from "../lib/connection";
import * as api from "../lib/tauri";
import { baseDataState, schemaKey, useAppStore } from "../store/appStore";
import { useThemeStore } from "../store/themeStore";
import { Toolbar } from "./Toolbar";

const mockApi = vi.mocked(api);

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(baseDataState());
  useThemeStore.setState({ theme: "dark" });
  document.documentElement.dataset.theme = "dark";
  vi.clearAllMocks();
});

function seedConnection() {
  const conn = makeConnection({ clusterUrl: "help" });
  useAppStore.setState({
    connections: [conn],
    activeConnectionId: conn.id,
    databasesByConn: { [conn.id]: ["Samples", "TestDB"] },
  });
  return conn;
}

describe("Toolbar", () => {
  it("renders connections and databases in the selectors", () => {
    seedConnection();
    render(<Toolbar />);
    const connection = screen.getByLabelText("Connection") as HTMLSelectElement;
    expect(connection).toHaveValue("https://help.kusto.windows.net");
    expect(screen.getByRole("option", { name: "Samples" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "TestDB" })).toBeInTheDocument();
  });

  it("selecting a database updates the active database", async () => {
    mockApi.getSchema.mockResolvedValue({
      database: {
        name: "Samples",
        tables: [],
        materializedViews: [],
        externalTables: [],
        functions: [],
      },
      raw: {},
    });
    seedConnection();
    render(<Toolbar />);
    await userEvent.selectOptions(screen.getByLabelText("Database"), "Samples");
    expect(useAppStore.getState().activeDatabase).toBe("Samples");
    // Let the fire-and-forget schema load settle inside act().
    const conn = useAppStore.getState().connections[0];
    await waitFor(() =>
      expect(
        useAppStore.getState().schemaByKey[schemaKey(conn.id, "Samples")],
      ).toBeDefined(),
    );
  });

  it("Run is disabled until a database is selected, then runs the query", async () => {
    mockApi.runQuery.mockResolvedValue({
      columns: [],
      rows: [],
      row_count: 0,
      elapsed_ms: 1,
    });
    const conn = seedConnection();
    render(<Toolbar />);

    expect(screen.getByRole("button", { name: /Run/ })).toBeDisabled();

    act(() => {
      useAppStore.setState({ activeDatabase: "Samples", query: "T | count" });
    });

    const runBtn = screen.getByRole("button", { name: /Run/ });
    expect(runBtn).toBeEnabled();
    await userEvent.click(runBtn);
    expect(mockApi.runQuery).toHaveBeenCalledWith({
      cluster: conn.clusterUrl,
      database: "Samples",
      query: "T | count",
      tenant: undefined,
    });
    await waitFor(() => expect(useAppStore.getState().running).toBe(false));
  });

  it("opens the add-connection dialog from the + button", async () => {
    render(<Toolbar />);
    await userEvent.click(screen.getByLabelText("Add connection"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Cluster URL")).toBeInTheDocument();
  });

  it("switches to light mode and persists the selection", async () => {
    render(<Toolbar />);

    const themeToggle = screen.getByLabelText("Switch to light mode");
    const agentToggle = screen.getByLabelText("Open query agent");
    expect(
      themeToggle.compareDocumentPosition(agentToggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(themeToggle);

    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("kusto-explorer.theme")).toBe("light");
    expect(screen.getByLabelText("Switch to dark mode")).toBeInTheDocument();
  });
});
