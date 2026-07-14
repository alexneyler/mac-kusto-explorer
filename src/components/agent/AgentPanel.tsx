import {
  Bot,
  Clock3,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { buildInitialAgentContext } from "../../lib/agent/context";
import { useAgentStore } from "../../store/agentStore";
import { useAppStore } from "../../store/appStore";
import { useContextStore } from "../../store/contextStore";
import { AgentSessionBrowser } from "./AgentSessionBrowser";
import { AgentModelControls } from "./AgentModelControls";
import { AgentWorkingIndicator } from "./AgentWorkingIndicator";
import { ToolCallCard } from "./ToolCallCard";
import { ContextManagerDialog } from "../context/ContextManagerDialog";

export function AgentPanel() {
  const state = useAgentStore();
  const tabs = useAppStore((app) => app.tabs);
  const activeTabId = useAppStore((app) => app.activeTabId);
  const connections = useAppStore((app) => app.connections);
  const entries = useContextStore((context) => context.entries);
  const [prompt, setPrompt] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const connection =
    connections.find(
      (candidate) => candidate.id === activeTab?.connectionId,
    ) ?? null;
  const contextEnvelope = useMemo(
    () =>
      activeTab
        ? buildInitialAgentContext({ tab: activeTab, connection, entries })
        : "# Focused query tab\nNo query tab is open.\n\n# Personal context\nNo personal context attached.",
    [activeTab, connection, entries],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = prompt.trim();
    if (
      !value ||
      state.sending ||
      state.lifecycleBusy ||
      !state.isAuthenticated
    ) {
      return;
    }
    setPrompt("");
    setSessionsOpen(false);
    void state.send(value, contextEnvelope);
  }

  return (
    <aside
      aria-label="Kusto query agent"
      className="flex h-full min-w-0 flex-col bg-[var(--color-bg-elevated)]"
    >
      <div className="flex h-11 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <Bot size={16} className="text-[var(--color-accent)]" />
        <div className="font-semibold">Query agent</div>
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            state.isAuthenticated
              ? "bg-[var(--color-success)]"
              : "bg-[var(--color-warning)]"
          }`}
          title={
            state.isAuthenticated ? "Copilot authenticated" : "Copilot unavailable"
          }
        />
        <div className="flex-1" />
        <button
          type="button"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
          aria-label="New agent session"
          title="New session"
          disabled={
            !state.isAuthenticated ||
            state.sending ||
            state.sessionsLoading ||
            state.lifecycleBusy
          }
          onClick={() => {
            const currentSessionId = state.sessionId;
            void state.startNewSession().then(() => {
              if (useAgentStore.getState().sessionId !== currentSessionId) {
                setSessionsOpen(false);
              }
            });
          }}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className={`rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] ${
            sessionsOpen
              ? "bg-[var(--color-bg-active)] text-[var(--color-text)]"
              : ""
          }`}
          aria-label={
            sessionsOpen ? "Return to conversation" : "View agent sessions"
          }
          title={sessionsOpen ? "Return to conversation" : "View sessions"}
          onClick={() => {
            const nextOpen = !sessionsOpen;
            setSessionsOpen(nextOpen);
            if (nextOpen) void state.loadSessions();
          }}
        >
          <Clock3 size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
          aria-label="Manage personal context"
          title="Manage personal context"
          onClick={() => setManagerOpen(true)}
        >
          <Settings size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
          aria-label="Clear conversation"
          title="Clear conversation"
          disabled={state.loading || state.sending || state.lifecycleBusy}
          onClick={() => void state.clearConversation()}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
          aria-label="Close agent"
          onClick={() => state.setPanelOpen(false)}
        >
          <X size={15} />
        </button>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <div className="truncate text-[11px] text-[var(--color-text-muted)]">
          {connection?.name ?? "No cluster"} · {activeTab?.database ?? "No database"}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {state.loading ? (
          <div className="text-xs text-[var(--color-text-muted)]">
            Starting bundled Copilot runtime...
          </div>
        ) : !state.isAuthenticated ? (
          <div className="rounded-md border border-[var(--color-warning)] p-3 text-xs">
            <div className="mb-1 font-semibold">Copilot sign-in required</div>
            <p className="text-[var(--color-text-muted)]">
              {state.authMessage ??
                state.error ??
                "Sign in with GitHub CLI or Copilot CLI, then reopen the agent."}
            </p>
            <button
              type="button"
              className="btn mt-3"
              disabled={state.loading}
              onClick={() => void state.initialize()}
            >
              Retry
            </button>
          </div>
        ) : sessionsOpen ? (
          <AgentSessionBrowser onClose={() => setSessionsOpen(false)} />
        ) : state.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Bot size={28} className="mb-3 text-[var(--color-accent)]" />
            <div className="mb-1 text-sm font-semibold">
              Write KQL with Copilot
            </div>
            <p className="max-w-64 text-xs leading-5 text-[var(--color-text-muted)]">
              I can read schema metadata and editor text, then open or edit query
              tabs. I cannot run queries, read results, or access database rows.
            </p>
            <div className="mt-4 text-[11px] text-[var(--color-text-faint)]">
              Try: “Write a query for the selected table”
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.messages.map((item) =>
              item.kind === "tool" ? (
                <ToolCallCard key={item.id} message={item} />
              ) : (
                <div
                  key={item.id}
                  className={`whitespace-pre-wrap rounded-md p-2 text-xs leading-5 ${
                    item.kind === "user"
                      ? "ml-6 bg-[var(--color-accent-soft)]"
                      : item.kind === "error"
                        ? "border border-[var(--color-danger)]"
                        : "mr-4 bg-[var(--color-bg)]"
                  }`}
                >
                  {item.content}
                </div>
              ),
            )}
            {state.sending && <AgentWorkingIndicator />}
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="border-t border-[var(--color-border)] p-3"
      >
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg)] focus-within:border-[var(--color-accent)]">
          <textarea
            aria-label="Message query agent"
            rows={3}
            value={prompt}
            disabled={!state.isAuthenticated || state.lifecycleBusy}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask for help writing KQL..."
            className="w-full resize-none bg-transparent p-3 pb-1 text-xs outline-none disabled:opacity-50"
          />
          <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
            <AgentModelControls />
            <div className="flex-1" />
            <div
              className="truncate px-1 text-[10px] text-[var(--color-text-faint)]"
              title="Metadata and editor text only. The agent never executes KQL."
            >
              Metadata only
            </div>
            {state.sending ? (
              <button
                type="button"
                className="rounded-md border border-[var(--color-border-strong)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                aria-label="Stop agent"
                title="Stop"
                onClick={() => void state.abort()}
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                type="submit"
                className="rounded-md bg-[var(--color-accent)] p-1.5 text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                aria-label="Send message"
                title="Send"
                disabled={
                  !prompt.trim() ||
                  !state.isAuthenticated ||
                  state.lifecycleBusy
                }
              >
                <Send size={12} />
              </button>
            )}
          </div>
        </div>
      </form>

      <ContextManagerDialog
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
    </aside>
  );
}
