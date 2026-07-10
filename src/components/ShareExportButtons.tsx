import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Share2 } from "lucide-react";

import { copyShare, exportResult } from "../lib/actions";
import { useAppStore } from "../store/appStore";
import type { ExportFormat, ShareMode } from "../types/kusto";

const SHARE_ITEMS: { mode: ShareMode; label: string; needsResult: boolean }[] = [
  { mode: "query", label: "Copy query", needsResult: false },
  { mode: "results", label: "Copy results (Markdown)", needsResult: true },
  { mode: "both", label: "Copy query + results", needsResult: true },
  { mode: "json", label: "Copy results as JSON", needsResult: true },
  { mode: "tsv", label: "Copy results as TSV", needsResult: true },
  { mode: "datatable", label: "Copy results as datatable()", needsResult: true },
];

const EXPORT_ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "csv", label: "Export as CSV" },
  { format: "json", label: "Export as JSON" },
  { format: "tsv", label: "Export as TSV (Excel)" },
];

const menuItemClass =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-bg-hover)] data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed";

const menuContentClass =
  "z-50 min-w-[220px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-xl";

export function ShareExportButtons() {
  const query = useAppStore((s) => s.query);
  const result = useAppStore((s) => s.result);

  const hasQuery = query.trim().length > 0;
  const hasResult = Boolean(result && result.columns.length > 0);

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="btn"
            disabled={!hasQuery && !hasResult}
            title="Share to clipboard"
          >
            <Share2 size={14} />
            Share
            <ChevronDown size={13} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className={menuContentClass}
          >
            {SHARE_ITEMS.map((item) => (
              <DropdownMenu.Item
                key={item.mode}
                className={menuItemClass}
                disabled={item.needsResult ? !hasResult : !hasQuery}
                onSelect={() => void copyShare(item.mode)}
              >
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="btn"
            disabled={!hasResult}
            title="Export results to a file"
          >
            <Download size={14} />
            Export
            <ChevronDown size={13} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className={menuContentClass}
          >
            {EXPORT_ITEMS.map((item) => (
              <DropdownMenu.Item
                key={item.format}
                className={menuItemClass}
                disabled={!hasResult}
                onSelect={() => void exportResult(item.format)}
              >
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
