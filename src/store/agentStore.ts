import { create } from "zustand";

import {
  abortAgentTurn,
  clearAgentConversationData,
  clearAgentSession,
  configureAgentModel,
  createNewAgentSession,
  deleteAgentSession,
  getAgentStatus,
  listAgentSessions,
  loadAgentConversation,
  renameAgentSession,
  resumeAgentSession,
  saveAgentConversation,
  sendAgentMessage,
  startAgentSession,
} from "../lib/tauri";
import type {
  AgentConversationData,
  AgentMessage,
  AgentModel,
  AgentRuntimeInfo,
  AgentSessionEvent,
  AgentSessionSummary,
} from "../types/agent";
import { AGENT_DATA_VERSION } from "../types/agent";
import { errorMessage } from "../types/kusto";

const MAX_PERSISTED_TOOL_DETAIL_BYTES = 20 * 1024;

interface AgentState {
  panelOpen: boolean;
  initialized: boolean;
  loading: boolean;
  sending: boolean;
  lifecycleBusy: boolean;
  sessionsLoading: boolean;
  isAuthenticated: boolean;
  authMessage: string | null;
  models: AgentModel[];
  model: string | null;
  reasoningEffort: string | null;
  sessionId: string | null;
  sessions: AgentSessionSummary[];
  messages: AgentMessage[];
  error: string | null;
  initialize(): Promise<void>;
  setPanelOpen(open: boolean): void;
  setModel(model: string): Promise<void>;
  setReasoningEffort(reasoningEffort: string | null): Promise<void>;
  send(prompt: string, contextEnvelope: string): Promise<void>;
  abort(): Promise<void>;
  clearConversation(): Promise<void>;
  loadSessions(): Promise<void>;
  startNewSession(): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  handleEvent(event: AgentSessionEvent): void;
}

function conversation(state: AgentState): AgentConversationData {
  return {
    version: AGENT_DATA_VERSION,
    sessionId: state.sessionId,
    model: state.model,
    reasoningEffort: state.reasoningEffort,
    messages: state.messages.map(persistableMessage),
  };
}

let persistQueue: Promise<void> = Promise.resolve();

function persist(state: AgentState): Promise<void> {
  const snapshot = conversation(state);
  const next = persistQueue
    .catch(() => undefined)
    .then(() => saveAgentConversation(snapshot));
  persistQueue = next;
  return next;
}

function message(
  kind: AgentMessage["kind"],
  content: string,
  extra: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id: crypto.randomUUID(),
    kind,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

export function messagesFromAgentEvents(
  events: AgentSessionEvent[],
): AgentMessage[] {
  return events.reduce(reduceAgentEvent, []);
}

export function reduceAgentEvent(
  current: AgentMessage[],
  event: AgentSessionEvent,
): AgentMessage[] {
  const content =
    stringField(event.data, "content") ??
    stringField(event.data, "deltaContent") ??
    stringField(event.data, "message") ??
    "";

  if (event.eventType === "user.message") {
    const displayContent = extractDisplayPrompt(content);
    if (!displayContent) return current;
    const pendingIndex = current.findIndex(
      (item) =>
        item.kind === "user" &&
        item.eventType === "local.user" &&
        item.content === displayContent,
    );
    if (pendingIndex >= 0) {
      const messages = [...current];
      messages[pendingIndex] = {
        ...messages[pendingIndex],
        id: event.id,
        eventType: event.eventType,
        createdAt: event.timestamp,
      };
      return messages;
    }
    if (current.some((item) => item.id === event.id)) return current;
    return [
      ...current,
      eventMessage(event, "user", displayContent, {
        eventType: event.eventType,
      }),
    ];
  }

  if (event.eventType === "assistant.message_delta") {
    const id = stringField(event.data, "messageId") ?? event.id;
    const existingIndex = current.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      const messages = [...current];
      const existing = messages[existingIndex];
      messages[existingIndex] = {
        ...existing,
        content: existing.content + content,
        status: "running",
      };
      return messages;
    }
    return [
      ...current,
      eventMessage(event, "assistant", content, {
        id,
        eventType: event.eventType,
        status: "running",
      }),
    ];
  }

  if (event.eventType === "assistant.message") {
    const id = stringField(event.data, "messageId") ?? event.id;
    const existingIndex = current.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      const messages = [...current];
      messages[existingIndex] = {
        ...messages[existingIndex],
        content: content || messages[existingIndex].content,
        eventType: event.eventType,
        status: "complete",
      };
      return messages;
    }
    if (!content) return current;
    return [
      ...current,
      eventMessage(event, "assistant", content, {
        id,
        eventType: event.eventType,
        status: "complete",
      }),
    ];
  }

  if (event.eventType === "tool.execution_start") {
    const toolCallId =
      stringField(event.data, "toolCallId") ??
      stringField(event.data, "callId") ??
      event.id;
    if (current.some((item) => item.toolCallId === toolCallId)) return current;
    const toolName = toolNameFromEvent(event);
    return [
      ...current,
      eventMessage(event, "tool", toolActivityLabel(toolName, "running"), {
        id: `tool-${toolCallId}`,
        eventType: event.eventType,
        toolName,
        toolCallId,
        toolArguments: event.data.arguments,
        status: "running",
      }),
    ];
  }

  if (event.eventType === "tool.execution_complete") {
    const toolCallId =
      stringField(event.data, "toolCallId") ??
      stringField(event.data, "callId") ??
      event.id;
    const existingIndex = current.findIndex(
      (item) => item.toolCallId === toolCallId,
    );
    const success = event.data.success !== false;
    const status = success ? "complete" : "error";
    const result = event.data.result ?? event.data.output;
    const toolError = success
      ? undefined
      : formatValue(event.data.error ?? result ?? "Tool execution failed.");
    if (existingIndex >= 0) {
      const messages = [...current];
      const existing = messages[existingIndex];
      messages[existingIndex] = {
        ...existing,
        content: toolActivityLabel(existing.toolName, status),
        eventType: event.eventType,
        toolResult: result,
        toolError,
        durationMs: elapsedMilliseconds(existing.createdAt, event.timestamp),
        status,
      };
      return messages;
    }
    const toolName = toolNameFromEvent(event);
    return [
      ...current,
      eventMessage(event, "tool", toolActivityLabel(toolName, status), {
        id: `tool-${toolCallId}`,
        eventType: event.eventType,
        toolName,
        toolCallId,
        toolResult: result,
        toolError,
        status,
      }),
    ];
  }

  if (event.eventType === "session.error") {
    const text = content || "The agent session failed.";
    return [
      ...current,
      eventMessage(event, "error", text, { eventType: event.eventType }),
    ];
  }

  if (event.eventType === "session.recovery") {
    return [
      ...current,
      eventMessage(event, "error", content || "A new agent session was created.", {
        eventType: event.eventType,
      }),
    ];
  }

  return current;
}

export function toolActivityLabel(
  toolName = "workspace tool",
  status: AgentMessage["status"] = "complete",
): string {
  const labels: Record<string, [string, string]> = {
    connect_to_database: ["Connecting to database", "Connected to database"],
    get_focused_tab: ["Reading focused tab", "Read focused tab"],
    list_query_tabs: ["Listing query tabs", "Listed query tabs"],
    get_database_schema: ["Reading database schema", "Read database schema"],
    get_table_schema: ["Reading table schema", "Read table schema"],
    search_schema: ["Searching schema", "Searched schema"],
    open_query_tab: ["Opening query tab", "Opened query tab"],
    replace_query_text: ["Updating query text", "Updated query text"],
    append_query_text: ["Appending query text", "Appended query text"],
    focus_query_tab: ["Focusing query tab", "Focused query tab"],
  };
  const [running, complete] = labels[toolName] ?? [
    `Running ${humanizeToolName(toolName)}`,
    `Ran ${humanizeToolName(toolName)}`,
  ];
  return status === "running" ? running : complete;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  panelOpen: false,
  initialized: false,
  loading: false,
  sending: false,
  lifecycleBusy: false,
  sessionsLoading: false,
  isAuthenticated: false,
  authMessage: null,
  models: [],
  model: null,
  reasoningEffort: null,
  sessionId: null,
  sessions: [],
  messages: [],
  error: null,

  async initialize() {
    if (get().loading) return;
    set({ loading: true, error: null });
    if (!get().initialized) {
      try {
        const saved = await loadAgentConversation();
        set({
          model: saved.model,
          reasoningEffort: saved.reasoningEffort ?? null,
          sessionId: saved.sessionId,
          messages: saved.messages,
        });
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    }
    try {
      const runtime = await getAgentStatus();
      applyRuntime(set, runtime);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
    set({ initialized: true, loading: false });
  },

  setPanelOpen(panelOpen) {
    set({ panelOpen });
  },

  async setModel(model) {
    if (get().sending || get().lifecycleBusy || model === get().model) return;
    if (!get().models.some((candidate) => candidate.id === model)) {
      set({ error: `Copilot model '${model}' is not available.` });
      return;
    }
    set({ lifecycleBusy: true, error: null });
    try {
      await configureAgentModel(model, null);
      set({ model, reasoningEffort: null, lifecycleBusy: false });
      await persist(get());
    } catch (error) {
      set({ lifecycleBusy: false, error: errorMessage(error) });
    }
  },

  async setReasoningEffort(reasoningEffort) {
    if (get().sending || get().lifecycleBusy) return;
    const model = get().model ?? get().models[0]?.id;
    const selectedModel = get().models.find(
      (candidate) => candidate.id === model,
    );
    if (!model || !selectedModel) return;
    if (
      reasoningEffort &&
      !selectedModel.supportedReasoningEfforts.includes(reasoningEffort)
    ) {
      set({
        error: `Reasoning effort '${reasoningEffort}' is not supported by ${selectedModel.name}.`,
      });
      return;
    }
    if (
      model === get().model &&
      reasoningEffort === get().reasoningEffort
    ) {
      return;
    }
    set({ lifecycleBusy: true, error: null });
    try {
      await configureAgentModel(model, reasoningEffort);
      set({ model, reasoningEffort, lifecycleBusy: false });
      await persist(get());
    } catch (error) {
      set({ lifecycleBusy: false, error: errorMessage(error) });
    }
  },

  async send(prompt, contextEnvelope) {
    if (get().sending || get().lifecycleBusy) return;
    const userMessage = message("user", prompt, { eventType: "local.user" });
    set((state) => ({
      sending: true,
      error: null,
      messages: [...state.messages, userMessage],
    }));
    try {
      const sessionId = await startAgentSession(
        get().sessionId,
        get().model,
        get().reasoningEffort,
      );
      set({ sessionId });
      persistWithoutBlocking(get, set);
      await sendAgentMessage(
        `${contextEnvelope}\n\n## User request\n${prompt.trim()}`,
        prompt.trim(),
      );
    } catch (error) {
      const text = errorMessage(error);
      set((state) => ({
        sending: false,
        error: text,
        messages: [...state.messages, message("error", text)],
      }));
      persistWithoutBlocking(get, set);
    }
  },

  async abort() {
    try {
      await abortAgentTurn();
    } finally {
      set({ sending: false });
    }
  },

  async clearConversation() {
    if (get().loading || get().sending || get().lifecycleBusy) return;
    const sessionId = get().sessionId;
    let runtimeCleared = false;
    set({ sessionId: null, lifecycleBusy: true, error: null });
    try {
      await clearAgentSession(sessionId);
      runtimeCleared = true;
      await persistQueue.catch(() => undefined);
      await clearAgentConversationData();
      set({
        messages: [],
        sending: false,
        lifecycleBusy: false,
        error: null,
      });
      await get().loadSessions();
    } catch (error) {
      set({
        sessionId: runtimeCleared ? null : sessionId,
        messages: runtimeCleared ? [] : get().messages,
        lifecycleBusy: false,
        error: errorMessage(error),
      });
    }
  },

  async loadSessions() {
    if (get().sessionsLoading) return;
    set({ sessionsLoading: true });
    try {
      const sessions = await listAgentSessions();
      set({ sessions, sessionsLoading: false });
    } catch (error) {
      set({ sessionsLoading: false, error: errorMessage(error) });
    }
  },

  async startNewSession() {
    if (get().sending || get().lifecycleBusy) return;
    set({ lifecycleBusy: true, sessionsLoading: true, error: null });
    try {
      const snapshot = await createNewAgentSession(
        get().model,
        get().reasoningEffort,
      );
      set({
        sessionId: snapshot.sessionId,
        messages: [],
        sending: false,
        lifecycleBusy: false,
        sessionsLoading: false,
      });
      persistWithoutBlocking(get, set);
      await get().loadSessions();
    } catch (error) {
      set({
        lifecycleBusy: false,
        sessionsLoading: false,
        error: errorMessage(error),
      });
    }
  },

  async resumeSession(sessionId) {
    if (get().sending || get().lifecycleBusy || get().sessionsLoading) return;
    set({ lifecycleBusy: true, sessionsLoading: true, error: null });
    try {
      const snapshot = await resumeAgentSession(
        sessionId,
        get().model,
        get().reasoningEffort,
      );
      set({
        sessionId: snapshot.sessionId,
        messages: messagesFromAgentEvents(snapshot.events),
        sending: false,
        lifecycleBusy: false,
        sessionsLoading: false,
      });
      persistWithoutBlocking(get, set);
      await get().loadSessions();
    } catch (error) {
      set({
        lifecycleBusy: false,
        sessionsLoading: false,
        error: errorMessage(error),
      });
    }
  },

  async renameSession(sessionId, name) {
    const trimmed = name.trim();
    if (get().sessionsLoading || !trimmed) return;
    set({ sessionsLoading: true, error: null });
    try {
      await renameAgentSession(sessionId, trimmed);
      set({ sessionsLoading: false });
      await get().loadSessions();
    } catch (error) {
      set({ sessionsLoading: false, error: errorMessage(error) });
    }
  },

  async deleteSession(sessionId) {
    if (get().sending || get().lifecycleBusy || get().sessionsLoading) return;
    const wasActive = sessionId === get().sessionId;
    let backendDeleted = false;
    set({
      sessionId: wasActive ? null : get().sessionId,
      lifecycleBusy: true,
      sessionsLoading: true,
      error: null,
    });
    try {
      const deletedActive = await deleteAgentSession(sessionId);
      backendDeleted = true;
      if (wasActive || deletedActive) {
        await persistQueue.catch(() => undefined);
        await clearAgentConversationData();
        set({ sessionId: null, messages: [], sending: false });
      }
      set({ lifecycleBusy: false, sessionsLoading: false });
      await get().loadSessions();
    } catch (error) {
      if (backendDeleted) {
        set({
          sessionId: null,
          messages: [],
          sending: false,
          lifecycleBusy: false,
          sessionsLoading: false,
          error: `Session was deleted, but its local transcript could not be cleared: ${errorMessage(error)}`,
        });
        persistWithoutBlocking(get, set);
        return;
      }
      set({
        sessionId: wasActive ? sessionId : get().sessionId,
        lifecycleBusy: false,
        sessionsLoading: false,
        error: errorMessage(error),
      });
    }
  },

  handleEvent(event) {
    const state = get();
    if (
      event.sessionId &&
      event.sessionId !== state.sessionId
    ) {
      return;
    }
    const messages = reduceAgentEvent(state.messages, event);
    const sessionFailed = event.eventType === "session.error";
    const becameIdle = event.eventType === "session.idle";
    const content =
      stringField(event.data, "message") ??
      stringField(event.data, "content") ??
      "The agent session failed.";
    set({
      messages,
      sending: sessionFailed || becameIdle ? false : state.sending,
      error: sessionFailed ? content : state.error,
    });
    if (
      messages !== state.messages &&
      event.eventType !== "assistant.message_delta"
    ) {
      void persist(get()).catch((error) =>
        set({
          error: `Could not save agent conversation: ${errorMessage(error)}`,
        }),
      );
    }
  },
}));

function persistWithoutBlocking(
  get: () => AgentState,
  set: (partial: Partial<AgentState>) => void,
): void {
  void persist(get()).catch((error) =>
    set({
      error: `Could not save agent conversation: ${errorMessage(error)}`,
    }),
  );
}

function persistableMessage(item: AgentMessage): AgentMessage {
  if (item.kind !== "tool") return item;
  return {
    ...item,
    toolArguments: boundToolDetail(item.toolArguments),
    toolResult: boundToolDetail(item.toolResult),
    toolError: item.toolError
      ? truncateUtf8(item.toolError, MAX_PERSISTED_TOOL_DETAIL_BYTES)
      : undefined,
  };
}

function boundToolDetail(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = formatValue(value);
  if (utf8Length(serialized) <= MAX_PERSISTED_TOOL_DETAIL_BYTES) return value;
  return {
    truncated: true,
    preview: truncateUtf8(serialized, MAX_PERSISTED_TOOL_DETAIL_BYTES),
    notice: "Full detail is available by reopening this SDK session.",
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Length(value.slice(0, middle)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${value.slice(0, low)}\n...`;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function applyRuntime(
  set: (partial: Partial<AgentState>) => void,
  runtime: AgentRuntimeInfo,
): void {
  const state = useAgentStore.getState();
  const selectedModel = runtime.models.find(
    (candidate) => candidate.id === state.model,
  );
  const model =
    runtime.models.length === 0
      ? state.model
      : selectedModel
        ? state.model
        : null;
  const reasoningEffort =
    runtime.models.length === 0
      ? state.reasoningEffort
      : selectedModel &&
          state.reasoningEffort &&
          selectedModel.supportedReasoningEfforts.includes(
            state.reasoningEffort,
          )
        ? state.reasoningEffort
        : null;
  set({
    isAuthenticated: runtime.isAuthenticated,
    authMessage: runtime.statusMessage ?? null,
    models: runtime.models,
    model,
    reasoningEffort,
  });
}

function eventMessage(
  event: AgentSessionEvent,
  kind: AgentMessage["kind"],
  content: string,
  extra: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id: event.id,
    kind,
    content,
    createdAt: event.timestamp,
    ...extra,
  };
}

function stringField(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

function toolNameFromEvent(event: AgentSessionEvent): string {
  const description = event.data.toolDescription;
  return (
    stringField(event.data, "toolName") ??
    stringField(event.data, "name") ??
    (isRecord(description) ? stringField(description, "name") : null) ??
    "workspace tool"
  );
}

function extractDisplayPrompt(content: string): string {
  const marker = "\n\n## User request\n";
  const markerIndex = content.lastIndexOf(marker);
  return markerIndex >= 0 ? content.slice(markerIndex + marker.length).trim() : content;
}

function elapsedMilliseconds(start: string, end: string): number | undefined {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function humanizeToolName(value: string): string {
  return value.replace(/_/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
