import { describe, expect, it } from "vitest";

import {
  deriveConnectionName,
  makeConnection,
  normalizeClusterUrl,
} from "./connection";

describe("normalizeClusterUrl", () => {
  it("keeps a full https URL but strips trailing slashes", () => {
    expect(normalizeClusterUrl("https://help.kusto.windows.net/")).toBe(
      "https://help.kusto.windows.net",
    );
  });

  it("adds https:// to a bare host", () => {
    expect(normalizeClusterUrl("help.kusto.windows.net")).toBe(
      "https://help.kusto.windows.net",
    );
  });

  it("expands a bare name to the public ADX domain", () => {
    expect(normalizeClusterUrl("help")).toBe("https://help.kusto.windows.net");
  });

  it("preserves an explicit http scheme (for local mock servers)", () => {
    expect(normalizeClusterUrl("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
  });

  it("throws on empty input", () => {
    expect(() => normalizeClusterUrl("   ")).toThrow();
  });
});

describe("deriveConnectionName", () => {
  it("uses the first host label", () => {
    expect(deriveConnectionName("https://help.kusto.windows.net")).toBe("help");
  });

  it("handles hosts without a scheme gracefully", () => {
    expect(deriveConnectionName("mycluster.eastus.kusto.windows.net")).toBe(
      "mycluster",
    );
  });
});

describe("makeConnection", () => {
  it("normalizes url and derives name and id", () => {
    const conn = makeConnection({ clusterUrl: "help" });
    expect(conn).toEqual({
      id: "https://help.kusto.windows.net",
      name: "help",
      clusterUrl: "https://help.kusto.windows.net",
      tenant: undefined,
    });
  });

  it("respects an explicit name and tenant", () => {
    const conn = makeConnection({
      clusterUrl: "https://c.kusto.windows.net",
      name: "  Prod  ",
      tenant: "  my-tenant  ",
    });
    expect(conn.name).toBe("Prod");
    expect(conn.tenant).toBe("my-tenant");
  });

  it("treats blank name/tenant as absent", () => {
    const conn = makeConnection({
      clusterUrl: "help",
      name: "   ",
      tenant: "   ",
    });
    expect(conn.name).toBe("help");
    expect(conn.tenant).toBeUndefined();
  });
});
