import { Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useAppStore } from "../store/appStore";
import { copyText } from "../lib/clipboard";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";

/**
 * Kusto.Explorer–style query tab bar. Each tab owns its own editor text and
 * results; the active tab is mirrored into the editor and results panes. Click a
 * tab to switch, `+` to add, the `x` to close, or double-click a tab to rename.
 */
export function QueryTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const renameTab = useAppStore((s) => s.renameTab);
  const openQueryTab = useAppStore((s) => s.openQueryTab);

  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div
      role="tablist"
      aria-label="Query tabs"
      className="flex items-stretch gap-0.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] px-1"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <ContextMenu
            key={tab.id}
            content={
              <>
                <ContextMenuItem onSelect={() => setEditingId(tab.id)}>
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    openQueryTab({
                      title: `${tab.title} copy`,
                      query: tab.query,
                      connectionId: tab.connectionId,
                      database: tab.database,
                    })
                  }
                >
                  Duplicate
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tab.query.trim() === ""}
                  onSelect={() => void copyText(tab.query, "Query")}
                >
                  Copy query
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tabs.length === 1}
                  onSelect={() => closeOtherTabs(tab.id)}
                >
                  Close other tabs
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tabs.indexOf(tab) === tabs.length - 1}
                  onSelect={() => closeTabsToRight(tab.id)}
                >
                  Close tabs to the right
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => addTab()}>
                  New query tab
                </ContextMenuItem>
              </>
            }
          >
          <div
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => setEditingId(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveTab(tab.id);
              }
            }}
            className={`group flex max-w-[200px] cursor-pointer items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs outline-none ${
              active
                ? "border-[var(--color-accent)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
            }`}
          >
            {editingId === tab.id ? (
              <TabTitleInput
                initial={tab.title}
                onCommit={(title) => {
                  renameTab(tab.id, title);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <span className="truncate" title={tab.title}>
                {tab.title}
              </span>
            )}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 text-[var(--color-text-faint)] opacity-0 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)] group-hover:opacity-100 focus:opacity-100 aria-hidden:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
          </ContextMenu>
        );
      })}
      <button
        type="button"
        aria-label="New query tab"
        title="New query tab"
        onClick={() => addTab()}
        className="flex items-center px-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function TabTitleInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <input
      ref={ref}
      aria-label="Tab name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      className="w-24 rounded border border-[var(--color-accent)] bg-[var(--color-bg)] px-1 py-0.5 text-xs text-[var(--color-text)] outline-none"
    />
  );
}
