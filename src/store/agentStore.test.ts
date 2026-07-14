import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  abortAgentTurn: vi.fn(),
  clearAgentConversationData: vi.fn(),
  clearAgentSession: vi.fn(),
  configureAgentModel: vi.fn(),
  createNewAgentSession: vi.fn(),
  deleteAgentSession: vi.fn(),
  getAgentStatus: vi.fn(),
  listAgentSessions: vi.fn(),
  loadAgentConversation: vi.fn(),
  renameAgentSession: vi.fn(),
  resumeAgentSession: vi.fn(),
  saveAgentConversation: vi.fn().mockResolvedValue(undefined),
  sendAgentMessage: vi.fn().mockResolvedValue(undefined),
  startAgentSession: vi.fn(),
}));

import * as api from "../lib/tauri";
import type { AgentSessionEvent } from "../types/agent";
import {
  messagesFromAgentEvents,
  reduceAgentEvent,
  useAgentStore,
} from "./agentStore";

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.saveAgentConversation.mockResolvedValue(undefined);
  mockApi.sendAgentMessage.mockResolvedValue(undefined);
  mockApi.clearAgentSession.mockResolvedValue(undefined);
  mockApi.configureAgentModel.mockResolvedValue(undefined);
  mockApi.clearAgentConversationData.mockResolvedValue(undefined);
  mockApi.deleteAgentSession.mockResolvedValue(false);
  mockApi.renameAgentSession.mockResolvedValue(undefined);
  mockApi.listAgentSessions.mockResolvedValue([]);
  useAgentStore.setState({
    initialized: true,
    loading: false,
    sending: false,
    lifecycleBusy: false,
    sessionsLoading: false,
    isAuthenticated: true,
    model: null,
    reasoningEffort: null,
    sessionId: null,
    sessions: [],
    messages: [],
    error: null,
  });
});

describe("agent event reduction", () => {
  it("merges tool start and completion events by tool call id", () => {
    const started = event("tool.execution_start", "2026-01-01T00:00:00Z", {
      toolCallId: "call-1",
      toolName: "get_table_schema",
      arguments: { database: "Samples", table: "StormEvents" },
    });
    const completed = event(
      "tool.execution_complete",
      "2026-01-01T00:00:01.250Z",
      {
        toolCallId: "call-1",
        success: true,
        result: { content: "27 columns" },
      },
    );

    const messages = reduceAgentEvent(reduceAgentEvent([], started), completed);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "tool",
      content: "Read table schema",
      toolName: "get_table_schema",
      toolCallId: "call-1",
      toolArguments: { database: "Samples", table: "StormEvents" },
      toolResult: { content: "27 columns" },
      durationMs: 1250,
      status: "complete",
    });
  });

  it("rebuilds user and streamed assistant messages from session history", () => {
    const messages = messagesFromAgentEvents([
      event("user.message", "2026-01-01T00:00:00Z", {
        content:
          "# Focused query tab\nquery text\n\n## User request\nWrite a count query",
      }),
      event("assistant.message_delta", "2026-01-01T00:00:01Z", {
        messageId: "assistant-1",
        deltaContent: "Storm",
      }),
      event("assistant.message_delta", "2026-01-01T00:00:02Z", {
        messageId: "assistant-1",
        deltaContent: "Events | count",
      }),
      event("assistant.message", "2026-01-01T00:00:03Z", {
        messageId: "assistant-1",
        content: "StormEvents | count",
      }),
    ]);

    expect(messages.map(({ kind, content, status }) => ({ kind, content, status })))
      .toEqual([
        {
          kind: "user",
          content: "Write a count query",
          status: undefined,
        },
        {
          kind: "assistant",
          content: "StormEvents | count",
          status: "complete",
        },
      ]);
  });

  it("ignores late events after the active session is cleared", () => {
    useAgentStore.setState({ sessionId: null, messages: [] });

    useAgentStore.getState().handleEvent(
      event("user.message", "2026-01-01T00:00:00Z", {
        content: "This arrived too late",
      }),
    );

    expect(useAgentStore.getState().messages).toEqual([]);
  });
});

describe("agent session actions", () => {
  it("sends immediately with a separate clean display prompt", async () => {
    mockApi.startAgentSession.mockResolvedValue("session-1");

    await useAgentStore
      .getState()
      .send("Write a count query", "# Focused query tab\nStormEvents");

    expect(mockApi.sendAgentMessage).toHaveBeenCalledWith(
      "# Focused query tab\nStormEvents\n\n## User request\nWrite a count query",
      "Write a count query",
    );
  });

  it("does not block a turn when transcript caching fails", async () => {
    mockApi.startAgentSession.mockResolvedValue("session-1");
    mockApi.saveAgentConversation.mockRejectedValueOnce(
      new Error("transcript is too large"),
    );

    await useAgentStore
      .getState()
      .send("Keep helping", "# Focused query tab\nStormEvents");

    expect(mockApi.sendAgentMessage).toHaveBeenCalledOnce();
  });

  it("invalidates the active session before clearing asynchronously", async () => {
    let finishClear: (() => void) | undefined;
    mockApi.clearAgentSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
    );
    useAgentStore.setState({
      sessionId: "session-2",
      messages: [],
      lifecycleBusy: false,
    });

    const clearing = useAgentStore.getState().clearConversation();
    expect(useAgentStore.getState()).toMatchObject({
      sessionId: null,
      lifecycleBusy: true,
    });
    useAgentStore.getState().handleEvent(
      event("user.message", "2026-01-01T00:00:00Z", {
        content: "Queued before disconnect",
      }),
    );
    expect(useAgentStore.getState().messages).toEqual([]);

    finishClear?.();
    await clearing;
    expect(useAgentStore.getState().lifecycleBusy).toBe(false);
  });

  it("resumes a selected SDK session and rebuilds its transcript", async () => {
    mockApi.resumeAgentSession.mockResolvedValue({
      sessionId: "session-2",
      events: [
        event("user.message", "2026-01-01T00:00:00Z", {
          content: "Help with joins",
        }),
      ],
    });
    mockApi.listAgentSessions.mockResolvedValue([]);

    await useAgentStore.getState().resumeSession("session-2");

    expect(mockApi.resumeAgentSession).toHaveBeenCalledWith(
      "session-2",
      null,
      null,
    );
    expect(useAgentStore.getState()).toMatchObject({
      sessionId: "session-2",
      messages: [
        expect.objectContaining({ kind: "user", content: "Help with joins" }),
      ],
    });
  });

  it("renames a persisted SDK session and refreshes the list", async () => {
    mockApi.listAgentSessions.mockResolvedValue([
      {
        sessionId: "session-2",
        startTime: "2026-01-01T00:00:00Z",
        modifiedTime: "2026-01-01T00:00:01Z",
        name: "Schema helper",
        isRemote: false,
        isActive: false,
      },
    ]);

    await useAgentStore
      .getState()
      .renameSession("session-2", "  Schema helper  ");

    expect(mockApi.renameAgentSession).toHaveBeenCalledWith(
      "session-2",
      "Schema helper",
    );
    expect(useAgentStore.getState().sessions[0].name).toBe("Schema helper");
  });

  it("deletes the active SDK session and clears its transcript", async () => {
    mockApi.deleteAgentSession.mockResolvedValue(true);
    useAgentStore.setState({
      sessionId: "session-2",
      messages: [
        {
          id: "message-1",
          kind: "user",
          content: "Help",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await useAgentStore.getState().deleteSession("session-2");

    expect(mockApi.deleteAgentSession).toHaveBeenCalledWith("session-2");
    expect(mockApi.clearAgentConversationData).toHaveBeenCalledOnce();
    expect(useAgentStore.getState()).toMatchObject({
      sessionId: null,
      messages: [],
      lifecycleBusy: false,
    });
  });

  it("does not restore a session when cleanup fails after deletion", async () => {
    mockApi.deleteAgentSession.mockResolvedValue(true);
    mockApi.clearAgentConversationData.mockRejectedValue(
      new Error("cannot remove cache"),
    );
    useAgentStore.setState({
      sessionId: "session-2",
      messages: [
        {
          id: "message-1",
          kind: "user",
          content: "Help",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await useAgentStore.getState().deleteSession("session-2");

    expect(useAgentStore.getState()).toMatchObject({
      sessionId: null,
      messages: [],
      lifecycleBusy: false,
      error: expect.stringContaining("local transcript could not be cleared"),
    });
  });

  it("applies and persists model-specific reasoning effort", async () => {
    useAgentStore.setState({
      models: [
        {
          id: "gpt-test",
          name: "GPT Test",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"],
        },
      ],
      model: "gpt-test",
      reasoningEffort: null,
      sessionId: "session-2",
    });

    await useAgentStore.getState().setReasoningEffort("high");

    expect(mockApi.configureAgentModel).toHaveBeenCalledWith(
      "gpt-test",
      "high",
    );
    expect(useAgentStore.getState().reasoningEffort).toBe("high");
    expect(mockApi.saveAgentConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        reasoningEffort: "high",
      }),
    );
  });
});

function event(
  eventType: string,
  timestamp: string,
  data: Record<string, unknown>,
): AgentSessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: "session-2",
    eventType,
    timestamp,
    data,
  };
}
