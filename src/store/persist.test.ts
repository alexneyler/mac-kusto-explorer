import { beforeEach, describe, expect, it } from "vitest";

import { loadPersisted, savePersisted } from "./persist";

beforeEach(() => {
  localStorage.clear();
});

describe("persist", () => {
  it("returns an empty state when nothing is stored", () => {
    expect(loadPersisted()).toEqual({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      query: null,
    });
  });

  it("round-trips the query text", () => {
    savePersisted({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      query: "MyTable | take 5",
    });
    expect(loadPersisted().query).toBe("MyTable | take 5");
  });

  it("defaults query to null when absent or wrong type", () => {
    localStorage.setItem(
      "kusto-explorer.state.v1",
      JSON.stringify({ connections: [], query: 42 }),
    );
    expect(loadPersisted().query).toBeNull();
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem("kusto-explorer.state.v1", "{not json");
    expect(loadPersisted()).toEqual({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      query: null,
    });
  });
});
