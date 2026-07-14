import {
  CheckCircle2,
  ChevronRight,
  CircleX,
  LoaderCircle,
  Wrench,
} from "lucide-react";

import type { AgentMessage } from "../../types/agent";

export function ToolCallCard({ message }: { message: AgentMessage }) {
  return (
    <details className="group text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
        <ChevronRight
          size={13}
          className="shrink-0 transition-transform group-open:rotate-90"
        />
        <ToolStatusIcon status={message.status} />
        <span className="min-w-0 flex-1 truncate">{message.content}</span>
        {message.durationMs !== undefined && (
          <span className="text-[10px] text-[var(--color-text-faint)]">
            {formatDuration(message.durationMs)}
          </span>
        )}
      </summary>
      <div className="ml-[27px] mt-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
        <ToolDetail label="Tool" value={message.toolName ?? "workspace tool"} />
        <ToolDetail
          label="Arguments"
          value={formatStructured(message.toolArguments ?? {})}
          code
        />
        {message.toolResult !== undefined && (
          <ToolDetail
            label="Result"
            value={formatStructured(message.toolResult)}
            code
          />
        )}
        {message.toolError && (
          <ToolDetail label="Error" value={message.toolError} error />
        )}
      </div>
    </details>
  );
}

function ToolStatusIcon({ status }: { status: AgentMessage["status"] }) {
  if (status === "running") {
    return (
      <LoaderCircle
        aria-label="Running"
        size={13}
        className="shrink-0 animate-spin text-[var(--color-accent)]"
      />
    );
  }
  if (status === "error") {
    return (
      <CircleX
        aria-label="Failed"
        size={13}
        className="shrink-0 text-[var(--color-danger)]"
      />
    );
  }
  return (
    <CheckCircle2
      aria-label="Completed"
      size={13}
      className="shrink-0 text-[var(--color-success)]"
    />
  );
}

function ToolDetail({
  label,
  value,
  code = false,
  error = false,
}: {
  label: string;
  value: string;
  code?: boolean;
  error?: boolean;
}) {
  return (
    <div className="border-b border-[var(--color-border)] p-2 last:border-b-0">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
        {label === "Tool" && <Wrench size={10} />}
        {label}
      </div>
      {code ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-[var(--color-text-muted)]">
          {value}
        </pre>
      ) : (
        <div
          className={`whitespace-pre-wrap break-words ${
            error
              ? "text-[var(--color-danger)]"
              : "text-[var(--color-text-muted)]"
          }`}
        >
          {value}
        </div>
      )}
    </div>
  );
}

function formatStructured(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}
