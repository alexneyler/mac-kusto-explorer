import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToolCallCard } from "./ToolCallCard";

describe("ToolCallCard", () => {
  it("shows a compact summary and expands exact arguments and results", async () => {
    render(
      <ToolCallCard
        message={{
          id: "tool-call-1",
          kind: "tool",
          content: "Read table schema",
          createdAt: "2026-01-01T00:00:00Z",
          toolName: "get_table_schema",
          toolCallId: "call-1",
          toolArguments: { database: "Samples", table: "StormEvents" },
          toolResult: { content: "27 columns" },
          durationMs: 1250,
          status: "complete",
        }}
      />,
    );

    expect(screen.getByText("Read table schema")).toBeVisible();
    expect(screen.getByText(/StormEvents/)).not.toBeVisible();

    await userEvent.click(screen.getByText("Read table schema"));

    expect(screen.getByText(/StormEvents/)).toBeVisible();
    expect(screen.getByText(/27 columns/)).toBeVisible();
    expect(screen.getByText("1.3s")).toBeVisible();
  });
});
