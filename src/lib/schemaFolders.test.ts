import { describe, expect, it } from "vitest";

import { groupByFolder } from "./schemaFolders";

describe("groupByFolder", () => {
  it("builds nested folders from slash and backslash paths", () => {
    const grouped = groupByFolder([
      { name: "Root" },
      { name: "Daily", folder: "Reporting/Daily" },
      { name: "Cold", folder: "Archive\\Cold" },
      { name: "Monthly", folder: " Reporting / Monthly " },
    ]);

    expect(grouped.entities.map((entity) => entity.name)).toEqual(["Root"]);
    expect(grouped.folders.map((folder) => folder.name)).toEqual([
      "Archive",
      "Reporting",
    ]);
    expect(grouped.folders[0].folders[0]).toMatchObject({
      name: "Cold",
      path: "Archive/Cold",
      entities: [{ name: "Cold", folder: "Archive\\Cold" }],
    });
    expect(grouped.folders[1].folders.map((folder) => folder.name)).toEqual([
      "Daily",
      "Monthly",
    ]);
  });

  it("treats empty folder metadata as ungrouped", () => {
    const grouped = groupByFolder([
      { name: "One", folder: "" },
      { name: "Two", folder: "///" },
    ]);

    expect(grouped.folders).toEqual([]);
    expect(grouped.entities.map((entity) => entity.name)).toEqual(["One", "Two"]);
  });
});
