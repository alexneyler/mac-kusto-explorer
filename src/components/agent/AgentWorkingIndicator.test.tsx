import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentWorkingIndicator } from "./AgentWorkingIndicator";

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentWorkingIndicator", () => {
  it("shows and updates the elapsed working time", () => {
    vi.useFakeTimers();
    render(<AgentWorkingIndicator />);

    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Agent working for 0 seconds",
    );

    act(() => vi.advanceTimersByTime(2_100));

    expect(screen.getByText("2s")).toBeVisible();
  });
});
