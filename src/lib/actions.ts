// Side-effectful orchestration for Share (clipboard) and Export (CSV file).
// Extracted from the button component so the logic can be unit-tested without
// driving the Radix dropdown or Tauri runtime.

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { selectActiveConnection, useAppStore } from "../store/appStore";
import { showToast } from "../store/toast";
import { errorMessage, type ExportFormat, type ShareMode } from "../types/kusto";
import * as api from "./tauri";

const SHARE_LABELS: Record<ShareMode, string> = {
  query: "Query",
  results: "Results",
  both: "Query + results",
  json: "Results (JSON)",
  tsv: "Results (TSV)",
  datatable: "datatable()",
};

const EXPORT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  json: "JSON",
  tsv: "TSV",
};

/** Format the current query/result for `mode` and copy it to the clipboard. */
export async function copyShare(mode: ShareMode): Promise<void> {
  const { query, result } = useAppStore.getState();
  const hasResult = Boolean(result && result.columns.length > 0);
  if (mode === "query" && query.trim() === "") return;
  if (mode !== "query" && !hasResult) return;

  try {
    const text = await api.formatShare({
      mode,
      query,
      result: result ?? { columns: [], rows: [], row_count: 0 },
    });
    await writeText(text);
    showToast(`${SHARE_LABELS[mode]} copied to clipboard`, "success");
  } catch (err) {
    showToast(errorMessage(err), "error");
  }
}

/** Prompt for a path and write the current result set in the given format. */
export async function exportResult(format: ExportFormat): Promise<void> {
  const state = useAppStore.getState();
  const result = state.result;
  if (!result || result.columns.length === 0) return;

  const label = EXPORT_LABELS[format];
  try {
    const path = await save({
      title: `Export results to ${label}`,
      defaultPath: defaultFileName(
        selectActiveConnection(state)?.name,
        state.activeDatabase,
        format,
      ),
      filters: [{ name: label, extensions: [format] }],
    });
    if (!path) return; // user cancelled
    await api.exportResult({ path, format, result });
    showToast(`Results exported to ${label}`, "success");
  } catch (err) {
    showToast(errorMessage(err), "error");
  }
}

export function defaultFileName(
  connection: string | undefined,
  database: string | null,
  format: ExportFormat = "csv",
): string {
  const parts = ["kusto", connection, database].filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${parts.join("-")}-${stamp}.${format}`;
}
