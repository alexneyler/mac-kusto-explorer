import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Share2 } from "lucide-react";

import { copyShare, exportResultCsv } from "../lib/actions";
import { useAppStore } from "../store/appStore";
import type { ShareMode } from "../types/kusto";

const SHARE_ITEMS: { mode: ShareMode; label: string; needsResult: boolean }[] = [
  { mode: "query", label: "Copy query", needsResult: false },
  { mode: "results", label: "Copy results", needsResult: true },
  { mode: "both", label: "Copy query + results", needsResult: true },
];

const menuItemClass =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-bg-hover)] data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed";

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
            className="z-50 min-w-[190px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-xl"
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

      <button
        className="btn"
        disabled={!hasResult}
        onClick={() => void exportResultCsv()}
        title="Export results to CSV"
      >
        <Download size={14} />
        Export
      </button>
    </div>
  );
}
