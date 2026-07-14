// Typed wrappers around Tauri `invoke` calls. Keeping the command names and
// argument shapes in one place makes the rest of the app easy to test (mock
// this module) and keeps the string command names from leaking everywhere.

import { invoke } from "@tauri-apps/api/core";

import type {
  AgentContextData,
  AgentConversationData,
  AgentRuntimeInfo,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentWorkspaceResult,
} from "../types/agent";
import type {
  DatabaseSchema,
  ExportFormat,
  KustoResultSet,
  QueryResponse,
  SchemaResponse,
  ShareMode,
} from "../types/kusto";

/** Run a KQL query or `.`-prefixed management command. */
export function runQuery(args: {
  cluster: string;
  database: string;
  query: string;
  tenant?: string;
}): Promise<QueryResponse> {
  return invoke<QueryResponse>("run_query", {
    cluster: args.cluster,
    database: args.database,
    query: args.query,
    tenant: args.tenant ?? null,
  });
}

/** List database names on a cluster. */
export function listDatabases(args: {
  cluster: string;
  tenant?: string;
}): Promise<string[]> {
  return invoke<string[]>("list_databases", {
    cluster: args.cluster,
    tenant: args.tenant ?? null,
  });
}

/** Fetch a database's schema (structured tree + raw payload for IntelliSense). */
export function getSchema(args: {
  cluster: string;
  database: string;
  tenant?: string;
}): Promise<SchemaResponse> {
  return invoke<SchemaResponse>("get_schema", {
    cluster: args.cluster,
    database: args.database,
    tenant: args.tenant ?? null,
  });
}

/** Build clipboard text for the Share button. */
export function formatShare(args: {
  mode: ShareMode;
  query: string;
  result: KustoResultSet;
}): Promise<string> {
  return invoke<string>("format_share", {
    mode: args.mode,
    query: args.query,
    result: args.result,
  });
}

/** Write a result set to `path` as CSV. */
export function exportCsv(args: {
  path: string;
  result: KustoResultSet;
}): Promise<void> {
  return invoke<void>("export_csv", {
    path: args.path,
    result: args.result,
  });
}

/** Write a result set to `path` in the requested format (CSV/JSON/TSV). */
export function exportResult(args: {
  path: string;
  format: ExportFormat;
  result: KustoResultSet;
}): Promise<void> {
  return invoke<void>("export_result", {
    path: args.path,
    format: args.format,
    result: args.result,
  });
}

// The agent command surface intentionally contains no query execution or
// result-reading operation.
export function loadAgentContext(): Promise<AgentContextData> {
  return invoke<AgentContextData>("load_agent_context");
}

export function saveAgentContext(data: AgentContextData): Promise<void> {
  return invoke("save_agent_context", { data });
}

export function loadAgentConversation(): Promise<AgentConversationData> {
  return invoke<AgentConversationData>("load_agent_conversation");
}

export function saveAgentConversation(
  data: AgentConversationData,
): Promise<void> {
  return invoke("save_agent_conversation", { data });
}

export function clearAgentConversationData(): Promise<void> {
  return invoke("clear_agent_conversation");
}

export function getAgentStatus(): Promise<AgentRuntimeInfo> {
  return invoke<AgentRuntimeInfo>("get_agent_status");
}

export function startAgentSession(
  sessionId: string | null,
  model: string | null,
  reasoningEffort: string | null,
): Promise<string> {
  return invoke<string>("start_agent_session", {
    sessionId,
    model,
    reasoningEffort,
  });
}

export function sendAgentMessage(
  prompt: string,
  displayPrompt: string,
): Promise<void> {
  return invoke("send_agent_message", { prompt, displayPrompt });
}

export function listAgentSessions(): Promise<AgentSessionSummary[]> {
  return invoke<AgentSessionSummary[]>("list_agent_sessions");
}

export function renameAgentSession(
  sessionId: string,
  name: string,
): Promise<void> {
  return invoke("rename_agent_session", { sessionId, name });
}

export function deleteAgentSession(sessionId: string): Promise<boolean> {
  return invoke<boolean>("delete_agent_session", { sessionId });
}

export function createNewAgentSession(
  model: string | null,
  reasoningEffort: string | null,
): Promise<AgentSessionSnapshot> {
  return invoke<AgentSessionSnapshot>("create_new_agent_session", {
    model,
    reasoningEffort,
  });
}

export function resumeAgentSession(
  sessionId: string,
  model: string | null,
  reasoningEffort: string | null,
): Promise<AgentSessionSnapshot> {
  return invoke<AgentSessionSnapshot>("resume_agent_session", {
    sessionId,
    model,
    reasoningEffort,
  });
}

export function configureAgentModel(
  model: string,
  reasoningEffort: string | null,
): Promise<void> {
  return invoke("configure_agent_model", { model, reasoningEffort });
}

export function abortAgentTurn(): Promise<void> {
  return invoke("abort_agent_turn");
}

export function clearAgentSession(sessionId: string | null): Promise<void> {
  return invoke("clear_agent_session", { sessionId });
}

export function completeAgentWorkspaceRequest(
  id: string,
  result: AgentWorkspaceResult,
): Promise<void> {
  return invoke("complete_agent_workspace_request", { id, result });
}

export type { DatabaseSchema };
