import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({
  formatShare: vi.fn(),
  exportCsv: vi.fn(),
  exportResult: vi.fn(),
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
import { copyShare, defaultFileName, exportResult } from "./actions";
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

  it("copies results as a datatable() literal", async () => {
    useAppStore.setState({ query: "q", result: RESULT });
    mockApi.formatShare.mockResolvedValue("datatable (n: long) [\n    1,\n]");

    await copyShare("datatable");

    expect(mockApi.formatShare).toHaveBeenCalledWith({
      mode: "datatable",
      query: "q",
      result: RESULT,
    });
    expect(mockWriteText).toHaveBeenCalledWith("datatable (n: long) [\n    1,\n]");
    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });

  it("does nothing for json mode without a result", async () => {
    useAppStore.setState({ query: "q", result: null });
    await copyShare("json");
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

describe("exportResult", () => {
  it("writes the result to the chosen path with the CSV format", async () => {
    useAppStore.setState({ result: RESULT });
    mockSave.mockResolvedValue("/tmp/out.csv");
    mockApi.exportResult.mockResolvedValue(undefined);

    await exportResult("csv");

    expect(mockApi.exportResult).toHaveBeenCalledWith({
      path: "/tmp/out.csv",
      format: "csv",
      result: RESULT,
    });
    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });

  it("passes the JSON format through to the backend", async () => {
    useAppStore.setState({ result: RESULT });
    mockSave.mockResolvedValue("/tmp/out.json");
    mockApi.exportResult.mockResolvedValue(undefined);

    await exportResult("json");

    expect(mockApi.exportResult).toHaveBeenCalledWith({
      path: "/tmp/out.json",
      format: "json",
      result: RESULT,
    });
  });

  it("does nothing when there is no result", async () => {
    useAppStore.setState({ result: null });
    await exportResult("tsv");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    useAppStore.setState({ result: RESULT });
    mockSave.mockResolvedValue(null);
    await exportResult("csv");
    expect(mockApi.exportResult).not.toHaveBeenCalled();
  });
});

describe("defaultFileName", () => {
  it("includes connection and database and a .csv extension by default", () => {
    const name = defaultFileName("help", "Samples");
    expect(name).toMatch(/^kusto-help-Samples-.*\.csv$/);
  });

  it("uses the requested format extension", () => {
    expect(defaultFileName("help", "Samples", "json")).toMatch(/\.json$/);
    expect(defaultFileName("help", "Samples", "tsv")).toMatch(/\.tsv$/);
  });

  it("omits missing parts", () => {
    expect(defaultFileName(undefined, null)).toMatch(/^kusto-.*\.csv$/);
  });
});
