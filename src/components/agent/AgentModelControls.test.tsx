import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../store/agentStore";
import { AgentModelControls, formatReasoningEffort } from "./AgentModelControls";

afterEach(() => {
  cleanup();
  useAgentStore.setState(useAgentStore.getInitialState(), true);
});

describe("AgentModelControls", () => {
  it("shows model-specific thinking levels and applies a selection", async () => {
    const setReasoningEffort = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({
      models: [
        {
          id: "gpt-test",
          name: "GPT Test",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
      model: null,
      reasoningEffort: null,
      setReasoningEffort,
    });

    render(<AgentModelControls />);

    expect(screen.getByLabelText("Agent model")).toHaveValue("gpt-test");
    expect(screen.getByLabelText("Agent thinking level")).toHaveValue("medium");

    await userEvent.selectOptions(
      screen.getByLabelText("Agent thinking level"),
      "xhigh",
    );

    expect(setReasoningEffort).toHaveBeenCalledWith("xhigh");
  });

  it("hides thinking controls for models without configurable effort", () => {
    useAgentStore.setState({
      models: [
        {
          id: "fast-model",
          name: "Fast Model",
          supportedReasoningEfforts: [],
        },
      ],
    });

    render(<AgentModelControls />);

    expect(screen.queryByLabelText("Agent thinking level")).not.toBeInTheDocument();
  });

  it("formats the SDK's extra-high effort label", () => {
    expect(formatReasoningEffort("xhigh")).toBe("Extra High");
  });
});
