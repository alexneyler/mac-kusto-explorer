import { type FormEvent, useEffect, useState } from "react";

import { useAppStore } from "../store/appStore";
import type { Connection } from "../types/kusto";
import { Modal } from "./ui/Modal";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  connection?: Connection | null;
}

/** Form to add a cluster by URL (or short name), with an optional tenant. */
export function AddConnectionDialog({
  open,
  onClose,
  connection = null,
}: AddConnectionDialogProps) {
  const addConnection = useAppStore((s) => s.addConnection);
  const updateConnection = useAppStore((s) => s.updateConnection);
  const [name, setName] = useState("");
  const [clusterUrl, setClusterUrl] = useState("");
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editing = connection !== null;

  useEffect(() => {
    if (!open) return;
    setName(connection?.name ?? "");
    setClusterUrl(connection?.clusterUrl ?? "");
    setTenant(connection?.tenant ?? "");
    setError(null);
  }, [connection, open]);

  function reset() {
    setName("");
    setClusterUrl("");
    setTenant("");
    setError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (connection) {
        updateConnection(connection.id, {
          name,
          tenant: tenant.trim() || undefined,
        });
      } else {
        addConnection({
          clusterUrl,
          name: name.trim() || undefined,
          tenant: tenant.trim() || undefined,
        });
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit connection" : "Add connection"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Display name {editing ? "" : "(optional)"}
          <input
            autoFocus={editing}
            aria-label="Connection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Cluster URL or name
          <input
            autoFocus={!editing}
            aria-label="Cluster URL"
            placeholder="https://help.kusto.windows.net"
            value={clusterUrl}
            disabled={editing}
            onChange={(e) => setClusterUrl(e.target.value)}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
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
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
