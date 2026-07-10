import { describe, it, expect } from "vitest";
import { cn, formatDuration } from "./utils";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false && "b", "c", undefined, null)).toBe("a c");
  });

  it("supports conditional objects", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});

describe("formatDuration", () => {
  it("formats sub-second durations in ms", () => {
    expect(formatDuration(250)).toBe("250 ms");
  });

  it("formats durations over a second", () => {
    expect(formatDuration(1234)).toBe("1.23 s");
  });
});
