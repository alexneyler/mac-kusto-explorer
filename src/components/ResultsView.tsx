import {
  type ColumnDef,
  type SortingState,
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
  Loader2,
  Table2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { formatCell } from "../lib/cell";
import { formatDuration } from "../lib/utils";
import { useAppStore } from "../store/appStore";
import { errorMessage, isAppError } from "../types/kusto";
import { ChartView } from "./ChartView";

type Row = unknown[];
type ResultView = "table" | "chart";

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

  return <ResultsPanel result={result} />;
}

function ResultsPanel({
  result,
}: {
  result: NonNullable<ReturnType<typeof useAppStore.getState>["result"]>;
}) {
  const [view, setView] = useState<ResultView>("table");

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {view === "table" ? (
          <ResultsGrid result={result} />
        ) : (
          <ChartView result={result} />
        )}
      </div>
      <ResultsStatusBar
        rowCount={result.row_count}
        columnCount={result.columns.length}
        elapsedMs={result.elapsed_ms}
        view={view}
        onViewChange={setView}
      />
    </div>
  );
}

function ResultsGrid({
  result,
}: {
  result: NonNullable<ReturnType<typeof useAppStore.getState>["result"]>;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const parentRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((col, i) => ({
        id: `${i}-${col.name}`,
        header: col.name,
        accessorFn: (row) => row[i],
        meta: { type: col.type },
        sortingFn: "auto",
      })),
    [result.columns],
  );

  const table = useReactTable({
    data: result.rows as Row[],
    columns,
    state: { sorting },
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

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-elevated)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                <th className="w-10 border-b border-[var(--color-border)] px-2 py-1.5 text-right font-normal text-[var(--color-text-faint)]">
                  #
                </th>
                {hg.headers.map((header) => {
                  const type = (header.column.columnDef.meta as { type?: string })
                    ?.type;
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className="cursor-pointer select-none border-b border-r border-[var(--color-border)] px-2 py-1.5 text-left font-semibold hover:bg-[var(--color-bg-hover)]"
                    >
                      <div className="flex items-center gap-1">
                        <span className="truncate">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </span>
                        {type && (
                          <span className="text-[10px] font-normal text-[var(--color-text-faint)]">
                            {type}
                          </span>
                        )}
                        {sorted === "asc" && <ArrowUp size={11} />}
                        {sorted === "desc" && <ArrowDown size={11} />}
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
                  className="hover:bg-[var(--color-bg-hover)]"
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className="border-b border-[var(--color-border)] px-2 text-right align-middle text-[var(--color-text-faint)]">
                    {vr.index + 1}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const display = formatCell(cell.getValue());
                    return (
                      <td
                        key={cell.id}
                        className={`max-w-[420px] truncate border-b border-r border-[var(--color-border)] px-2 align-middle ${
                          display.numeric ? "text-right tabular-nums" : ""
                        } ${
                          display.isNull ? "italic text-[var(--color-text-faint)]" : ""
                        } ${display.dynamic ? "font-[var(--font-mono)]" : ""}`}
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
  );
}

function ResultsStatusBar({
  rowCount,
  columnCount,
  elapsedMs,
  view,
  onViewChange,
}: {
  rowCount: number;
  columnCount: number;
  elapsedMs: number;
  view: ResultView;
  onViewChange: (view: ResultView) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-1 text-[11px] text-[var(--color-text-muted)]">
      <ViewToggle view={view} onViewChange={onViewChange} />
      <span>
        {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
      </span>
      <span>
        {columnCount} {columnCount === 1 ? "column" : "columns"}
      </span>
      <span className="ml-auto" title="Query execution time">
        {formatDuration(elapsedMs)}
      </span>
    </div>
  );
}

function ViewToggle({
  view,
  onViewChange,
}: {
  view: ResultView;
  onViewChange: (view: ResultView) => void;
}) {
  const base =
    "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors";
  const active = "bg-[var(--color-bg-active)] text-[var(--color-text)]";
  const inactive = "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]";
  return (
    <div
      role="group"
      aria-label="Result view"
      className="flex items-center gap-0.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-0.5"
    >
      <button
        type="button"
        aria-pressed={view === "table"}
        onClick={() => onViewChange("table")}
        className={`${base} ${view === "table" ? active : inactive}`}
        title="Table view"
      >
        <Table2 size={12} />
        Table
      </button>
      <button
        type="button"
        aria-pressed={view === "chart"}
        onClick={() => onViewChange("chart")}
        className={`${base} ${view === "chart" ? active : inactive}`}
        title="Chart view"
      >
        <BarChart3 size={12} />
        Chart
      </button>
    </div>
  );
}

function StatusFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">{children}</div>
  );
}
