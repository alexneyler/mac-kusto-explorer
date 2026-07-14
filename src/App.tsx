import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { AgentPanel } from "./components/agent/AgentPanel";
import { ConnectionsSidebar } from "./components/ConnectionsSidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsView } from "./components/ResultsView";
import { Toaster } from "./components/Toaster";
import { Toolbar } from "./components/Toolbar";
import { installAgentWorkspaceBridge } from "./lib/agent/bridge";
import { useAgentStore } from "./store/agentStore";
import { useContextStore } from "./store/contextStore";
import type { AgentSessionEvent } from "./types/agent";

function HResizeHandle() {
  return (
    <PanelResizeHandle className="w-[3px] bg-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)] data-[resize-handle-state=drag]:bg-[var(--color-accent)]" />
  );
}

function VResizeHandle() {
  return (
    <PanelResizeHandle className="h-[3px] bg-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)] data-[resize-handle-state=drag]:bg-[var(--color-accent)]" />
  );
}

function App() {
  const panelOpen = useAgentStore((state) => state.panelOpen);
  const initializeAgent = useAgentStore((state) => state.initialize);
  const handleAgentEvent = useAgentStore((state) => state.handleEvent);
  const initializeContext = useContextStore((state) => state.initialize);

  useEffect(() => {
    void initializeContext();
  }, [initializeContext]);

  useEffect(() => {
    let active = true;
    let removeBridge: (() => void) | undefined;
    let removeEvents: (() => void) | undefined;
    void Promise.all([
      installAgentWorkspaceBridge(),
      listen<AgentSessionEvent>("agent-session-event", ({ payload }) => {
        handleAgentEvent(payload);
      }),
    ]).then(([bridge, events]) => {
      if (!active) {
        bridge();
        events();
        return;
      }
      removeBridge = bridge;
      removeEvents = events;
    });
    return () => {
      active = false;
      removeBridge?.();
      removeEvents?.();
    };
  }, [handleAgentEvent]);

  useEffect(() => {
    if (panelOpen) void initializeAgent();
  }, [initializeAgent, panelOpen]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="ke-outer">
          <Panel defaultSize={22} minSize={14} maxSize={40}>
            <ConnectionsSidebar />
          </Panel>
          <HResizeHandle />
          <Panel defaultSize={panelOpen ? 55 : 78} minSize={35}>
            <PanelGroup direction="vertical" autoSaveId="ke-inner">
              <Panel defaultSize={45} minSize={15}>
                <QueryEditor />
              </Panel>
              <VResizeHandle />
              <Panel defaultSize={55} minSize={15}>
                <ResultsView />
              </Panel>
            </PanelGroup>
          </Panel>
          {panelOpen && (
            <>
              <HResizeHandle />
              <Panel
                id="agent"
                order={3}
                defaultSize={23}
                minSize={18}
                maxSize={45}
              >
                <AgentPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <Toaster />
    </div>
  );
}

export default App;
