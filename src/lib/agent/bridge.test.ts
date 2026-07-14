import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri", () => ({
  completeAgentWorkspaceRequest: vi.fn(),
  getSchema: vi.fn(),
  listDatabases: vi.fn(),
}));

import * as api from "../tauri";
import { useAppStore, baseDataState } from "../../store/appStore";
import { executeWorkspaceTool } from "./bridge";

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(baseDataState());
});

describe("connect_to_database", () => {
  it("connects the focused tab and makes schema metadata available", async () => {
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
    mockApi.listDatabases.mockResolvedValue(["Samples"]);

    await expect(
      executeWorkspaceTool("connect_to_database", {
        clusterUrl: "help",
        database: "Samples",
      }),
    ).resolves.toMatchObject({
      status: "connected",
      clusterId: "https://help.kusto.windows.net",
      database: "Samples",
      schemaAvailable: true,
    });

    expect(useAppStore.getState()).toMatchObject({
      activeConnectionId: "https://help.kusto.windows.net",
      activeDatabase: "Samples",
      running: false,
    });
  });
});
