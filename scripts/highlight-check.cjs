// Headless runtime check for KQL syntax highlighting.
//
// Monaco renders each colored token as <span class="mtkN"> where each mtkN
// class carries a distinct color. Flat/broken highlighting collapses to a
// single color, so we assert that a KQL query produces MORE THAN ONE distinct
// mtkN class, and that a keyword token and a string token resolve to different
// computed colors.
//
// Usage:
//   1. Start the built frontend server:  npm run dev:tauri   (serves :1420)
//   2. In another shell:                 node scripts/highlight-check.cjs
// Configure via CHROME_PATH and SMOKE_URL.
const fs = require("node:fs");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.SMOKE_URL || "http://localhost:1420/";
const QUERY =
  'StormEvents\n| where State == "TEXAS"\n| summarize count() by EventType';

if (!fs.existsSync(CHROME)) {
  console.log(`[highlight-check] Chrome not found at ${CHROME}; skipping.`);
  process.exit(0);
}

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  console.log("[highlight-check] puppeteer-core not installed; skipping.");
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
  await page.waitForSelector(".monaco-editor", { timeout: 20000 });

  // Wait for the kusto language to register, then set the query on the model.
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const langs = window.monaco?.languages?.getLanguages?.() ?? [];
      if (langs.some((l) => l.id === "kusto")) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await page.evaluate((q) => {
    const editor = window.monaco?.editor?.getEditors?.()[0];
    editor?.getModel()?.setValue(q);
    editor?.focus();
  }, QUERY);

  // Give Monaco time to tokenize/colorize the new content.
  const analysis = await page.evaluate(async () => {
    const collect = () => {
      const spans = Array.from(
        document.querySelectorAll(".monaco-editor .view-lines span[class*='mtk']"),
      );
      const byClass = new Map();
      for (const s of spans) {
        const cls = Array.from(s.classList).find((c) => /^mtk\d+$/.test(c));
        if (!cls) continue;
        const color = getComputedStyle(s).color;
        if (!byClass.has(cls)) {
          byClass.set(cls, { color, samples: [] });
        }
        if (byClass.get(cls).samples.length < 4) {
          byClass.get(cls).samples.push(s.textContent);
        }
      }
      return byClass;
    };

    let byClass = new Map();
    for (let i = 0; i < 40; i++) {
      byClass = collect();
      if (byClass.size > 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const entries = Array.from(byClass.entries()).map(([cls, v]) => ({
      cls,
      color: v.color,
      samples: v.samples,
    }));

    // Find the color used by a keyword (`where`/`summarize`/`by`) vs a string ("TEXAS").
    const findColor = (pred) => {
      const hit = entries.find((e) => e.samples.some(pred));
      return hit ? hit.color : null;
    };
    const keywordColor = findColor((t) =>
      /\b(where|summarize|by)\b/i.test(t || ""),
    );
    const stringColor = findColor((t) => /TEXAS/.test(t || ""));

    return {
      distinctClasses: byClass.size,
      distinctColors: new Set(entries.map((e) => e.color)).size,
      keywordColor,
      stringColor,
      entries,
    };
  });

  console.log(JSON.stringify({ ...analysis, consoleErrors: errors.slice(0, 8) }, null, 2));

  await browser.close();

  const ok =
    analysis.distinctClasses > 1 &&
    analysis.distinctColors > 1 &&
    analysis.keywordColor &&
    analysis.stringColor &&
    analysis.keywordColor !== analysis.stringColor;

  if (!ok) {
    console.error("HIGHLIGHT CHECK FAILED: highlighting appears flat.");
    process.exit(1);
  }
  console.log("HIGHLIGHT CHECK PASSED");
})().catch((e) => {
  console.error("HIGHLIGHT CHECK ERROR:", e);
  process.exit(2);
});
