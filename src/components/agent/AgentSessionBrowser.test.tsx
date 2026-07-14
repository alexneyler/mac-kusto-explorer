import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../store/agentStore";
import { AgentSessionBrowser } from "./AgentSessionBrowser";

beforeEach(() => {
  const resumeSession = vi.fn(async (sessionId: string) => {
    useAgentStore.setState({ sessionId });
  });
  const renameSession = vi.fn(async () => undefined);
  const deleteSession = vi.fn(async () => undefined);
  useAgentStore.setState({
    sessionId: "session-active",
    lifecycleBusy: false,
    sessionsLoading: false,
    sending: false,
    error: null,
    sessions: [
      {
        sessionId: "session-active",
        startTime: "2026-01-01T00:00:00Z",
        modifiedTime: new Date().toISOString(),
        summary: "Build a StormEvents query",
        isRemote: false,
        isActive: true,
      },
      {
        sessionId: "session-joins",
        startTime: "2026-01-01T00:00:00Z",
        modifiedTime: new Date().toISOString(),
        summary: "Explain Kusto joins",
        isRemote: false,
        isActive: false,
      },
    ],
    resumeSession,
    renameSession,
    deleteSession,
  });
});

describe("AgentSessionBrowser", () => {
  it("filters sessions and returns to the active conversation", async () => {
    const onClose = vi.fn();
    render(<AgentSessionBrowser onClose={onClose} />);

    await userEvent.type(screen.getByPlaceholderText("Search sessions"), "Storm");
    expect(screen.getByText("Build a StormEvents query")).toBeVisible();
    expect(screen.queryByText("Explain Kusto joins")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Build a StormEvents query"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("resumes a selected session before returning to chat", async () => {
    const onClose = vi.fn();
    const resumeSession = vi.fn(async (sessionId: string) => {
      useAgentStore.setState({ sessionId });
    });
    useAgentStore.setState({ resumeSession });
    render(<AgentSessionBrowser onClose={onClose} />);

    await userEvent.click(screen.getByText("Explain Kusto joins"));

    expect(resumeSession).toHaveBeenCalledWith("session-joins");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("opens a session from its right-click menu", async () => {
    const onClose = vi.fn();
    const resumeSession = vi.fn(async (sessionId: string) => {
      useAgentStore.setState({ sessionId });
    });
    useAgentStore.setState({ resumeSession });
    render(<AgentSessionBrowser onClose={onClose} />);

    fireEvent.contextMenu(screen.getByText("Explain Kusto joins"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open" }));

    expect(resumeSession).toHaveBeenCalledWith("session-joins");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("renames a session from its right-click menu", async () => {
    const renameSession = vi.fn(async () => undefined);
    useAgentStore.setState({ renameSession });
    render(<AgentSessionBrowser onClose={() => undefined} />);

    fireEvent.contextMenu(screen.getByText("Explain Kusto joins"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Session name");
    await userEvent.clear(input);
    await userEvent.type(input, "Join reference");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(renameSession).toHaveBeenCalledWith(
      "session-joins",
      "Join reference",
    );
  });

  it("deletes a session from its right-click menu after confirmation", async () => {
    const deleteSession = vi.fn(async () => undefined);
    useAgentStore.setState({ deleteSession });
    render(<AgentSessionBrowser onClose={() => undefined} />);

    fireEvent.contextMenu(screen.getByText("Explain Kusto joins"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete", hidden: false }),
    );

    expect(deleteSession).toHaveBeenCalledWith("session-joins");
  });
});
