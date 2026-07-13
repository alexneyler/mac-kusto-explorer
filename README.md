# Kusto Explorer

A cross-platform (macOS-first) desktop client for **Azure Data Explorer / Kusto**,
inspired by Microsoft's [Kusto.Explorer](https://learn.microsoft.com/en-us/kusto/tools/kusto-explorer).
Connect to any cluster you can access, write KQL with real IntelliSense, view
results in a fast grid, and share or export them.

Built with **Tauri 2 (Rust)** + **React + TypeScript (Vite)**. Authentication
reuses your local **Azure CLI** session — no app registration or client ID required.

## Features

- **Connect to any cluster you can access.** Authentication uses the `az` CLI
  (`az account get-access-token`), so any cluster your Azure identity can reach
  works out of the box. Add a connection by cluster URL; browse databases,
  tables, columns, and functions in a lazy-loaded tree, and **search/filter** it
  by name from the sidebar box (**Ctrl/⌘+F** to focus). Matches connections,
  databases, tables, columns, and functions; highlights the matched text,
  auto-expands to reveal matches, and shows a live match count.
- **Real KQL editor.** Monaco editor wired to
  [`@kusto/monaco-kusto`](https://github.com/Azure/monaco-kusto) — the same
  language service the ADX web UI uses — for syntax highlighting, schema-aware
  completion, signature help, and diagnostics. Run with **⌘/Ctrl+Enter** or **F5**.
- **Multiple query tabs.** Work on several queries at once — each tab keeps its
  own KQL text, result set, and **connection/database context**. Add a tab with
  **+**, close one with its **×**, switch by clicking, and double-click a tab to
  rename it. The Toolbar's connection and database selectors act on the active
  tab, and open tabs are restored on the next launch.
- **Results grid.** Virtualized table (TanStack) with typed cell rendering
  (numbers, datetimes, booleans, dynamic/JSON), column sorting, row/column
  counts, and query execution time.
- **Result charts.** Toggle any result set between the table and a chart view
  ([Recharts](https://recharts.org/)) — line, column, bar, area, stacked area,
  pie, scatter, and time charts. Axes and numeric series are auto-detected from
  column types (datetime → time chart), and you can override the X column and
  which series to plot. Large results are capped for responsiveness.
- **Data-view tools.** Work with the loaded result set directly in the grid:
  toggle **hide empty columns**, toggle **wrap text** for long values, and
  **explore column values** — a per-column popover (the chart icon in the
  header) showing the value distribution computed client-side: top values with
  counts, percentages, and mini bars, plus distinct- and null-counts.
- **Share.** One click to copy to the clipboard: the **query** (as KQL), the
  **results** (as a Markdown table, **JSON**, **TSV**, or a KQL **`datatable()`**
  literal you can paste straight back into a query), or the **query + results**.
- **Export.** Save results to a file via a native save dialog — **CSV** (RFC 4180),
  **JSON** (array of row objects), or **TSV** (tab-separated, opens in Excel).

## Prerequisites

- **[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)** — run
  `az login` before starting the app. The account must have access to the
  cluster(s) you want to query.
- **[Node.js](https://nodejs.org/)** 18+ (developed on v22).
- **[Rust](https://www.rust-lang.org/tools/install)** stable (developed on 1.96)
  and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

## Getting started

```bash
npm install          # install frontend dependencies
az login             # authenticate the Azure CLI (once)
npm run tauri dev    # build the frontend and launch the desktop app
```

To produce a distributable bundle (e.g. a macOS `.app`/`.dmg`):

```bash
npm run tauri build
```

### Releases

Every push to `main` runs the release workflow after the frontend and backend
tests pass. It increments the latest `vX.Y.Z` tag's patch number, builds a
universal macOS bundle for Apple Silicon and Intel, and publishes the bundle as
a GitHub release. The workflow can also be started manually from the Actions
tab.

### Try it against the public sample cluster

1. Click **Add connection** and enter `https://help.kusto.windows.net`.
2. Expand the connection and select the **Samples** database.
3. Run the default query:

   ```kql
   StormEvents
   | take 100
   ```

## Testing

Everything testable is covered by unit and integration tests.

```bash
# Rust backend (auth cache, REST client, parsers, schema, formatters)
cd src-tauri && cargo test          # 59 tests

# Frontend (store, actions, components, formatting)
npm test                            # see test suite (Vitest + Testing Library)

# Type-check the frontend
npm run typecheck
```

### Optional runtime smoke test

`npm run smoke` drives the built frontend in a headless Chrome to verify the
editor mounts, the Kusto language service registers, and completion fires. It
requires Google Chrome and a running frontend server:

```bash
npm run dev:tauri     # serves the built frontend on http://localhost:1420
npm run smoke         # in another shell (set CHROME_PATH if Chrome isn't at the macOS default)
```

## Architecture

```
React UI ──invoke──▶ Tauri commands (Rust)
  Connections tree      list_databases / get_schema
  Monaco + kusto editor run_query   (v2 REST → { columns, rows, elapsed_ms })
  Results grid          format_share (markdown / json / tsv / datatable, pure)
  Share / Export        export_result (save dialog → csv / json / tsv)

Auth: TokenProvider trait ▶ AzCliTokenProvider (caches per cluster+tenant, expiry-aware)
```

The Rust backend holds all the testable logic behind traits (`CommandRunner`,
`TokenProvider`, `HttpTransport`) so it can be unit-tested with fakes and
integration-tested with `httpmock`:

- **Auth** — spawns `az account get-access-token --resource <cluster>`, parses
  and caches the token until it nears expiry.
- **Query** — queries go to `POST /v2/rest/query`; control commands (`.show`,
  etc.) go to `POST /v1/rest/mgmt`. The v2 framed-JSON response is parsed into a
  typed `KustoResultSet`.
- **Schema** — `.show database <db> schema as json` is transformed into both a
  compact tree (for the sidebar) and the raw payload (fed to the language service
  for IntelliSense).
- **Format** — pure formatters: CSV (RFC 4180), GitHub-flavored Markdown, JSON,
  TSV, and KQL `datatable()` literals.

The frontend stays thin: a `zustand` store orchestrates the Tauri commands and
holds UI state; components render it.

### Why `tauri dev` builds the frontend

The Kusto language service ships legacy Bridge.NET global scripts that only
resolve correctly when the worker is **bundled** (Rollup). Vite's plain dev
server serves each module as separate native ESM, which breaks those globals and
silently disables completion. So `npm run tauri dev` runs a watch **build** and
serves the bundled output (see `scripts/tauri-frontend.mjs`) — identical to what
`tauri build` ships — so IntelliSense works in development too. Use `npm run dev`
(plain Vite) only for fast UI-only iteration where the language worker isn't needed.

## Known limitations

- **macOS end-to-end (WebDriver) tests** are not included — `tauri-driver` does
  not support macOS. The web layer is covered by the headless-Chrome smoke test
  and the app logic by Rust + component tests.
- Very large result sets are rendered virtualized; extremely large exports are
  written directly to the chosen file (CSV/JSON/TSV).
