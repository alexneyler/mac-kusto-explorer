import type { DatabaseSchema } from "./kusto";

export const AGENT_DATA_VERSION = 1;

export type SchemaEntityKind =
  | "table"
  | "materializedView"
  | "externalTable";

export interface AgentContextTarget {
  scope: "cluster" | "database" | "table";
  clusterId: string;
  clusterName: string;
  database?: string;
  entityKind?: SchemaEntityKind;
  entityName?: string;
}

export interface AgentContextEntry extends AgentContextTarget {
  key: string;
  content: string;
  updatedAt: string;
}

export interface AgentContextData {
  version: number;
  entries: AgentContextEntry[];
}

export type AgentMessageKind = "user" | "assistant" | "tool" | "error";

export interface AgentMessage {
  id: string;
  kind: AgentMessageKind;
  content: string;
  createdAt: string;
  eventType?: string;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  toolError?: string;
  durationMs?: number;
  status?: "running" | "complete" | "error";
}

export interface AgentConversationData {
  version: number;
  sessionId: string | null;
  model: string | null;
  reasoningEffort: string | null;
  messages: AgentMessage[];
}

export interface AgentAuthStatus {
  isAuthenticated: boolean;
  authType?: string;
  host?: string;
  login?: string;
  statusMessage?: string;
}

export interface AgentModel {
  id: string;
  name: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: string[];
}

export interface AgentRuntimeInfo {
  sessionId: string | null;
  isAuthenticated: boolean;
  authType?: string;
  login?: string;
  statusMessage?: string;
  models: AgentModel[];
}

export interface AgentSessionEvent {
  id: string;
  sessionId?: string;
  timestamp: string;
  eventType: string;
  data: Record<string, unknown>;
}

export interface AgentSessionSummary {
  sessionId: string;
  startTime: string;
  modifiedTime: string;
  name?: string;
  summary?: string;
  isRemote: boolean;
  isActive: boolean;
}

export interface AgentSessionSnapshot {
  sessionId: string;
  events: AgentSessionEvent[];
}

export interface AgentWorkspaceRequest {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface AgentWorkspaceResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface FocusedTabAgentView {
  id: string;
  title: string;
  query: string;
  revision: number;
  clusterId: string | null;
  clusterName: string | null;
  database: string | null;
}

export interface AgentSchemaView {
  clusterId: string;
  database: string;
  schema: DatabaseSchema;
}
