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

import type { Theme } from "../../store/themeStore";

export type Monaco = typeof monaco;

const THEMES = {
  dark: "kusto-dark",
  light: "kusto-light",
} satisfies Record<Theme, string>;

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
      defineThemes();
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

const KUSTO_LIGHT_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: "plainText", foreground: "1f2328" },
  { token: "comment", foreground: "6a737d" },
  { token: "punctuation", foreground: "1f2328" },
  { token: "directive", foreground: "795e26" },
  { token: "literal", foreground: "1f2328" },
  { token: "stringLiteral", foreground: "a31515" },
  { token: "type", foreground: "267f99" },
  { token: "column", foreground: "001080" },
  { token: "table", foreground: "795e26" },
  { token: "database", foreground: "795e26" },
  { token: "function", foreground: "795e26" },
  { token: "parameter", foreground: "001080" },
  { token: "variable", foreground: "001080" },
  { token: "identifier", foreground: "1f2328" },
  { token: "clientParameter", foreground: "007d8a" },
  { token: "queryParameter", foreground: "007d8a" },
  { token: "scalarParameter", foreground: "267f99" },
  { token: "mathOperator", foreground: "1f2328" },
  { token: "queryOperator", foreground: "008080" },
  { token: "command", foreground: "0000ff" },
  { token: "keyword", foreground: "0000ff" },
  { token: "materializedView", foreground: "795e26" },
  { token: "schemaMember", foreground: "1f2328" },
  { token: "signatureParameter", foreground: "1f2328" },
  { token: "option", foreground: "1f2328" },
];

function defineThemes() {
  monaco.editor.defineTheme(THEMES.dark, {
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

  monaco.editor.defineTheme(THEMES.light, {
    base: "vs",
    inherit: true,
    rules: KUSTO_LIGHT_TOKEN_RULES,
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1f2328",
      "editorLineNumber.foreground": "#8c959f",
      "editorLineNumber.activeForeground": "#57606a",
      "editor.selectionBackground": "#b6d7ff",
      "editor.lineHighlightBackground": "#f6f8fa",
      "editorCursor.foreground": "#0969da",
      "editorWidget.background": "#f6f8fa",
      "editorWidget.border": "#d8dee4",
      "editorSuggestWidget.background": "#f6f8fa",
      "editorSuggestWidget.selectedBackground": "#dfe3e8",
      "editorSuggestWidget.border": "#b8c0ca",
    },
  });
}

export function kustoTheme(theme: Theme): string {
  return THEMES[theme];
}

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

/** Resolve the parsed Kusto command containing the supplied model offset. */
export async function getKustoCommandAt(
  model: monaco.editor.ITextModel,
  cursorOffset: number,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const resolution = (async () => {
    const { getKustoWorker } = await import("@kusto/monaco-kusto");
    const accessor = await getKustoWorker();
    const worker = await accessor(model.uri);
    const command = await worker.getCommandAndLocationInContext(
      model.uri.toString(),
      cursorOffset,
    );
    return command?.text ?? null;
  })();
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Kusto command resolution timed out.")),
      2_000,
    );
  });

  try {
    return await Promise.race([resolution, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}
