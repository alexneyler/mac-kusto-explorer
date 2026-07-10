// Minimal, safe localStorage persistence for the connection list, the last
// active selection, and the open query tabs. Kept separate from the store so it
// can be unit-tested and so a corrupt/absent value never throws at startup.

import type { Connection } from "../types/kusto";

const KEY = "kusto-explorer.state.v1";

/** Persisted shape of a query tab. Results are transient and never stored. */
export interface PersistedTab {
  id: string;
  title: string;
  query: string;
  connectionId: string | null;
  database: string | null;
}

export interface PersistedState {
  connections: Connection[];
  activeConnectionId: string | null;
  activeDatabase: string | null;
  // Last editor text for the active tab. `null`/absent means "no saved query"
  // and callers should fall back to their default query. Kept for backward
  // compatibility with pre-tabs persisted state.
  query: string | null;
  // Open query tabs. Absent means "no persisted tabs" and callers should build a
  // single default tab (optionally seeded from `query`).
  tabs?: PersistedTab[];
  activeTabId?: string | null;
}

const EMPTY: PersistedState = {
  connections: [],
  activeConnectionId: null,
  activeDatabase: null,
  query: null,
};

function parseTabs(value: unknown): PersistedTab[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tabs = value
    .filter(
      (t): t is Partial<PersistedTab> =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as PersistedTab).id === "string" &&
        typeof (t as PersistedTab).title === "string" &&
        typeof (t as PersistedTab).query === "string",
    )
    .map((t) => ({
      id: t.id as string,
      title: t.title as string,
      query: t.query as string,
      connectionId: typeof t.connectionId === "string" ? t.connectionId : null,
      database: typeof t.database === "string" ? t.database : null,
    }));
  return tabs.length > 0 ? tabs : undefined;
}

export function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const result: PersistedState = {
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      activeConnectionId: parsed.activeConnectionId ?? null,
      activeDatabase: parsed.activeDatabase ?? null,
      query: typeof parsed.query === "string" ? parsed.query : null,
    };
    const tabs = parseTabs(parsed.tabs);
    if (tabs) {
      result.tabs = tabs;
      result.activeTabId =
        typeof parsed.activeTabId === "string" ? parsed.activeTabId : null;
    }
    return result;
  } catch {
    return { ...EMPTY };
  }
}

export function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Best-effort; ignore quota/serialization failures.
  }
}
