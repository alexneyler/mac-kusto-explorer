import { CheckCircle2, Info, X, XCircle } from "lucide-react";

import { useToastStore } from "../store/toast";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
} as const;

const COLORS = {
  info: "var(--color-accent)",
  success: "var(--color-success)",
  error: "var(--color-danger)",
} as const;

/** Renders active toasts in the bottom-right corner. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm shadow-lg"
          >
            <Icon size={16} color={COLORS[t.kind]} />
            <span className="max-w-[320px]">{t.message}</span>
            <button
              className="ml-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
