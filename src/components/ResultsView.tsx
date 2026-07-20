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
  Table2,
  WrapText,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { buildInitialAgentContext } from "../lib/agent/context";
import { copyShare, exportResult } from "../lib/actions";
import {
  cellJson,
  formatCell,
  kustoLiteral,
  rowAsJson,
  rowAsMarkdown,
  rowAsTsv,
} from "../lib/cell";
import { copyText, quoteKustoIdentifier } from "../lib/clipboard";
import { isNumericType } from "../lib/chart";
import { columnDistribution, emptyColumnIndexes } from "../lib/columnStats";
import { cn, formatDuration } from "../lib/utils";
import { useAgentStore } from "../store/agentStore";
import { useAppStore } from "../store/appStore";
import { useContextStore } from "../store/contextStore";
import { errorMessage, isAppError } from "../types/kusto";
import { ChartView } from "./ChartView";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";
import { Modal } from "./ui/Modal";

type Row = unknown[];
type ResultView = "table" | "chart";
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
    const message = errorMessage(error);
    const agent = useAgentStore.getState();
    return (
      <div className="flex h-full flex-col">
        <ContextMenu
          content={
            <>
              <ContextMenuItem
                onSelect={() => void copyText(message, "Error")}
              >
                Copy error
              </ContextMenuItem>
              <ContextMenuItem
                disabled={useAppStore.getState().running}
                onSelect={() => void useAppStore.getState().runActiveQuery()}
              >
                Retry query
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!agent.isAuthenticated || agent.sending}
                onSelect={() => diagnoseError(message)}
              >
                Ask Agent to diagnose
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => useAppStore.getState().clearError()}
              >
                Clear error
              </ContextMenuItem>
            </>
          }
        >
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
                {message}
              </div>
            </div>
          </div>
        </ContextMenu>
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
  const [hideEmpty, setHideEmpty] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(new Set());
  const [chartFocus, setChartFocus] = useState<{
    key: number;
    xIndex?: number;
    seriesIndex?: number;
  } | null>(null);

  const emptyCols = useMemo(
    () => new Set(emptyColumnIndexes(result)),
    [result],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {view === "table" ? (
          <ResultsGrid
            result={result}
            hideEmpty={hideEmpty}
            wrap={wrap}
            emptyCols={emptyCols}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
            onHideEmptyChange={setHideEmpty}
            onWrapChange={setWrap}
            onSwitchToChart={() => setView("chart")}
            onUseAsChartAxis={(index) => {
              setChartFocus({ key: Date.now(), xIndex: index });
              setView("chart");
            }}
            onUseAsChartSeries={(index) => {
              setChartFocus({ key: Date.now(), seriesIndex: index });
              setView("chart");
            }}
          />
        ) : (
          <ChartView result={result} focus={chartFocus} />
        )}
      </div>
      <ResultsStatusBar
        rowCount={result.row_count}
        columnCount={
          view === "table" && hideEmpty
            ? result.columns.filter(
                (_, index) =>
                  !emptyCols.has(index) && !hiddenColumns.has(index),
              ).length
            : result.columns.filter((_, index) => !hiddenColumns.has(index))
                .length
        }
        elapsedMs={result.elapsed_ms}
        view={view}
        onViewChange={setView}
        tools={
          view === "table" ? (
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
          ) : undefined
        }
      />
    </div>
  );
}

function ResultsGrid({
  result,
  hideEmpty,
  wrap,
  emptyCols,
  hiddenColumns,
  onHiddenColumnsChange,
  onHideEmptyChange,
  onWrapChange,
  onSwitchToChart,
  onUseAsChartAxis,
  onUseAsChartSeries,
}: {
  result: Result;
  hideEmpty: boolean;
  wrap: boolean;
  emptyCols: Set<number>;
  hiddenColumns: Set<number>;
  onHiddenColumnsChange: (columns: Set<number>) => void;
  onHideEmptyChange: (hide: boolean) => void;
  onWrapChange: (wrap: boolean) => void;
  onSwitchToChart: () => void;
  onUseAsChartAxis: (index: number) => void;
  onUseAsChartSeries: (index: number) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [exploreColumn, setExploreColumn] = useState<number | null>(null);
  const [inspectedCell, setInspectedCell] = useState<{
    title: string;
    value: string;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const appendToQuery = useAppStore((state) => state.appendToQuery);
  const openQueryTab = useAppStore((state) => state.openQueryTab);

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
    const vis: VisibilityState = {};
    result.columns.forEach((col, i) => {
      if (hiddenColumns.has(i) || (hideEmpty && emptyCols.has(i))) {
        vis[`${i}-${col.name}`] = false;
      }
    });
    return vis;
  }, [hideEmpty, emptyCols, hiddenColumns, result.columns]);

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

  const gridMenu = (
    <>
      <ContextMenuItem onSelect={() => void copyShare("results")}>
        Copy all as Markdown
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyShare("tsv")}>
        Copy all as TSV
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyShare("json")}>
        Copy all as JSON
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyShare("datatable")}>
        Copy all as datatable()
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void exportResult("csv")}>
        Export as CSV
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void exportResult("tsv")}>
        Export as TSV
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void exportResult("json")}>
        Export as JSON
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={emptyCols.size === 0}
        onSelect={() => onHideEmptyChange(!hideEmpty)}
      >
        {hideEmpty ? "Show empty columns" : "Hide empty columns"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onWrapChange(!wrap)}>
        {wrap ? "Disable text wrapping" : "Wrap text"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={onSwitchToChart}>
        Switch to chart
      </ContextMenuItem>
    </>
  );

  const grid = (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-elevated)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                <ContextMenu content={gridMenu}>
                  <th className="w-10 border-b border-[var(--color-border)] px-2 py-1.5 text-right font-normal text-[var(--color-text-faint)]">
                    #
                  </th>
                </ContextMenu>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as {
                    type?: string;
                    index: number;
                  };
                  const sorted = header.column.getIsSorted();
                  const name = String(header.column.columnDef.header);
                  return (
                    <ContextMenu
                      key={header.id}
                      content={
                        <>
                          <ContextMenuItem
                            onSelect={() => header.column.toggleSorting(false)}
                          >
                            Sort ascending
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => header.column.toggleSorting(true)}
                          >
                            Sort descending
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={!sorted}
                            onSelect={() => header.column.clearSorting()}
                          >
                            Clear sort
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => void copyText(name, "Column name")}
                          >
                            Copy column name
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() =>
                              void copyText(
                                result.rows
                                  .map((row) => formatCell(row[meta.index]).text)
                                  .join("\n"),
                                "Column values",
                              )
                            }
                          >
                            Copy column values
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() =>
                              onHiddenColumnsChange(
                                new Set([...hiddenColumns, meta.index]),
                              )
                            }
                          >
                            Hide column
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() =>
                              onHiddenColumnsChange(
                                new Set(
                                  result.columns
                                    .map((_, index) => index)
                                    .filter((index) => index !== meta.index),
                                ),
                              )
                            }
                          >
                            Hide other columns
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={hiddenColumns.size === 0}
                            onSelect={() => onHiddenColumnsChange(new Set())}
                          >
                            Show all columns
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => setExploreColumn(meta.index)}
                          >
                            Explore distribution
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              const state = useAppStore.getState();
                              openQueryTab({
                                title: `${name} summary`,
                                query: `${state.query.trim()}\n| summarize count() by ${quoteKustoIdentifier(name)}`,
                                connectionId: state.activeConnectionId,
                                database: state.activeDatabase,
                              });
                            }}
                          >
                            Summarize column
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => onUseAsChartAxis(meta.index)}
                          >
                            Use as chart axis
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={!meta.type || !isNumericType(meta.type)}
                            onSelect={() => onUseAsChartSeries(meta.index)}
                          >
                            Use as chart series
                          </ContextMenuItem>
                        </>
                      }
                    >
                    <th className="select-none border-b border-r border-[var(--color-border)] px-2 py-1.5 text-left font-semibold">
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
                    </ContextMenu>
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
                  <ContextMenu
                    content={
                      <>
                        <ContextMenuItem
                          onSelect={() =>
                            void copyText(rowAsTsv(row.original), "Row")
                          }
                        >
                          Copy row as TSV
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            void copyText(
                              rowAsJson(result.columns, row.original),
                              "Row",
                            )
                          }
                        >
                          Copy row as JSON
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            void copyText(
                              rowAsMarkdown(result.columns, row.original),
                              "Row",
                            )
                          }
                        >
                          Copy row as Markdown
                        </ContextMenuItem>
                      </>
                    }
                  >
                    <td
                      className={cn(
                        "border-b border-[var(--color-border)] px-2 text-right text-[var(--color-text-faint)]",
                        wrap ? "align-top" : "align-middle",
                      )}
                    >
                      {vr.index + 1}
                    </td>
                  </ContextMenu>
                  {row.getVisibleCells().map((cell) => {
                    const display = formatCell(cell.getValue());
                    const meta = cell.column.columnDef.meta as {
                      index: number;
                    };
                    const column = result.columns[meta.index];
                    const value = cell.getValue();
                    return (
                      <ContextMenu
                        key={cell.id}
                        content={
                          <>
                            <ContextMenuItem
                              onSelect={() =>
                                void copyText(display.text, "Cell value")
                              }
                            >
                              Copy value
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                void copyText(cellJson(value), "Cell JSON")
                              }
                            >
                              Copy value as JSON
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                void copyText(rowAsTsv(row.original), "Row")
                              }
                            >
                              Copy row
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onSelect={() =>
                                appendToQuery(
                                  `| where ${quoteKustoIdentifier(column.name)} == ${kustoLiteral(value)}`,
                                )
                              }
                            >
                              Filter where equal
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                appendToQuery(
                                  `| where ${quoteKustoIdentifier(column.name)} != ${kustoLiteral(value)}`,
                                )
                              }
                            >
                              Filter where not equal
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onSelect={() =>
                                setInspectedCell({
                                  title: `${column.name} value`,
                                  value: cellJson(value),
                                })
                              }
                            >
                              Inspect formatted value
                            </ContextMenuItem>
                          </>
                        }
                      >
                        <td
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
                      </ContextMenu>
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

  return (
    <>
        {grid}
        <Modal
          open={exploreColumn !== null}
          onClose={() => setExploreColumn(null)}
          title={
            exploreColumn === null
              ? "Column distribution"
              : `Column distribution: ${result.columns[exploreColumn]?.name ?? ""}`
          }
        >
          {exploreColumn !== null && (
            <ColumnDistributionPanel
              result={result}
              columnIndex={exploreColumn}
              name={result.columns[exploreColumn]?.name ?? ""}
            />
          )}
        </Modal>
        <Modal
          open={inspectedCell !== null}
          onClose={() => setInspectedCell(null)}
          title={inspectedCell?.title ?? "Cell value"}
        >
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-[var(--font-mono)] text-xs">
            {inspectedCell?.value}
          </pre>
        </Modal>
    </>
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
  view,
  onViewChange,
  tools,
}: {
  rowCount: number;
  columnCount: number;
  elapsedMs: number;
  view: ResultView;
  onViewChange: (view: ResultView) => void;
  tools?: ReactNode;
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
      {tools && <div className="flex items-center gap-1">{tools}</div>}
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

function diagnoseError(message: string): void {
  const app = useAppStore.getState();
  const activeTab =
    app.tabs.find((tab) => tab.id === app.activeTabId) ?? app.tabs[0];
  if (!activeTab) return;
  const connection =
    app.connections.find(
      (candidate) => candidate.id === activeTab.connectionId,
    ) ?? null;
  const agent = useAgentStore.getState();
  if (!agent.isAuthenticated || agent.sending) return;

  agent.setPanelOpen(true);
  const context = buildInitialAgentContext({
    tab: activeTab,
    connection,
    entries: useContextStore.getState().entries,
  });
  void agent.send(
    `Diagnose this query error and suggest a corrected KQL query:\n\n${message}`,
    context,
  );
}
