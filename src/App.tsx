import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ConnectionsSidebar } from "./components/ConnectionsSidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsView } from "./components/ResultsView";
import { Toaster } from "./components/Toaster";
import { Toolbar } from "./components/Toolbar";

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
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="ke-outer">
          <Panel defaultSize={22} minSize={14} maxSize={40}>
            <ConnectionsSidebar />
          </Panel>
          <HResizeHandle />
          <Panel defaultSize={78} minSize={40}>
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
        </PanelGroup>
      </div>
      <Toaster />
    </div>
  );
}

export default App;
