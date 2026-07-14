import { useEffect, useState } from "react";

import { contextKey, inheritedContext } from "../../lib/agent/context";
import { useContextStore } from "../../store/contextStore";
import type { AgentContextTarget } from "../../types/agent";
import { Modal } from "../ui/Modal";

interface ContextEditorDialogProps {
  open: boolean;
  target: AgentContextTarget | null;
  onClose: () => void;
}

export function ContextEditorDialog({
  open,
  target,
  onClose,
}: ContextEditorDialogProps) {
  const entries = useContextStore((state) => state.entries);
  const save = useContextStore((state) => state.save);
  const remove = useContextStore((state) => state.remove);
  const error = useContextStore((state) => state.error);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const key = target ? contextKey(target) : "";
  const existing = entries.find((entry) => entry.key === key);

  useEffect(() => {
    if (open) setContent(existing?.content ?? "");
  }, [existing?.content, open]);

  if (!target) return null;
  const inherited = inheritedContext(entries, target).filter(
    (entry) => entry.key !== key,
  );
  const label =
    target.entityName ?? target.database ?? target.clusterName;

  async function handleSave() {
    if (!target) return;
    setSaving(true);
    try {
      if (content.trim()) await save(target, content.trim());
      else if (existing) await remove(existing.key);
      onClose();
    } catch {
      // The store exposes the persistence error below and restores prior state.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Personal context: ${label}`}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          This guidance is stored locally and may be sent to the selected
          Copilot model. Do not include secrets, credentials, or database row
          data.
        </p>
        {inherited.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
            <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-muted)]">
              Inherited context
            </div>
            {inherited.map((entry) => (
              <div key={entry.key} className="mb-2 last:mb-0">
                <div className="text-[10px] uppercase text-[var(--color-text-faint)]">
                  {entry.scope}
                </div>
                <div className="whitespace-pre-wrap text-xs">{entry.content}</div>
              </div>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Context for this {target.scope}
          <textarea
            autoFocus
            aria-label={`Context for ${label}`}
            rows={8}
            maxLength={65_536}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Business meaning, naming conventions, preferred filters, joins, freshness, or caveats..."
            className="resize-y rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="btn"
            disabled={!existing || saving}
            onClick={() => {
              setContent("");
              setSaving(true);
              void remove(key)
                .then(onClose)
                .catch(() => undefined)
                .finally(() => setSaving(false));
            }}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
