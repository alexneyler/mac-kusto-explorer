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

import * as api from "../lib/tauri";
import { baseDataState, useAppStore } from "../store/appStore";
import { AddConnectionDialog } from "./AddConnectionDialog";

const mockApi = vi.mocked(api);

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(baseDataState());
  vi.clearAllMocks();
  mockApi.listDatabases.mockResolvedValue([]);
});

describe("AddConnectionDialog", () => {
  it("adds a connection from typed input and closes", async () => {
    const onClose = vi.fn();
    render(<AddConnectionDialog open onClose={onClose} />);

    await userEvent.type(
      screen.getByLabelText("Cluster URL"),
      "help.kusto.windows.net",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    const conns = useAppStore.getState().connections;
    expect(conns).toHaveLength(1);
    expect(conns[0].clusterUrl).toBe("https://help.kusto.windows.net");
    expect(onClose).toHaveBeenCalled();
  });

  it("passes an optional tenant through", async () => {
    render(<AddConnectionDialog open onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Cluster URL"), "mycluster");
    await userEvent.type(screen.getByLabelText("Tenant"), "contoso.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useAppStore.getState().connections[0].tenant).toBe("contoso.com");
  });

  it("shows an error for empty input and does not close", async () => {
    const onClose = vi.fn();
    render(<AddConnectionDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(useAppStore.getState().connections).toHaveLength(0);
  });
});
