// Monaco + @kusto/monaco-kusto wiring for Vite. This is the highest-risk part
// of the app (worker setup), so it is isolated here and the editor component
// falls back to a plain textarea if `ensureKusto()` rejects.

import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
// Load the editor UI contributions (suggest widget, hover, parameter hints,
// find, bracket matching, …). `editor.api` alone only exposes the API surface
// and language registration — without this the completion/suggest widget never
// renders even though the Kusto language service returns completion items.
// `edcore.main` pulls in all editor contributions but not the bundled
// languages (we only use `kusto`), keeping the bundle lean.
import "monaco-editor/esm/vs/editor/edcore.main";
// Vite bundles these as dedicated web workers via the `?worker` suffix.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import KustoWorker from "@kusto/monaco-kusto/release/esm/kusto.worker?worker";

export type Monaco = typeof monaco;

const THEME = "kusto-dark";

let initPromise: Promise<Monaco> | null = null;

/**
 * Register the Kusto language + its language-service worker exactly once and
 * return the shared monaco namespace. Safe to call repeatedly.
 */
export function ensureKusto(): Promise<Monaco> {
  if (!initPromise) {
    initPromise = (async () => {
      // Route language-service workers: 'kusto' models use the Kusto worker;
      // everything else uses the default editor worker.
      self.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          if (label === "kusto") return new KustoWorker();
          return new EditorWorker();
        },
      };
      // Importing the contribution registers `monaco.languages.kusto`.
      await import("@kusto/monaco-kusto");
      defineTheme();
      // Expose the shared instance for debugging and runtime smoke checks.
      (self as unknown as { monaco?: Monaco }).monaco = monaco;
      return monaco;
    })();
  }
  return initPromise;
}

// Kusto token types emitted by @kusto/monaco-kusto's Monarch tokenizer and its
// semantic-tokens provider (the string values of its internal `Token` enum).
// The theme MUST map these to colors, otherwise every token falls back to the
// editor foreground and highlighting looks flat. These are the same VS Code
// "dark+" hues the ADX web UI uses, which read well on our #1b1d23 background.
const KUSTO_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: "plainText", foreground: "d4d4d4" },
  { token: "comment", foreground: "6a9955" },
  { token: "punctuation", foreground: "d4d4d4" },
  { token: "directive", foreground: "faf9c2" },
  { token: "literal", foreground: "d4d4d4" },
  { token: "stringLiteral", foreground: "ce9178" },
  { token: "type", foreground: "569cd6" },
  { token: "column", foreground: "9cdcfe" },
  { token: "table", foreground: "d7ba7d" },
  { token: "database", foreground: "d7ba7d" },
  { token: "function", foreground: "dcdcaa" },
  { token: "parameter", foreground: "92caf4" },
  { token: "variable", foreground: "92caf4" },
  { token: "identifier", foreground: "d4d4d4" },
  { token: "clientParameter", foreground: "2b91af" },
  { token: "queryParameter", foreground: "2b91af" },
  { token: "scalarParameter", foreground: "569cd6" },
  { token: "mathOperator", foreground: "d4d4d4" },
  { token: "queryOperator", foreground: "4ec9b0" },
  { token: "command", foreground: "569cd6" },
  { token: "keyword", foreground: "569cd6" },
  { token: "materializedView", foreground: "d7ba7d" },
  { token: "schemaMember", foreground: "d4d4d4" },
  { token: "signatureParameter", foreground: "d4d4d4" },
  { token: "option", foreground: "d4d4d4" },
];

function defineTheme() {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: KUSTO_TOKEN_RULES,
    colors: {
      "editor.background": "#1b1d23",
      "editor.foreground": "#e6e8ec",
      "editorLineNumber.foreground": "#4b5162",
      "editorLineNumber.activeForeground": "#9aa0ac",
      "editor.selectionBackground": "#2f4a70",
      "editor.lineHighlightBackground": "#22252d",
      "editorCursor.foreground": "#4c9aff",
      "editorWidget.background": "#22252d",
      "editorWidget.border": "#30343d",
      "editorSuggestWidget.background": "#22252d",
      "editorSuggestWidget.selectedBackground": "#313641",
      "editorSuggestWidget.border": "#3d424d",
    },
  });
}

export const KUSTO_THEME = THEME;

/**
 * Push a database schema (raw `showSchema.Result` from the backend) into the
 * Kusto language service for the given model, enabling schema-aware
 * IntelliSense (table/column completion, validation).
 */
export async function setKustoSchema(
  model: monaco.editor.ITextModel,
  rawShowSchema: unknown,
  clusterUrl: string,
  database: string,
): Promise<void> {
  const { getKustoWorker } = await import("@kusto/monaco-kusto");
  const accessor = await getKustoWorker();
  const worker = await accessor(model.uri);
  await worker.setSchemaFromShowSchema(rawShowSchema, clusterUrl, database);
}
