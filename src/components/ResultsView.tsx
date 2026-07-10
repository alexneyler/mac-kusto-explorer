import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  EyeOff,
  Loader2,
  WrapText,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { formatCell } from "../lib/cell";
import { columnDistribution, emptyColumnIndexes } from "../lib/columnStats";
import { cn, formatDuration } from "../lib/utils";
import { useAppStore } from "../store/appStore";
import { errorMessage, isAppError } from "../types/kusto";

type Row = unknown[];
type Result = NonNullable<ReturnType<typeof useAppStore.getState>["result"]>;

const ROW_HEIGHT = 28;

export function ResultsView() {
  const result = useAppStore((s) => s.result);
  const running = useAppStore((s) => s.running);
  const error = useAppStore((s) => s.error);

  if (running) {
    return (
      <StatusFrame>
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Running query…
        </div>
      </StatusFrame>
    );
  }

  if (error) {
    const kind = isAppError(error) ? error.kind : "error";
    return (
      <div className="flex h-full flex-col">
        <div className="m-3 flex items-start gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-[var(--color-danger)]"
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-danger)]">
              {kind} error
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words font-[var(--font-mono)] text-xs text-[var(--color-text)]">
              {errorMessage(error)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <StatusFrame>
        <p className="text-sm text-[var(--color-text-faint)]">
          Run a query to see results here.
        </p>
      </StatusFrame>
    );
  }

  return <ResultsGrid result={result} />;
}

function ResultsGrid({ result }: { result: Result }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [wrap, setWrap] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const emptyCols = useMemo(
    () => new Set(emptyColumnIndexes(result)),
    [result],
  );

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((col, i) => ({
        id: `${i}-${col.name}`,
        header: col.name,
        accessorFn: (row) => row[i],
        meta: { type: col.type, index: i },
        sortingFn: "auto",
      })),
    [result.columns],
  );

  const columnVisibility = useMemo<VisibilityState>(() => {
    if (!hideEmpty) return {};
    const vis: VisibilityState = {};
    result.columns.forEach((col, i) => {
      if (emptyCols.has(i)) vis[`${i}-${col.name}`] = false;
    });
    return vis;
  }, [hideEmpty, emptyCols, result.columns]);

  const table = useReactTable({
    data: result.rows as Row[],
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  // Wrapping changes row heights; re-measure so the virtualizer's offsets stay
  // accurate when the toggle flips.
  useEffect(() => {
    virtualizer.measure();
  }, [wrap, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={parentRef} className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-elevated)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                <th className="w-10 border-b border-[var(--color-border)] px-2 py-1.5 text-right font-normal text-[var(--color-text-faint)]">
                  #
                </th>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as {
                    type?: string;
                    index: number;
                  };
                  const sorted = header.column.getIsSorted();
                  const name = String(header.column.columnDef.header);
                  return (
                    <th
                      key={header.id}
                      className="select-none border-b border-r border-[var(--color-border)] px-2 py-1.5 text-left font-semibold"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded text-left hover:text-[var(--color-accent)]"
                        >
                          <span className="truncate">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                          {meta.type && (
                            <span className="text-[10px] font-normal text-[var(--color-text-faint)]">
                              {meta.type}
                            </span>
                          )}
                          {sorted === "asc" && <ArrowUp size={11} />}
                          {sorted === "desc" && <ArrowDown size={11} />}
                        </button>
                        <ColumnMenu
                          result={result}
                          columnIndex={meta.index}
                          name={name}
                        />
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualRows.map((vr) => {
              const row = rows[vr.index];
              return (
                <tr
                  key={row.id}
                  data-index={vr.index}
                  ref={wrap ? virtualizer.measureElement : undefined}
                  className="hover:bg-[var(--color-bg-hover)]"
                  style={wrap ? undefined : { height: ROW_HEIGHT }}
                >
                  <td
                    className={cn(
                      "border-b border-[var(--color-border)] px-2 text-right text-[var(--color-text-faint)]",
                      wrap ? "align-top" : "align-middle",
                    )}
                  >
                    {vr.index + 1}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const display = formatCell(cell.getValue());
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "max-w-[420px] border-b border-r border-[var(--color-border)] px-2",
                          wrap
                            ? "whitespace-pre-wrap break-words align-top"
                            : "truncate align-middle",
                          display.numeric && "text-right tabular-nums",
                          display.isNull &&
                            "italic text-[var(--color-text-faint)]",
                          display.dynamic && "font-[var(--font-mono)]",
                        )}
                        title={display.text}
                      >
                        {display.text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ResultsStatusBar
        rowCount={result.row_count}
        columnCount={table.getVisibleLeafColumns().length}
        elapsedMs={result.elapsed_ms}
        tools={
          <>
            <Toggle
              active={hideEmpty}
              disabled={emptyCols.size === 0}
              onClick={() => setHideEmpty((v) => !v)}
              icon={<EyeOff size={12} />}
              label="Hide empty columns"
            />
            <Toggle
              active={wrap}
              onClick={() => setWrap((v) => !v)}
              icon={<WrapText size={12} />}
              label="Wrap text"
            />
          </>
        }
      />
    </div>
  );
}

function Toggle({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ColumnMenu({
  result,
  columnIndex,
  name,
}: {
  result: Result;
  columnIndex: number;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={`Explore values in ${name}`}
          aria-label={`Explore values in ${name}`}
          className="shrink-0 rounded p-0.5 text-[var(--color-text-faint)] outline-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)] data-[state=open]:bg-[var(--color-bg-hover)] data-[state=open]:text-[var(--color-accent)]"
        >
          <BarChart3 size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-3 text-[var(--color-text)] shadow-xl"
        >
          {open && (
            <ColumnDistributionPanel
              result={result}
              columnIndex={columnIndex}
              name={name}
            />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ColumnDistributionPanel({
  result,
  columnIndex,
  name,
}: {
  result: Result;
  columnIndex: number;
  name: string;
}) {
  const dist = useMemo(
    () => columnDistribution(result, columnIndex, 10),
    [result, columnIndex],
  );
  const maxCount = dist.top[0]?.count ?? 0;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold" title={name}>
          {name}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-text-faint)]">
          {dist.distinctCount} distinct
        </span>
      </div>
      <div className="mb-2 flex gap-3 text-[10px] text-[var(--color-text-muted)]">
        <span>
          {dist.total} {dist.total === 1 ? "row" : "rows"}
        </span>
        <span>{dist.nullCount} null</span>
      </div>
      {dist.top.length === 0 ? (
        <div className="text-[11px] text-[var(--color-text-faint)]">
          No values.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {dist.top.map((bucket) => (
            <li key={bucket.value} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={bucket.value}>
                  {bucket.value}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
                  {bucket.count.toLocaleString()} · {bucket.percent.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded bg-[var(--color-bg-hover)]">
                <div
                  className="h-full rounded bg-[var(--color-accent)]"
                  style={{
                    width: `${maxCount > 0 ? (bucket.count / maxCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultsStatusBar({
  rowCount,
  columnCount,
  elapsedMs,
  tools,
}: {
  rowCount: number;
  columnCount: number;
  elapsedMs: number;
  tools?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-1 text-[11px] text-[var(--color-text-muted)]">
      <span>
        {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
      </span>
      <span>
        {columnCount} {columnCount === 1 ? "column" : "columns"}
      </span>
      {tools && <div className="flex items-center gap-1">{tools}</div>}
      <span className="ml-auto" title="Query execution time">
        {formatDuration(elapsedMs)}
      </span>
    </div>
  );
}

function StatusFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">{children}</div>
  );
}
