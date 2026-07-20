import {
  FolderOpen,
  Copy,
  Download,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAgentStore } from "../../store/agentStore";
import { copyText } from "../../lib/clipboard";
import { showToast } from "../../store/toast";
import { errorMessage } from "../../types/kusto";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { AgentSessionSummary } from "../../types/agent";
import { Modal } from "../ui/Modal";

interface SessionMenuState {
  session: AgentSessionSummary;
  x: number;
  y: number;
}

export function AgentSessionBrowser({ onClose }: { onClose(): void }) {
  const sessions = useAgentStore((state) => state.sessions);
  const sessionsLoading = useAgentStore((state) => state.sessionsLoading);
  const lifecycleBusy = useAgentStore((state) => state.lifecycleBusy);
  const sending = useAgentStore((state) => state.sending);
  const error = useAgentStore((state) => state.error);
  const activeSessionId = useAgentStore((state) => state.sessionId);
  const loadSessions = useAgentStore((state) => state.loadSessions);
  const resumeSession = useAgentStore((state) => state.resumeSession);
  const renameSession = useAgentStore((state) => state.renameSession);
  const deleteSession = useAgentStore((state) => state.deleteSession);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const [renameTarget, setRenameTarget] =
    useState<AgentSessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AgentSessionSummary | null>(null);
  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sessions;
    return sessions.filter(
      (session) =>
        sessionTitle(session).toLocaleLowerCase().includes(query) ||
        session.sessionId.toLocaleLowerCase().includes(query),
    );
  }, [search, sessions]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  async function openSession(sessionId: string) {
    await resumeSession(sessionId);
    if (useAgentStore.getState().sessionId === sessionId) onClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div className="text-sm font-semibold">Sessions</div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Refresh sessions"
          title="Refresh sessions"
          disabled={sessionsLoading || lifecycleBusy}
          onClick={() => void loadSessions()}
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={sessionsLoading ? "animate-spin" : ""}
          />
        </button>
      </div>
      <label className="mb-3 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2">
        <Search size={13} className="text-[var(--color-text-faint)]" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sessions"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none placeholder:text-[var(--color-text-faint)]"
        />
      </label>
      {error && (
        <div className="mb-2 rounded border border-[var(--color-danger)] px-2 py-1.5 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {sessionsLoading && sessions.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            Loading sessions...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            {search ? "No matching sessions." : "No previous sessions yet."}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredSessions.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  disabled={sessionsLoading || lifecycleBusy || sending}
                  onClick={() => void openSession(session.sessionId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const menuWidth = 160;
                    const menuHeight = 180;
                    setMenu({
                      session,
                      x: Math.min(
                        event.clientX,
                        Math.max(4, window.innerWidth - menuWidth - 4),
                      ),
                      y: Math.min(
                        event.clientY,
                        Math.max(4, window.innerHeight - menuHeight - 4),
                      ),
                    });
                  }}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--color-bg-hover)] disabled:opacity-50 ${
                    isActive ? "bg-[var(--color-bg-active)]" : ""
                  }`}
                >
                  <MessageSquare
                    size={14}
                    className={`mt-0.5 shrink-0 ${
                      isActive
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-text-faint)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {sessionTitle(session)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[var(--color-text-faint)]">
                      {relativeTime(session.modifiedTime)}
                      {isActive ? " · Active" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <div
          role="menu"
          aria-label={`Actions for ${sessionTitle(menu.session)}`}
          className="fixed z-50 w-40 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <SessionMenuButton
            icon={<FolderOpen size={13} />}
            onClick={() => {
              const sessionId = menu.session.sessionId;
              setMenu(null);
              void openSession(sessionId);
            }}
          >
            Open
          </SessionMenuButton>
          <SessionMenuButton
            icon={<Pencil size={13} />}
            onClick={() => {
              setRenameTarget(menu.session);
              setMenu(null);
            }}
          >
            Rename
          </SessionMenuButton>
          <SessionMenuButton
            icon={<Copy size={13} />}
            onClick={() => {
              void copyText(menu.session.sessionId, "Session ID");
              setMenu(null);
            }}
          >
            Copy session ID
          </SessionMenuButton>
          <SessionMenuButton
            icon={<Download size={13} />}
            disabled={menu.session.sessionId !== activeSessionId}
            onClick={() => {
              void exportActiveConversation(menu.session);
              setMenu(null);
            }}
          >
            Export conversation
          </SessionMenuButton>
          <SessionMenuButton
            danger
            disabled={sending}
            icon={<Trash2 size={13} />}
            onClick={() => {
              setDeleteTarget(menu.session);
              setMenu(null);
            }}
          >
            Delete
          </SessionMenuButton>
        </div>
      )}

      <RenameSessionDialog
        key={renameTarget?.sessionId ?? "rename-closed"}
        session={renameTarget}
        busy={sessionsLoading}
        onClose={() => setRenameTarget(null)}
        onRename={(name) => {
          if (!renameTarget) return;
          void renameSession(renameTarget.sessionId, name).then(() =>
            setRenameTarget(null),
          );
        }}
      />
      <DeleteSessionDialog
        session={deleteTarget}
        busy={lifecycleBusy}
        onClose={() => setDeleteTarget(null)}
        onDelete={() => {
          if (!deleteTarget) return;
          void deleteSession(deleteTarget.sessionId).then(() =>
            setDeleteTarget(null),
          );
        }}
      />
    </div>
  );
}

function SessionMenuButton({
  children,
  icon,
  danger = false,
  disabled = false,
  onClick,
}: {
  children: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--color-bg-hover)] disabled:opacity-50 ${
        danger ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function RenameSessionDialog({
  session,
  busy,
  onClose,
  onRename,
}: {
  session: AgentSessionSummary | null;
  busy: boolean;
  onClose(): void;
  onRename(name: string): void;
}) {
  const [name, setName] = useState(session ? sessionTitle(session) : "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) onRename(name.trim());
  }

  return (
    <Modal open={session !== null} onClose={onClose} title="Rename session">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Session name
          <input
            autoFocus
            aria-label="Session name"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !name.trim()}
          >
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSessionDialog({
  session,
  busy,
  onClose,
  onDelete,
}: {
  session: AgentSessionSummary | null;
  busy: boolean;
  onClose(): void;
  onDelete(): void;
}) {
  return (
    <Modal open={session !== null} onClose={onClose} title="Delete session">
      <p className="text-xs leading-5 text-[var(--color-text-muted)]">
        Permanently delete “{session ? sessionTitle(session) : ""}” and its
        Copilot conversation history?
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn border-[var(--color-danger)] text-[var(--color-danger)]"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

function sessionTitle(session: AgentSessionSummary): string {
  const name = session.name?.trim();
  const summary = session.summary?.trim().split("\n")[0];
  return name || summary || `Query session ${session.sessionId.slice(0, 8)}`;
}

function relativeTime(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return timestamp;
  const deltaSeconds = Math.round((time - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, "second");
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return formatter.format(deltaHours, "hour");
  }
  const deltaDays = Math.round(deltaHours / 24);
  if (Math.abs(deltaDays) < 30) {
    return formatter.format(deltaDays, "day");
  }
  const deltaMonths = Math.round(deltaDays / 30);
  if (Math.abs(deltaMonths) < 12) {
    return formatter.format(deltaMonths, "month");
  }
  return formatter.format(Math.round(deltaMonths / 12), "year");
}

async function exportActiveConversation(
  session: AgentSessionSummary,
): Promise<void> {
  const state = useAgentStore.getState();
  if (state.sessionId !== session.sessionId) return;
  try {
    const transcript = state.messages
      .map((message) => `## ${message.kind}\n\n${message.content}`)
      .join("\n\n");
    const defaultPath = `${sessionTitle(session).replace(
      /[^A-Za-z0-9_-]+/g,
      "-",
    )}.md`;
    const path = await save({
      title: "Export conversation",
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await writeTextFile(path, transcript);
    showToast("Conversation exported", "success");
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}
