import { useState } from "react";

import { useContextStore } from "../../store/contextStore";
import type { AgentContextEntry } from "../../types/agent";
import { ContextEditorDialog } from "./ContextEditorDialog";
import { Modal } from "../ui/Modal";

interface ContextManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ContextManagerDialog({
  open,
  onClose,
}: ContextManagerDialogProps) {
  const entries = useContextStore((state) => state.entries);
  const clear = useContextStore((state) => state.clear);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AgentContextEntry | null>(null);
  const normalized = query.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      !normalized ||
      entry.key.toLowerCase().includes(normalized) ||
      entry.content.toLowerCase().includes(normalized),
  );

  return (
    <>
      <Modal open={open} onClose={onClose} title="Personal context">
        <div className="flex max-h-[60vh] flex-col gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Context is stored locally. It is separate from the agent
            conversation and remains after a connection is removed.
          </p>
          <input
            aria-label="Search personal context"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search context..."
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-border)]">
            {visible.length === 0 ? (
              <div className="p-4 text-center text-xs text-[var(--color-text-faint)]">
                No personal context entries.
              </div>
            ) : (
              visible.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="block w-full border-b border-[var(--color-border)] p-2 text-left last:border-b-0 hover:bg-[var(--color-bg-hover)]"
                  onClick={() => setEditing(entry)}
                >
                  <div className="truncate text-xs font-semibold">
                    {entry.entityName ?? entry.database ?? entry.clusterName}
                  </div>
                  <div className="truncate text-[11px] text-[var(--color-text-muted)]">
                    {entry.scope} · {entry.content}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="flex justify-between">
            <button
              type="button"
              className="btn"
              disabled={entries.length === 0}
              onClick={() => void clear()}
            >
              Clear all context
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
      <ContextEditorDialog
        open={editing !== null}
        target={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
