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

  it("round-trips tab revisions", () => {
    savePersisted({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      query: "print 1",
      tabs: [
        {
          id: "tab-1",
          title: "Query 1",
          query: "print 1",
          revision: 7,
          connectionId: null,
          database: null,
        },
      ],
      activeTabId: "tab-1",
    });
    expect(loadPersisted().tabs?.[0].revision).toBe(7);
  });

  it("invalidates legacy tabs that have no revision", () => {
    localStorage.setItem(
      "kusto-explorer.state.v1",
      JSON.stringify({
        connections: [],
        query: "print 1",
        tabs: [
          {
            id: "tab-1",
            title: "Query 1",
            query: "print 1",
            connectionId: null,
            database: null,
          },
        ],
      }),
    );
    expect(loadPersisted().tabs?.[0].revision).toBeGreaterThan(0);
  });
});
