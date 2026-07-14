import { create } from "zustand";

import { saveAgentContext, loadAgentContext } from "../lib/tauri";
import type {
  AgentContextData,
  AgentContextEntry,
  AgentContextTarget,
} from "../types/agent";
import { AGENT_DATA_VERSION } from "../types/agent";
import { contextKey } from "../lib/agent/context";
import { errorMessage } from "../types/kusto";

interface ContextState {
  entries: AgentContextEntry[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  initialize(): Promise<void>;
  save(target: AgentContextTarget, content: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

function data(entries: AgentContextEntry[]): AgentContextData {
  return { version: AGENT_DATA_VERSION, entries };
}

export const useContextStore = create<ContextState>((set, get) => ({
  entries: [],
  loading: false,
  initialized: false,
  error: null,

  async initialize() {
    if (get().initialized || get().loading) return;
    set({ loading: true, error: null });
    try {
      const saved = await loadAgentContext();
      set({ entries: saved.entries, initialized: true, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), initialized: true, loading: false });
    }
  },

  async save(target, content) {
    const entry: AgentContextEntry = {
      ...target,
      key: contextKey(target),
      content,
      updatedAt: new Date().toISOString(),
    };
    const previous = get().entries;
    const entries = [
      ...previous.filter((candidate) => candidate.key !== entry.key),
      entry,
    ];
    set({ entries, error: null });
    try {
      await saveAgentContext(data(entries));
    } catch (error) {
      set({ entries: previous, error: errorMessage(error) });
      throw error;
    }
  },

  async remove(key) {
    const previous = get().entries;
    const entries = previous.filter((entry) => entry.key !== key);
    set({ entries, error: null });
    try {
      await saveAgentContext(data(entries));
    } catch (error) {
      set({ entries: previous, error: errorMessage(error) });
      throw error;
    }
  },

  async clear() {
    const previous = get().entries;
    set({ entries: [], error: null });
    try {
      await saveAgentContext(data([]));
    } catch (error) {
      set({ entries: previous, error: errorMessage(error) });
      throw error;
    }
  },
}));
