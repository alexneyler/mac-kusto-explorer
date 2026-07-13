import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Database,
  Folder,
  FunctionSquare,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Table2,
  X,
} from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  connectionHasDescendantMatch,
  connectionVisible,
  countMatches,
  databaseHasDescendantMatch,
  databaseVisible,
  highlightSegments,
  isFiltering,
  type SchemaLookup,
  tableSelfMatches,
  visibleColumns,
  visibleExternalTables,
  visibleFunctions,
  visibleMaterializedViews,
  visibleTables,
} from "../lib/schemaSearch";
import {
  groupByFolder,
  type FolderEntity,
  type SchemaFolder,
} from "../lib/schemaFolders";
import { schemaKey, useAppStore } from "../store/appStore";
import type {
  Connection,
  FunctionSchema,
  TableSchema,
} from "../types/kusto";

/** Render a label with the query's matching substrings highlighted. */
function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded-sm bg-[var(--color-bg-active)] font-semibold text-[var(--color-accent)]"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** A single indented tree row with an optional expand chevron. */
function TreeRow({
  depth,
  expandable,
  expanded,
  icon,
  label,
  highlightQuery,
  hint,
  inlineHint = true,
  active,
  actions,
  onClick,
  onDoubleClick,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  icon: ReactNode;
  label: string;
  highlightQuery?: string;
  hint?: string;
  inlineHint?: boolean;
  active?: boolean;
  actions?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const showHoverHint = Boolean(hint && !inlineHint);

  function showTooltip(target: HTMLElement) {
    const bounds = target.getBoundingClientRect();
    setTooltipPosition({ left: bounds.right + 8, top: bounds.top - 4 });
  }

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
        aria-selected={active}
        className={`group flex cursor-pointer select-none items-center gap-1 py-[3px] pr-2 text-xs hover:bg-[var(--color-bg-hover)] ${
          active ? "bg-[var(--color-bg-active)]" : ""
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title={inlineHint ? hint : undefined}
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
        <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
          {highlightQuery ? (
            <HighlightedLabel text={label} query={highlightQuery} />
          ) : (
            label
          )}
        </span>
        {inlineHint && hint && (
          <span className="truncate pl-2 text-[10px] text-[var(--color-text-faint)]">
            {hint}
          </span>
        )}
        {showHoverHint && (
          <button
            type="button"
            aria-label={`${label} description`}
            className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] focus:text-[var(--color-text)] focus:outline-none"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseEnter={(event) => showTooltip(event.currentTarget)}
            onMouseLeave={() => setTooltipPosition(null)}
            onFocus={(event) => showTooltip(event.currentTarget)}
            onBlur={() => setTooltipPosition(null)}
          >
            <Info size={12} />
          </button>
        )}
        {actions && <span className="flex shrink-0 items-center">{actions}</span>}
      </div>
      {tooltipPosition &&
        hint &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] max-w-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-xs leading-relaxed text-[var(--color-text)] shadow-lg"
            style={tooltipPosition}
          >
            {hint}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Small inline "force reload" button used on connection/database rows. */
function RefreshButton({
  label,
  onRefresh,
}: {
  label: string;
  onRefresh: () => void;
}) {
  function handleClick(e: MouseEvent) {
    // Never toggle expand / change selection when refreshing.
    e.stopPropagation();
    onRefresh();
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className="ml-1 flex h-4 w-4 items-center justify-center rounded text-[var(--color-text-faint)] opacity-0 hover:text-[var(--color-text)] group-hover:opacity-100 focus:opacity-100"
    >
      <RefreshCw size={12} />
    </button>
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
  filter,
}: {
  table: TableSchema;
  depth: number;
  filter: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const appendToQuery = useAppStore((s) => s.appendToQuery);

  const filtering = isFiltering(filter);
  const columns = visibleColumns(table, filter);
  // While filtering, auto-expand only when a *column* matches (a name-only
  // match keeps the row visible without forcing its columns open).
  const descendantMatch =
    filtering && !tableSelfMatches(table, filter) && columns.length > 0;
  const showColumns = filtering ? descendantMatch : expanded;

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable
        expanded={showColumns}
        icon={<Table2 size={13} className="text-[var(--color-accent)]" />}
        label={table.name}
        highlightQuery={filter}
        hint={table.docString ?? undefined}
        inlineHint={false}
        onClick={() => setExpanded((v) => !v)}
        onDoubleClick={() => appendToQuery(table.name)}
      />
      {showColumns &&
        columns.map((col) => (
          <TreeRow
            key={col.name}
            depth={depth + 1}
            icon={<Columns3 size={12} className="text-[var(--color-text-faint)]" />}
            label={col.name}
            highlightQuery={filter}
            hint={col.type}
          />
        ))}
    </div>
  );
}

function FunctionNode({
  fn,
  depth,
  filter,
}: {
  fn: FunctionSchema;
  depth: number;
  filter: string;
}) {
  return (
    <TreeRow
      depth={depth}
      icon={
        <FunctionSquare size={13} className="text-[var(--color-warning)]" />
      }
      label={fn.name}
      highlightQuery={filter}
      hint={fn.docString ?? undefined}
      inlineHint={false}
    />
  );
}

function SchemaFolderNode<T extends FolderEntity>({
  folder,
  depth,
  filter,
  renderEntity,
}: {
  folder: SchemaFolder<T>;
  depth: number;
  filter: string;
  renderEntity: (entity: T, depth: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const showChildren = isFiltering(filter) || expanded;

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable
        expanded={showChildren}
        icon={<Folder size={13} className="text-[var(--color-text-muted)]" />}
        label={folder.name}
        highlightQuery={filter}
        onClick={() => setExpanded((value) => !value)}
      />
      {showChildren && (
        <div role="group">
          {folder.folders.map((child) => (
            <SchemaFolderNode
              key={child.path}
              folder={child}
              depth={depth + 1}
              filter={filter}
              renderEntity={renderEntity}
            />
          ))}
          {folder.entities.map((entity) => renderEntity(entity, depth + 1))}
        </div>
      )}
    </div>
  );
}

function EntityCategoryNode<T extends FolderEntity>({
  label,
  entities,
  depth,
  filter,
  renderEntity,
}: {
  label: string;
  entities: T[];
  depth: number;
  filter: string;
  renderEntity: (entity: T, depth: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const filtering = isFiltering(filter);
  const showChildren = filtering ? entities.length > 0 : expanded;
  const grouped = groupByFolder(entities);

  if (filtering && entities.length === 0) return null;

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable={entities.length > 0}
        expanded={showChildren}
        icon={<Folder size={13} className="text-[var(--color-accent)]" />}
        label={label}
        onClick={() => setExpanded((value) => !value)}
      />
      {showChildren && (
        <div role="group">
          {grouped.folders.map((folder) => (
            <SchemaFolderNode
              key={folder.path}
              folder={folder}
              depth={depth + 1}
              filter={filter}
              renderEntity={renderEntity}
            />
          ))}
          {grouped.entities.map((entity) => renderEntity(entity, depth + 1))}
        </div>
      )}
    </div>
  );
}

function DatabaseNode({
  conn,
  database,
  depth,
  filter,
}: {
  conn: Connection;
  database: string;
  depth: number;
  filter: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeDatabase = useAppStore((s) => s.activeDatabase);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveDatabase = useAppStore((s) => s.setActiveDatabase);
  const loadSchema = useAppStore((s) => s.loadSchema);
  const refreshSchema = useAppStore((s) => s.refreshSchema);
  const schema = useAppStore((s) => s.schemaByKey[schemaKey(conn.id, database)]);
  const loading = useAppStore(
    (s) => s.loadingSchemaByKey[schemaKey(conn.id, database)],
  );

  const isActive = activeConnectionId === conn.id && activeDatabase === database;

  const filtering = isFiltering(filter);
  // Filtering never triggers new loads: it only auto-expands databases whose
  // already-loaded schema contains a match.
  const descendantMatch = databaseHasDescendantMatch(schema, filter);
  const showChildren = filtering ? descendantMatch : expanded;

  // Lazily fetch the schema whenever this node is expanded by the user and we
  // don't have it. Filter-driven expansion deliberately does not load.
  useEffect(() => {
    if (expanded && !schema && !loading) {
      void loadSchema(conn.id, database);
    }
  }, [expanded, schema, loading, loadSchema, conn.id, database]);

  function handleClick() {
    setExpanded((v) => !v);
    setActiveDatabase(database);
  }

  const tables = schema ? visibleTables(schema, filter) : [];
  const materializedViews = schema
    ? visibleMaterializedViews(schema, filter)
    : [];
  const externalTables = schema ? visibleExternalTables(schema, filter) : [];
  const functions = schema ? visibleFunctions(schema, filter) : [];

  return (
    <div role="group">
      <TreeRow
        depth={depth}
        expandable
        expanded={showChildren}
        active={isActive}
        icon={<Database size={13} className="text-[var(--color-success)]" />}
        label={database}
        highlightQuery={filter}
        actions={
          <RefreshButton
            label={`Refresh ${database} schema`}
            onRefresh={() => void refreshSchema(conn.id, database)}
          />
        }
        onClick={handleClick}
      />
      {showChildren && (
        <div role="group">
          {loading && !schema && (
            <div
              className="flex items-center gap-1.5 py-1 text-[11px] text-[var(--color-text-faint)]"
              style={{ paddingLeft: 6 + (depth + 1) * 14 }}
            >
              <Spinner /> Loading schema…
            </div>
          )}
          {schema && (
            <>
              <EntityCategoryNode
                label="Functions"
                entities={functions}
                depth={depth + 1}
                filter={filter}
                renderEntity={(fn, entityDepth) => (
                  <FunctionNode
                    key={fn.name}
                    fn={fn}
                    depth={entityDepth}
                    filter={filter}
                  />
                )}
              />
              <EntityCategoryNode
                label="Materialized views"
                entities={materializedViews}
                depth={depth + 1}
                filter={filter}
                renderEntity={(view, entityDepth) => (
                  <TableNode
                    key={view.name}
                    table={view}
                    depth={entityDepth}
                    filter={filter}
                  />
                )}
              />
              <EntityCategoryNode
                label="Tables"
                entities={tables}
                depth={depth + 1}
                filter={filter}
                renderEntity={(table, entityDepth) => (
                  <TableNode
                    key={table.name}
                    table={table}
                    depth={entityDepth}
                    filter={filter}
                  />
                )}
              />
              <EntityCategoryNode
                label="External tables"
                entities={externalTables}
                depth={depth + 1}
                filter={filter}
                renderEntity={(table, entityDepth) => (
                  <TableNode
                    key={table.name}
                    table={table}
                    depth={entityDepth}
                    filter={filter}
                  />
                )}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionNode({ conn, filter }: { conn: Connection; filter: string }) {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveConnection = useAppStore((s) => s.setActiveConnection);
  const loadDatabases = useAppStore((s) => s.loadDatabases);
  const refreshDatabases = useAppStore((s) => s.refreshDatabases);
  const databases = useAppStore((s) => s.databasesByConn[conn.id]);
  const schemaByKey = useAppStore((s) => s.schemaByKey);
  const loading = useAppStore((s) => s.loadingDbByConn[conn.id]);
  const [expanded, setExpanded] = useState(activeConnectionId === conn.id);

  const lookup: SchemaLookup = (db) => schemaByKey[schemaKey(conn.id, db)];
  const filtering = isFiltering(filter);
  const descendantMatch = connectionHasDescendantMatch(
    databases,
    lookup,
    filter,
  );
  const showChildren = filtering ? descendantMatch : expanded;

  // Lazily fetch databases whenever this node is expanded by the user and we
  // don't have them yet. This covers startup (the persisted-active node starts
  // expanded) and expanding any non-active connection. Filter-driven expansion
  // deliberately does not load.
  useEffect(() => {
    if (expanded && !databases && !loading) {
      void loadDatabases(conn.id);
    }
  }, [expanded, databases, loading, loadDatabases, conn.id]);

  function handleClick() {
    setExpanded((v) => !v);
    // Selecting is independent of expand: setActiveConnection early-returns
    // when already active, but the effect above still handles loading.
    setActiveConnection(conn.id);
  }

  const visibleDatabases = filtering
    ? (databases ?? []).filter((db) => databaseVisible(db, lookup(db), filter))
    : databases;

  return (
    <div role="group">
      <TreeRow
        depth={0}
        expandable
        expanded={showChildren}
        active={activeConnectionId === conn.id}
        icon={<Server size={13} className="text-[var(--color-accent)]" />}
        label={conn.name}
        highlightQuery={filter}
        hint={conn.tenant ? "tenant" : undefined}
        actions={
          <RefreshButton
            label={`Refresh ${conn.name} databases`}
            onRefresh={() => void refreshDatabases(conn.id)}
          />
        }
        onClick={handleClick}
      />
      {showChildren && (
        <div role="group">
          {loading && !databases && (
            <div className="flex items-center gap-1.5 py-1 pl-8 text-[11px] text-[var(--color-text-faint)]">
              <Spinner /> Loading databases…
            </div>
          )}
          {visibleDatabases?.map((db) => (
            <DatabaseNode
              key={db}
              conn={conn}
              database={db}
              depth={1}
              filter={filter}
            />
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

/** Search box that filters the schema tree by name. */
function SchemaSearch({
  value,
  onChange,
  matchCount,
  inputRef,
}: {
  value: string;
  onChange: (next: string) => void;
  matchCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const filtering = isFiltering(value);
  return (
    <div className="border-b border-[var(--color-border)] px-2 py-1.5">
      <div className="relative flex items-center">
        <Search
          size={12}
          className="pointer-events-none absolute left-2 text-[var(--color-text-faint)]"
        />
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          aria-label="Filter schema"
          placeholder="Filter tables, columns, functions…"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value !== "") {
              e.preventDefault();
              onChange("");
            }
          }}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] py-1 pl-6 pr-6 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="Clear filter"
            title="Clear filter (Esc)"
            onClick={() => onChange("")}
            className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {filtering && (
        <div className="px-1 pt-1 text-[10px] text-[var(--color-text-faint)]">
          {matchCount === 0
            ? "No matching entities"
            : `${matchCount} ${matchCount === 1 ? "match" : "matches"}`}
        </div>
      )}
    </div>
  );
}

export function ConnectionsSidebar() {
  const connections = useAppStore((s) => s.connections);
  const databasesByConn = useAppStore((s) => s.databasesByConn);
  const schemaByKey = useAppStore((s) => s.schemaByKey);
  const [filter, setFilter] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Ctrl+F / ⌘+F focuses the schema filter (scoped to the app window).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (!searchRef.current) return;
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtering = isFiltering(filter);
  const lookupFor =
    (connId: string): SchemaLookup =>
    (db) =>
      schemaByKey[schemaKey(connId, db)];
  const visibleConnections = filtering
    ? connections.filter((c) =>
        connectionVisible(c, databasesByConn[c.id], lookupFor(c.id), filter),
      )
    : connections;
  const matchCount = filtering
    ? countMatches(
        connections.map((c) => ({
          databases: databasesByConn[c.id],
          lookup: lookupFor(c.id),
        })),
        filter,
      )
    : 0;

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Connections
      </div>
      {connections.length > 0 && (
        <SchemaSearch
          value={filter}
          onChange={setFilter}
          matchCount={matchCount}
          inputRef={searchRef}
        />
      )}
      <div role="tree" className="flex-1 overflow-auto py-1">
        {connections.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-text-faint)]">
            No connections yet. Use the{" "}
            <span className="text-[var(--color-text-muted)]">+</span> button in
            the toolbar to add a cluster.
          </div>
        ) : filtering && visibleConnections.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-text-faint)]">
            No matching entities.
          </div>
        ) : (
          visibleConnections.map((c) => (
            <ConnectionNode key={c.id} conn={c} filter={filter} />
          ))
        )}
      </div>
    </div>
  );
}
