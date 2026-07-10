import { useEffect, useRef } from "react";

import { ensureKusto, KUSTO_THEME, setKustoSchema } from "../lib/monaco/kusto";
import type { Monaco } from "../lib/monaco/kusto";
import {
  schemaKey,
  selectActiveConnection,
  useAppStore,
} from "../store/appStore";

type Editor = ReturnType<Monaco["editor"]["create"]>;

interface Props {
  /** Called if the Monaco/monaco-kusto stack fails to load. */
  onError: (message: string) => void;
}

/**
 * The real KQL editor: Monaco + the Kusto language service. Kept isolated so a
 * load failure can fall back to a textarea without affecting the rest of the UI.
 */
export function MonacoKustoEditor({ onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const activeConnection = useAppStore(selectActiveConnection);
  const activeDatabase = useAppStore((s) => s.activeDatabase);
  const rawSchema = useAppStore((s) =>
    activeConnection && activeDatabase
      ? s.rawSchemaByKey[schemaKey(activeConnection.id, activeDatabase)]
      : undefined,
  );

  // Create the editor once.
  useEffect(() => {
    let disposed = false;

    ensureKusto()
      .then((monaco) => {
        if (disposed || !containerRef.current) return;
        monacoRef.current = monaco;

        const model = monaco.editor.createModel(
          useAppStore.getState().query,
          "kusto",
        );
        const editor = monaco.editor.create(containerRef.current, {
          model,
          theme: KUSTO_THEME,
          fontSize: 13,
          fontFamily: '"SF Mono", Menlo, Consolas, monospace',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          lineNumbersMinChars: 3,
          folding: false,
          padding: { top: 8, bottom: 8 },
          suggestSelection: "first",
          quickSuggestions: true,
          "semanticHighlighting.enabled": true,
        });
        editorRef.current = editor;

        // Editor -> store.
        model.onDidChangeContent(() => {
          const value = model.getValue();
          const store = useAppStore.getState();
          if (value !== store.query) store.setQuery(value);
        });

        // Run shortcuts.
        const run = () => void useAppStore.getState().runActiveQuery();
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
        editor.addCommand(monaco.KeyCode.F5, run);

        pushSchemaIfAvailable(editor);
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store -> editor for external edits (e.g. inserting a table name from the tree).
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const editor = editorRef.current;
      if (editor && editor.getValue() !== state.query) {
        editor.setValue(state.query);
      }
    });
  }, []);

  // Feed schema into the language service whenever it becomes available.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model || !rawSchema || !activeConnection || !activeDatabase) return;
    void setKustoSchema(
      model,
      rawSchema,
      activeConnection.clusterUrl,
      activeDatabase,
    ).catch(() => {
      /* schema push is best-effort; editing still works without it */
    });
  }, [rawSchema, activeConnection, activeDatabase]);

  function pushSchemaIfAvailable(editor: Editor) {
    const state = useAppStore.getState();
    const conn = selectActiveConnection(state);
    const db = state.activeDatabase;
    const model = editor.getModel();
    if (!model || !conn || !db) return;
    const raw = state.rawSchemaByKey[schemaKey(conn.id, db)];
    if (raw) {
      void setKustoSchema(model, raw, conn.clusterUrl, db).catch(() => {});
    }
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
