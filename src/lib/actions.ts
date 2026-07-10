// Side-effectful orchestration for Share (clipboard) and Export (CSV file).
// Extracted from the button component so the logic can be unit-tested without
// driving the Radix dropdown or Tauri runtime.

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { selectActiveConnection, useAppStore } from "../store/appStore";
import { showToast } from "../store/toast";
import { errorMessage, type ShareMode } from "../types/kusto";
import * as api from "./tauri";

const SHARE_LABELS: Record<ShareMode, string> = {
  query: "Query",
  results: "Results",
  both: "Query + results",
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

/** Prompt for a path and write the current result set to CSV. */
export async function exportResultCsv(): Promise<void> {
  const state = useAppStore.getState();
  const result = state.result;
  if (!result || result.columns.length === 0) return;

  try {
    const path = await save({
      title: "Export results to CSV",
      defaultPath: defaultFileName(
        selectActiveConnection(state)?.name,
        state.activeDatabase,
      ),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return; // user cancelled
    await api.exportCsv({ path, result });
    showToast("Results exported to CSV", "success");
  } catch (err) {
    showToast(errorMessage(err), "error");
  }
}

export function defaultFileName(
  connection: string | undefined,
  database: string | null,
): string {
  const parts = ["kusto", connection, database].filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${parts.join("-")}-${stamp}.csv`;
}
