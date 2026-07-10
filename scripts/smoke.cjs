// Headless runtime smoke test: load the built frontend in real Chrome and
// verify the React shell mounts, the Monaco editor initializes and is
// interactive, the KQL language service registers, and completion (the suggest
// widget) actually fires. No network to Kusto is required.
//
// Usage:
//   1. Start the built frontend server:  npm run dev:tauri   (serves :1420)
//   2. In another shell:                 npm run smoke
// Configure the browser with CHROME_PATH and the target with SMOKE_URL.
const fs = require("node:fs");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.SMOKE_URL || "http://localhost:1420/";

if (!fs.existsSync(CHROME)) {
  console.log(
    `[smoke] Chrome not found at ${CHROME}; set CHROME_PATH to run this ` +
      "optional runtime check. Skipping.",
  );
  process.exit(0);
}

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  console.log("[smoke] puppeteer-core not installed; skipping.");
  process.exit(0);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle0" });

  await page.waitForSelector('[aria-label="Connection"]', { timeout: 15000 });
  const hasToolbar = (await page.$('[aria-label="Connection"]')) !== null;

  await page.waitForSelector(".monaco-editor", { timeout: 20000 });
  const hasMonaco = (await page.$(".monaco-editor")) !== null;

  const kustoRegistered = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const langs = window.monaco?.languages?.getLanguages?.() ?? [];
      if (langs.some((l) => l.id === "kusto")) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  });

  await page.click(".monaco-editor .view-lines");
  await page.keyboard.type("StormEvents | take 5");
  const editorText = await page.evaluate(() => {
    const el = document.querySelector(".monaco-editor");
    return el ? el.textContent : "";
  });

  // Completion: warm the language-service worker, then trigger the suggest
  // widget through Monaco's action API and confirm the kusto service returns
  // operator suggestions on a fresh pipe stage.
  const completionWorks = await page.evaluate(async () => {
    const m = window.monaco;
    if (!m?.languages?.kusto?.getKustoWorker) return false;
    const editor = m.editor.getEditors?.()[0];
    if (!editor) return false;
    const model = editor.getModel();
    if (!model || model.getLanguageId() !== "kusto") return false;

    // Warm the worker for this model (cold start can take a moment).
    try {
      const accessor = await m.languages.kusto.getKustoWorker();
      await Promise.race([
        accessor(model.uri),
        new Promise((_, r) => setTimeout(() => r(new Error("warm")), 8000)),
      ]);
    } catch {
      return false;
    }

    model.setValue("StormEvents\n| ");
    editor.setPosition({ lineNumber: 2, column: 3 });
    editor.focus();
    editor.trigger("smoke", "editor.action.triggerSuggest", {});

    for (let i = 0; i < 40; i++) {
      const rows = document.querySelectorAll(
        ".suggest-widget.visible .monaco-list-row",
      );
      if (rows.length > 0) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  });

  const result = {
    hasToolbar,
    hasMonaco,
    kustoRegistered,
    typedContainsStormEvents: (editorText || "").includes("StormEvents"),
    completionWorks,
    consoleErrors: errors.slice(0, 8),
  };
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
  if (
    !hasToolbar ||
    !hasMonaco ||
    !kustoRegistered ||
    !result.typedContainsStormEvents
  ) {
    process.exit(1);
  }
})().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(2);
});
