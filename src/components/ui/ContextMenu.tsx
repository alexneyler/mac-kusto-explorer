import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export function ContextMenu({
  children,
  content,
}: {
  children: ReactNode;
  content: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          collisionPadding={8}
          className="z-[100] min-w-52 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 text-[var(--color-text)] shadow-2xl"
        >
          {content}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

export function ContextMenuItem({
  children,
  danger = false,
  disabled = false,
  onSelect,
  shortcut,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  shortcut?: string;
}) {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-xs outline-none",
        "data-[highlighted]:bg-[var(--color-bg-hover)] data-[disabled]:opacity-40",
        danger ? "text-[var(--color-danger)]" : "text-[var(--color-text)]",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut && (
        <span className="ml-4 text-[10px] text-[var(--color-text-faint)]">
          {shortcut}
        </span>
      )}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator() {
  return (
    <ContextMenuPrimitive.Separator className="my-1 h-px bg-[var(--color-border)]" />
  );
}

export function ContextSubMenu({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Sub>
      <ContextMenuPrimitive.SubTrigger className="flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-[var(--color-bg-hover)]">
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight size={12} className="text-[var(--color-text-faint)]" />
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.SubContent
          collisionPadding={8}
          className="z-[101] min-w-48 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 text-[var(--color-text)] shadow-2xl"
        >
          {children}
        </ContextMenuPrimitive.SubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}
