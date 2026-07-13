import { Database, Moon, Play, Plus, Server, Sun } from "lucide-react";
import { useState } from "react";

import {
  selectActiveConnection,
  useAppStore,
} from "../store/appStore";
import { useThemeStore } from "../store/themeStore";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { ShareExportButtons } from "./ShareExportButtons";

export function Toolbar() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const connections = useAppStore((s) => s.connections);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const activeConnection = useAppStore(selectActiveConnection);
  const activeDatabase = useAppStore((s) => s.activeDatabase);
  const databasesByConn = useAppStore((s) => s.databasesByConn);
  const running = useAppStore((s) => s.running);
  const setActiveConnection = useAppStore((s) => s.setActiveConnection);
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase);
  const runActiveQuery = useAppStore((s) => s.runActiveQuery);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const databases = activeConnectionId
    ? (databasesByConn[activeConnectionId] ?? [])
    : [];
  const canRun = Boolean(activeConnection && activeDatabase && !running);

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2">
      <div className="mr-1 flex items-center gap-2 pr-2 font-semibold">
        <span className="text-[var(--color-accent)]">Kusto</span>
        <span className="text-[var(--color-text-muted)]">Explorer</span>
      </div>

      {/* Connection selector */}
      <div className="flex items-center gap-1.5">
        <Server size={14} className="text-[var(--color-text-faint)]" />
        <select
          aria-label="Connection"
          className="min-w-[160px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          value={activeConnectionId ?? ""}
          onChange={(e) => setActiveConnection(e.target.value)}
        >
          {connections.length === 0 && <option value="">No connections</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="btn px-2 py-1"
          title="Add connection"
          aria-label="Add connection"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Database selector */}
      <div className="flex items-center gap-1.5">
        <Database size={14} className="text-[var(--color-text-faint)]" />
        <select
          aria-label="Database"
          disabled={!activeConnection || databases.length === 0}
          className="min-w-[150px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          value={activeDatabase ?? ""}
          onChange={(e) => setActiveDatabase(e.target.value)}
        >
          <option value="">
            {databases.length === 0 ? "No databases" : "Select database"}
          </option>
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1" />

      <button
        className="btn px-2 py-1"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onClick={toggleTheme}
      >
        {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <ShareExportButtons />

      <button
        className="btn btn-primary"
        disabled={!canRun}
        onClick={() => void runActiveQuery()}
        title="Run query (⌘/Ctrl+Enter)"
      >
        <Play size={14} />
        {running ? "Running…" : "Run"}
      </button>

      <AddConnectionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
