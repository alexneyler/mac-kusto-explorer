import { type KeyboardEvent, useState } from "react";

import { selectActiveConnection, useAppStore } from "../store/appStore";
import { MonacoKustoEditor } from "./MonacoKustoEditor";

/**
 * KQL editor pane. Renders the Monaco + Kusto language-service editor, falling
 * back to a plain textarea (still fully functional, with Run shortcuts) if the
 * language stack fails to load.
 */
export function QueryEditor() {
  const connection = useAppStore(selectActiveConnection);
  const database = useAppStore((s) => s.activeDatabase);
  const [monacoError, setMonacoError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)]">
        <span className="font-medium">Query</span>
        <span className="truncate">
          {connection ? connection.name : "no connection"}
          {database ? ` / ${database}` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {monacoError ? (
          <TextareaEditor />
        ) : (
          <MonacoKustoEditor onError={setMonacoError} />
        )}
      </div>

      <div className="border-t border-[var(--color-border)] px-3 py-1 text-[10px] text-[var(--color-text-faint)]">
        {monacoError
          ? "Language service unavailable — basic editor. "
          : "KQL IntelliSense enabled. "}
        Press ⌘/Ctrl+Enter or F5 to run
      </div>
    </div>
  );
}

/** Plain-textarea fallback used when the Monaco stack cannot load. */
function TextareaEditor() {
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const runActiveQuery = useAppStore((s) => s.runActiveQuery);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const runCombo =
      (e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "F5";
    if (runCombo) {
      e.preventDefault();
      void runActiveQuery();
    }
  }

  return (
    <textarea
      aria-label="Query editor"
      spellCheck={false}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Write KQL here — e.g. StormEvents | take 100"
      className="h-full w-full resize-none bg-transparent px-3 py-2 font-[var(--font-mono)] text-[13px] leading-relaxed text-[var(--color-text)] outline-none"
    />
  );
}
