import { describe, expect, it } from "vitest";

import type {
  Connection,
  DatabaseSchema,
  TableSchema,
} from "../types/kusto";
import {
  connectionHasDescendantMatch,
  connectionVisible,
  databaseHasDescendantMatch,
  databaseVisible,
  filterColumns,
  functionMatches,
  isFiltering,
  matchesText,
  normalizeQuery,
  schemaHasMatch,
  tableMatches,
  tableSelfMatches,
  visibleColumns,
  visibleFunctions,
  visibleTables,
} from "./schemaFilter";

const STORM: TableSchema = {
  name: "StormEvents",
  folder: "Weather",
  columns: [
    { name: "State", type: "string" },
    { name: "DeathsDirect", type: "long" },
    { name: "StartTime", type: "datetime" },
  ],
};

const POP: TableSchema = {
  name: "PopulationData",
  columns: [
    { name: "State", type: "string" },
    { name: "Population", type: "long" },
  ],
};

const SCHEMA: DatabaseSchema = {
  name: "Samples",
  tables: [STORM, POP],
  functions: [
    { name: "MyStormFn", folder: "Weather" },
    { name: "OtherFn" },
  ],
};

function conn(id: string, name: string): Connection {
  return { id, name, clusterUrl: `https://${id}.kusto.windows.net` };
}

describe("normalizeQuery / isFiltering", () => {
  it("trims and lower-cases", () => {
    expect(normalizeQuery("  Storm  ")).toBe("storm");
  });

  it("treats whitespace-only as not filtering", () => {
    expect(isFiltering("")).toBe(false);
    expect(isFiltering("   ")).toBe(false);
    expect(isFiltering("x")).toBe(true);
  });
});

describe("matchesText", () => {
  it("is case-insensitive substring", () => {
    expect(matchesText("StormEvents", "storm")).toBe(true);
    expect(matchesText("StormEvents", "EVENTS")).toBe(true);
    expect(matchesText("StormEvents", "rain")).toBe(false);
  });

  it("empty query matches anything, missing text matches nothing", () => {
    expect(matchesText("anything", "")).toBe(true);
    expect(matchesText(undefined, "storm")).toBe(false);
    expect(matchesText(undefined, "")).toBe(true);
  });
});

describe("column and table matching", () => {
  it("filterColumns keeps name or type matches", () => {
    expect(filterColumns(STORM.columns, "state").map((c) => c.name)).toEqual([
      "State",
    ]);
    // Type match: two columns are `long`/`datetime`; "time" matches StartTime.
    expect(filterColumns(STORM.columns, "time").map((c) => c.name)).toEqual([
      "StartTime",
    ]);
    // Inactive filter returns all columns.
    expect(filterColumns(STORM.columns, "")).toHaveLength(3);
  });

  it("tableSelfMatches uses name and folder", () => {
    expect(tableSelfMatches(STORM, "storm")).toBe(true);
    expect(tableSelfMatches(STORM, "weather")).toBe(true);
    expect(tableSelfMatches(STORM, "state")).toBe(false);
  });

  it("tableMatches is true for self or column match", () => {
    expect(tableMatches(STORM, "storm")).toBe(true); // name
    expect(tableMatches(POP, "state")).toBe(true); // column
    expect(tableMatches(POP, "storm")).toBe(false);
  });

  it("visibleColumns shows all when the table name matches, else only matches", () => {
    expect(visibleColumns(STORM, "storm")).toHaveLength(3); // name match → all
    expect(visibleColumns(POP, "state").map((c) => c.name)).toEqual(["State"]);
  });
});

describe("schema-level matching", () => {
  it("functionMatches uses name and folder", () => {
    expect(functionMatches({ name: "MyStormFn" }, "storm")).toBe(true);
    expect(functionMatches({ name: "OtherFn", folder: "Weather" }, "weather")).toBe(
      true,
    );
    expect(functionMatches({ name: "OtherFn" }, "storm")).toBe(false);
  });

  it("visibleTables / visibleFunctions filter by query", () => {
    expect(visibleTables(SCHEMA, "population").map((t) => t.name)).toEqual([
      "PopulationData",
    ]);
    // "state" is a column in both tables.
    expect(visibleTables(SCHEMA, "state")).toHaveLength(2);
    expect(visibleFunctions(SCHEMA, "storm").map((f) => f.name)).toEqual([
      "MyStormFn",
    ]);
    // Inactive filter returns everything.
    expect(visibleTables(SCHEMA, "")).toHaveLength(2);
    expect(visibleFunctions(SCHEMA, "")).toHaveLength(2);
  });

  it("schemaHasMatch reflects any table or function match", () => {
    expect(schemaHasMatch(SCHEMA, "storm")).toBe(true);
    expect(schemaHasMatch(SCHEMA, "otherfn")).toBe(true);
    expect(schemaHasMatch(SCHEMA, "nonexistent")).toBe(false);
    expect(schemaHasMatch(SCHEMA, "")).toBe(true);
  });
});

describe("database visibility", () => {
  it("is visible on name match even when schema is unloaded", () => {
    expect(databaseVisible("Samples", undefined, "samp")).toBe(true);
  });

  it("is hidden when name doesn't match and schema is unloaded", () => {
    expect(databaseVisible("Samples", undefined, "storm")).toBe(false);
  });

  it("is visible when a loaded schema has a match", () => {
    expect(databaseVisible("Samples", SCHEMA, "storm")).toBe(true);
    expect(databaseVisible("Samples", SCHEMA, "nope")).toBe(false);
  });

  it("descendant match requires a loaded schema", () => {
    expect(databaseHasDescendantMatch(undefined, "storm")).toBe(false);
    expect(databaseHasDescendantMatch(SCHEMA, "storm")).toBe(true);
    // Name-only match at the database level is not a descendant match.
    expect(databaseHasDescendantMatch(SCHEMA, "samples")).toBe(false);
  });

  it("everything is visible when not filtering", () => {
    expect(databaseVisible("Samples", undefined, "")).toBe(true);
    expect(databaseHasDescendantMatch(SCHEMA, "")).toBe(false);
  });
});

describe("connection visibility", () => {
  const lookup = (db: string) => (db === "Samples" ? SCHEMA : undefined);

  it("is visible on connection-name match without loaded databases", () => {
    expect(connectionVisible(conn("c1", "Help"), undefined, () => undefined, "help")).toBe(
      true,
    );
  });

  it("is hidden when name doesn't match and databases are unloaded", () => {
    expect(
      connectionVisible(conn("c1", "Help"), undefined, () => undefined, "storm"),
    ).toBe(false);
  });

  it("is visible when a child database matches (by name or schema)", () => {
    const c = conn("c1", "Help");
    expect(connectionVisible(c, ["Samples"], lookup, "storm")).toBe(true);
    expect(connectionVisible(c, ["Samples"], lookup, "samp")).toBe(true);
    expect(connectionVisible(c, ["Samples"], lookup, "nope")).toBe(false);
  });

  it("descendant match requires loaded databases with a match", () => {
    expect(connectionHasDescendantMatch(undefined, lookup, "storm")).toBe(false);
    expect(connectionHasDescendantMatch(["Samples"], lookup, "storm")).toBe(true);
    // Connection-name-only match is not a descendant match.
    expect(connectionHasDescendantMatch(["Samples"], lookup, "nope")).toBe(false);
  });

  it("everything is visible when not filtering", () => {
    expect(
      connectionVisible(conn("c1", "Help"), undefined, () => undefined, ""),
    ).toBe(true);
  });
});
