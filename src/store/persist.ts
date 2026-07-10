// Minimal, safe localStorage persistence for the connection list and the last
// active selection. Kept separate from the store so it can be unit-tested and
// so a corrupt/absent value never throws at startup.

import type { Connection } from "../types/kusto";

const KEY = "kusto-explorer.state.v1";

export interface PersistedState {
  connections: Connection[];
  activeConnectionId: string | null;
  activeDatabase: string | null;
  // Last editor text. `null`/absent means "no saved query" and callers should
  // fall back to their default query.
  query: string | null;
}

const EMPTY: PersistedState = {
  connections: [],
  activeConnectionId: null,
  activeDatabase: null,
  query: null,
};

export function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      activeConnectionId: parsed.activeConnectionId ?? null,
      activeDatabase: parsed.activeDatabase ?? null,
      query: typeof parsed.query === "string" ? parsed.query : null,
    };
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
