import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Database,
  FunctionSquare,
  Loader2,
  Server,
  Table2,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { schemaKey, useAppStore } from "../store/appStore";
import type { Connection, TableSchema } from "../types/kusto";

/** A single indented tree row with an optional expand chevron. */
function TreeRow({
  depth,
  expandable,
  expanded,
  icon,
  label,
  hint,
  active,
  onClick,
  onDoubleClick,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  icon: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={active}
      className={`flex cursor-pointer select-none items-center gap-1 py-[3px] pr-2 text-xs hover:bg-[var(--color-bg-hover)] ${
        active ? "bg-[var(--color-bg-active)]" : ""
      }`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={hint}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--color-text-faint)]">
        {expandable ? (
          expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )
        ) : null}
      </span>
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className="truncate text-[var(--color-text)]">{label}</span>
      {hint && (
        <span className="ml-auto truncate pl-2 text-[10px] text-[var(--color-text-faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <Loader2
      size={13}
      className="animate-spin text-[var(--color-text-faint)]"
    />
  );
}

function TableNode({
  table,
  depth,
}: {
  table: TableSchema;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const appendToQuery = useAppStore((s) => s.appendToQuery);

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable
        expanded={expanded}
        icon={<Table2 size={13} className="text-[var(--color-accent)]" />}
        label={table.name}
        hint={table.folder ?? undefined}
        onClick={() => setExpanded((v) => !v)}
        onDoubleClick={() => appendToQuery(table.name)}
      />
      {expanded &&
        table.columns.map((col) => (
          <TreeRow
            key={col.name}
            depth={depth + 1}
            icon={<Columns3 size={12} className="text-[var(--color-text-faint)]" />}
            label={col.name}
            hint={col.type}
          />
        ))}
    </div>
  );
}

function DatabaseNode({
  conn,
  database,
  depth,
}: {
  conn: Connection;
  database: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeDatabase = useAppStore((s) => s.activeDatabase);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase);
  const schema = useAppStore((s) => s.schemaByKey[schemaKey(conn.id, database)]);
  const loading = useAppStore(
    (s) => s.loadingSchemaByKey[schemaKey(conn.id, database)],
  );

  const isActive = activeConnectionId === conn.id && activeDatabase === database;

  function handleClick() {
    setExpanded((v) => !v);
    setActiveDatabase(database);
  }

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable
        expanded={expanded}
        active={isActive}
        icon={<Database size={13} className="text-[var(--color-success)]" />}
        label={database}
        onClick={handleClick}
      />
      {expanded && (
        <div role="group">
          {loading && !schema && (
            <div
              className="flex items-center gap-1.5 py-1 text-[11px] text-[var(--color-text-faint)]"
              style={{ paddingLeft: 6 + (depth + 1) * 14 }}
            >
              <Spinner /> Loading schema…
            </div>
          )}
          {schema?.tables.map((t) => (
            <TableNode key={t.name} table={t} depth={depth + 1} />
          ))}
          {schema && schema.functions.length > 0 && (
            <>
              {schema.functions.map((fn) => (
                <TreeRow
                  key={fn.name}
                  depth={depth + 1}
                  icon={
                    <FunctionSquare
                      size={13}
                      className="text-[var(--color-warning)]"
                    />
                  }
                  label={fn.name}
                  hint={fn.folder ?? undefined}
                />
              ))}
            </>
          )}
          {schema &&
            schema.tables.length === 0 &&
            schema.functions.length === 0 && (
              <div
                className="py-1 text-[11px] text-[var(--color-text-faint)]"
                style={{ paddingLeft: 6 + (depth + 1) * 14 }}
              >
                Empty database
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function ConnectionNode({ conn }: { conn: Connection }) {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveConnection = useAppStore((s) => s.setActiveConnection);
  const databases = useAppStore((s) => s.databasesByConn[conn.id]);
  const loading = useAppStore((s) => s.loadingDbByConn[conn.id]);
  const [expanded, setExpanded] = useState(activeConnectionId === conn.id);

  function handleClick() {
    setExpanded((v) => !v);
    setActiveConnection(conn.id);
  }

  return (
    <div role="group">
      <TreeRow
        depth={0}
        expandable
        expanded={expanded}
        active={activeConnectionId === conn.id}
        icon={<Server size={13} className="text-[var(--color-accent)]" />}
        label={conn.name}
        hint={conn.tenant ? "tenant" : undefined}
        onClick={handleClick}
      />
      {expanded && (
        <div role="group">
          {loading && !databases && (
            <div className="flex items-center gap-1.5 py-1 pl-8 text-[11px] text-[var(--color-text-faint)]">
              <Spinner /> Loading databases…
            </div>
          )}
          {databases?.map((db) => (
            <DatabaseNode key={db} conn={conn} database={db} depth={1} />
          ))}
          {databases && databases.length === 0 && (
            <div className="py-1 pl-8 text-[11px] text-[var(--color-text-faint)]">
              No databases
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectionsSidebar() {
  const connections = useAppStore((s) => s.connections);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Connections
      </div>
      <div role="tree" className="flex-1 overflow-auto py-1">
        {connections.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-text-faint)]">
            No connections yet. Use the{" "}
            <span className="text-[var(--color-text-muted)]">+</span> button in
            the toolbar to add a cluster.
          </div>
        ) : (
          connections.map((c) => <ConnectionNode key={c.id} conn={c} />)
        )}
      </div>
    </div>
  );
}
