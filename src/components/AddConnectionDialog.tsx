import { type FormEvent, useState } from "react";

import { useAppStore } from "../store/appStore";
import { Modal } from "./ui/Modal";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Form to add a cluster by URL (or short name), with an optional tenant. */
export function AddConnectionDialog({ open, onClose }: AddConnectionDialogProps) {
  const addConnection = useAppStore((s) => s.addConnection);
  const [clusterUrl, setClusterUrl] = useState("");
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setClusterUrl("");
    setTenant("");
    setError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      addConnection({
        clusterUrl,
        tenant: tenant.trim() || undefined,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add connection">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Cluster URL or name
          <input
            autoFocus
            aria-label="Cluster URL"
            placeholder="https://help.kusto.windows.net"
            value={clusterUrl}
            onChange={(e) => setClusterUrl(e.target.value)}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Tenant (optional)
          <input
            aria-label="Tenant"
            placeholder="Leave blank to use your default az login"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}
