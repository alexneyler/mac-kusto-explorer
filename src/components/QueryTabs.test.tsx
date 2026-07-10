import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  runQuery: vi.fn(),
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
}));

import { baseDataState, useAppStore } from "../store/appStore";
import { QueryTabs } from "./QueryTabs";

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(baseDataState());
  vi.clearAllMocks();
});

describe("QueryTabs", () => {
  it("renders the initial tab", () => {
    render(<QueryTabs />);
    expect(screen.getByRole("tab", { name: /Query 1/ })).toBeInTheDocument();
  });

  it("adds a new tab with the + button", async () => {
    render(<QueryTabs />);
    await userEvent.click(screen.getByLabelText("New query tab"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(useAppStore.getState().tabs).toHaveLength(2);
  });

  it("switches the active tab on click", async () => {
    render(<QueryTabs />);
    await userEvent.click(screen.getByLabelText("New query tab"));
    const [firstTab] = screen.getAllByRole("tab");
    await userEvent.click(firstTab);
    expect(firstTab).toHaveAttribute("aria-selected", "true");
    expect(useAppStore.getState().activeTabId).toBe(useAppStore.getState().tabs[0].id);
  });

  it("closes a tab with its close button", async () => {
    render(<QueryTabs />);
    await userEvent.click(screen.getByLabelText("New query tab"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    await userEvent.click(screen.getByLabelText("Close Query 2"));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("renames a tab on double-click", async () => {
    const user = userEvent.setup();
    render(<QueryTabs />);
    const tab = screen.getByRole("tab", { name: /Query 1/ });
    await user.dblClick(tab);
    const input = within(tab).getByLabelText("Tab name");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(screen.getByRole("tab", { name: /Renamed/ })).toBeInTheDocument();
    expect(useAppStore.getState().tabs[0].title).toBe("Renamed");
  });
});
