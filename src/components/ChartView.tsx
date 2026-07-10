import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  CHART_TYPES,
  type ChartType,
  buildChartModel,
  detectChartConfig,
  isNumericType,
  numericColumnIndices,
} from "../lib/chart";
import type { KustoResultSet } from "../types/kusto";

// Concrete, colour-blind-friendly palette that reads well on the dark theme.
const PALETTE = [
  "#4c9aff",
  "#46c17f",
  "#e0a63c",
  "#f2555a",
  "#a78bfa",
  "#22d3ee",
  "#f472b6",
  "#84cc16",
];

const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 11 };
const GRID_STROKE = "var(--color-border)";

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: 6,
    fontSize: 12,
    color: "var(--color-text)",
  },
  labelStyle: { color: "var(--color-text-muted)" },
  itemStyle: { color: "var(--color-text)" },
} as const;

/** Signature that changes whenever the result's column shape changes. */
function columnsSignature(result: KustoResultSet): string {
  return result.columns.map((c) => `${c.name}:${c.type}`).join("|");
}

export function ChartView({ result }: { result: KustoResultSet }) {
  const numericIndices = useMemo(
    () => numericColumnIndices(result.columns),
    [result.columns],
  );
  const signature = columnsSignature(result);

  const [type, setType] = useState<ChartType>(
    () => detectChartConfig(result.columns).type,
  );
  const [xIndex, setXIndex] = useState<number>(
    () => detectChartConfig(result.columns).xIndex,
  );
  const [seriesIndices, setSeriesIndices] = useState<number[]>(
    () => detectChartConfig(result.columns).seriesIndices,
  );

  // Re-detect sensible defaults whenever a new result shape arrives.
  useEffect(() => {
    const config = detectChartConfig(result.columns);
    setType(config.type);
    setXIndex(config.xIndex);
    setSeriesIndices(config.seriesIndices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const activeSeries = useMemo(
    () => (seriesIndices.length > 0 ? seriesIndices : numericIndices.slice(0, 1)),
    [seriesIndices, numericIndices],
  );
  const model = useMemo(
    () => buildChartModel(result, { type, xIndex, seriesIndices: activeSeries }),
    [result, type, xIndex, activeSeries],
  );

  if (numericIndices.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <ChartControls
          result={result}
          type={type}
          xIndex={xIndex}
          seriesIndices={seriesIndices}
          numericIndices={numericIndices}
          onTypeChange={setType}
          onXChange={setXIndex}
          onToggleSeries={() => {}}
          disabled
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-2 text-[var(--color-text-faint)]">
            <BarChart3 size={28} />
            <p className="text-sm">No numeric columns to chart.</p>
          </div>
        </div>
      </div>
    );
  }

  const toggleSeries = (index: number) => {
    setSeriesIndices((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <ChartControls
        result={result}
        type={type}
        xIndex={xIndex}
        seriesIndices={activeSeries}
        numericIndices={numericIndices}
        onTypeChange={setType}
        onXChange={setXIndex}
        onToggleSeries={toggleSeries}
      />
      <div className="min-h-0 flex-1 p-3">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(type, model)}
        </ResponsiveContainer>
      </div>
      {model.capped && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-1 text-[11px] text-[var(--color-warning)]">
          Showing first {model.points.length.toLocaleString()} of{" "}
          {model.totalRows.toLocaleString()} rows.
        </div>
      )}
    </div>
  );
}

function renderChart(
  type: ChartType,
  model: ReturnType<typeof buildChartModel>,
) {
  const { points, seriesKeys, xName } = model;
  const margin = { top: 12, right: 20, bottom: 8, left: 8 };
  const commonAxes = (
    <>
      <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        name={xName}
        tick={AXIS_TICK}
        stroke={GRID_STROKE}
        minTickGap={24}
      />
      <YAxis tick={AXIS_TICK} stroke={GRID_STROKE} width={56} />
      <Tooltip {...TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }} />
    </>
  );

  switch (type) {
    case "column":
      return (
        <BarChart data={points} margin={margin}>
          {commonAxes}
          {seriesKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={color(i)} />
          ))}
        </BarChart>
      );
    case "bar":
      return (
        <BarChart data={points} layout="vertical" margin={margin}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
          <XAxis type="number" tick={AXIS_TICK} stroke={GRID_STROKE} />
          <YAxis
            type="category"
            dataKey="x"
            tick={AXIS_TICK}
            stroke={GRID_STROKE}
            width={96}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }}
          />
          {seriesKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={color(i)} />
          ))}
        </BarChart>
      );
    case "area":
    case "stackedArea":
      return (
        <AreaChart data={points} margin={margin}>
          {commonAxes}
          {seriesKeys.map((key, i) => (
            <Area
              key={key}
              dataKey={key}
              stroke={color(i)}
              fill={color(i)}
              fillOpacity={0.25}
              stackId={type === "stackedArea" ? "1" : undefined}
            />
          ))}
        </AreaChart>
      );
    case "pie": {
      const key = seriesKeys[0];
      return (
        <PieChart margin={margin}>
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }}
          />
          <Pie
            data={points}
            dataKey={key}
            nameKey="x"
            outerRadius="80%"
            label={false}
          >
            {points.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Pie>
        </PieChart>
      );
    }
    case "scatter":
      return (
        <ScatterChart margin={margin}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            name={xName}
            tick={AXIS_TICK}
            stroke={GRID_STROKE}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} stroke={GRID_STROKE} width={56} />
          <Tooltip {...TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3" }} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }}
          />
          {seriesKeys.map((key, i) => (
            <Scatter key={key} name={key} dataKey={key} fill={color(i)} />
          ))}
        </ScatterChart>
      );
    case "line":
    case "time":
    default:
      return (
        <LineChart data={points} margin={margin}>
          {commonAxes}
          {seriesKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color(i)}
              dot={false}
              strokeWidth={1.5}
            />
          ))}
        </LineChart>
      );
  }
}

function color(i: number): string {
  return PALETTE[i % PALETTE.length];
}

const selectClass =
  "rounded border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";

function ChartControls({
  result,
  type,
  xIndex,
  seriesIndices,
  numericIndices,
  onTypeChange,
  onXChange,
  onToggleSeries,
  disabled = false,
}: {
  result: KustoResultSet;
  type: ChartType;
  xIndex: number;
  seriesIndices: number[];
  numericIndices: number[];
  onTypeChange: (type: ChartType) => void;
  onXChange: (index: number) => void;
  onToggleSeries: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2">
      <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        Type
        <select
          aria-label="Chart type"
          className={selectClass}
          value={type}
          disabled={disabled}
          onChange={(e) => onTypeChange(e.target.value as ChartType)}
        >
          {CHART_TYPES.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        X axis
        <select
          aria-label="X axis column"
          className={selectClass}
          value={xIndex}
          disabled={disabled}
          onChange={(e) => onXChange(Number(e.target.value))}
        >
          {result.columns.map((col, i) => (
            <option key={`${i}-${col.name}`} value={i}>
              {col.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        Series
        <div className="flex flex-wrap items-center gap-1">
          {result.columns.map((col, i) =>
            isNumericType(col.type) && i !== xIndex ? (
              <button
                key={`${i}-${col.name}`}
                type="button"
                disabled={disabled}
                onClick={() => onToggleSeries(i)}
                className={
                  "rounded border px-1.5 py-0.5 text-[11px] transition-colors " +
                  (seriesIndices.includes(i)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                    : "border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]")
                }
              >
                {col.name}
              </button>
            ) : null,
          )}
          {numericIndices.length === 0 && (
            <span className="text-[var(--color-text-faint)]">none</span>
          )}
        </div>
      </div>
    </div>
  );
}
