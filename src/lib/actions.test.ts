import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
  runQuery: vi.fn(),
  listDatabases: vi.fn(),
  getSchema: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { baseDataState, useAppStore } from "../store/appStore";
import { useToastStore } from "../store/toast";
import type { QueryResponse } from "../types/kusto";
import { copyShare, defaultFileName, exportResultCsv } from "./actions";
import * as api from "./tauri";

const mockApi = vi.mocked(api);
const mockWriteText = vi.mocked(writeText);
const mockSave = vi.mocked(save);

const RESULT: QueryResponse = {
  columns: [{ name: "n", type: "long" }],
  rows: [[1]],
  row_count: 1,
  elapsed_ms: 5,
};

beforeEach(() => {
  useAppStore.setState(baseDataState());
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe("copyShare", () => {
  it("formats the query and writes to the clipboard", async () => {
    useAppStore.setState({ query: "StormEvents | count", result: null });
    mockApi.formatShare.mockResolvedValue("StormEvents | count");

    await copyShare("query");

    expect(mockApi.formatShare).toHaveBeenCalledWith({
      mode: "query",
      query: "StormEvents | count",
      result: { columns: [], rows: [], row_count: 0 },
    });
    expect(mockWriteText).toHaveBeenCalledWith("StormEvents | count");
    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });

  it("does nothing for results mode without a result", async () => {
    useAppStore.setState({ query: "q", result: null });
    await copyShare("results");
    expect(mockApi.formatShare).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("surfaces errors as an error toast", async () => {
    useAppStore.setState({ query: "q", result: RESULT });
    mockApi.formatShare.mockRejectedValue({ kind: "io", message: "boom" });
    await copyShare("both");
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      kind: "error",
      message: "boom",
    });
  });
});

describe("exportResultCsv", () => {
  it("writes the result to the chosen path", async () => {
    useAppStore.setState({ result: RESULT });
    mockSave.mockResolvedValue("/tmp/out.csv");
    mockApi.exportCsv.mockResolvedValue(undefined);

    await exportResultCsv();

    expect(mockApi.exportCsv).toHaveBeenCalledWith({
      path: "/tmp/out.csv",
      result: RESULT,
    });
    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });

  it("does nothing when there is no result", async () => {
    useAppStore.setState({ result: null });
    await exportResultCsv();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    useAppStore.setState({ result: RESULT });
    mockSave.mockResolvedValue(null);
    await exportResultCsv();
    expect(mockApi.exportCsv).not.toHaveBeenCalled();
  });
});

describe("defaultFileName", () => {
  it("includes connection and database and a .csv extension", () => {
    const name = defaultFileName("help", "Samples");
    expect(name).toMatch(/^kusto-help-Samples-.*\.csv$/);
  });

  it("omits missing parts", () => {
    expect(defaultFileName(undefined, null)).toMatch(/^kusto-.*\.csv$/);
  });
});
