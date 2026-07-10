// Frontend runner for `tauri dev`.
//
// The Kusto language-service web worker depends on legacy Bridge.NET global
// scripts that only resolve when the worker is *bundled* (Rollup). Vite's dev
// server serves each module as separate native ESM, which breaks those globals
// and disables completion. So for `tauri dev` we build the frontend (watch mode)
// and serve the built output — identical to what `tauri build` ships — giving
// full KQL IntelliSense in development too.
//
// Flow: start `vite build --watch`, wait for the first build to emit
// dist/index.html, then serve dist with a tiny always-fresh static server on
// the Tauri dev port. A plain static server (rather than `vite preview`) is used
// so newly hashed assets from later rebuilds are picked up without a restart.
// Both the watcher and server are torn down when Tauri terminates this process.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, normalize, extname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const distIndex = join(dist, "index.html");
const PORT = Number(process.env.TAURI_FRONTEND_PORT || 1420);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const children = [];
let shuttingDown = false;

function run(args) {
  const child = spawn(npx, args, { cwd: root, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0 && !shuttingDown) {
      console.error(`[tauri-frontend] "${args.join(" ")}" exited: ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(0));
}

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  // Prevent path traversal, then map to a file under dist.
  const abs = normalize(join(dist, clean));
  if (!abs.startsWith(dist)) return null;
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  // SPA fallback: unknown routes serve index.html.
  return existsSync(distIndex) ? distIndex : null;
}

function serve() {
  const server = createServer((req, res) => {
    const file = resolveFile(req.url === "/" ? "/index.html" : req.url || "/");
    if (!file) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      // Never cache in dev so rebuilt assets are always fresh.
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
  server.listen(PORT, () => {
    console.log(`[tauri-frontend] serving dist on http://localhost:${PORT}/`);
  });
  return server;
}

run(["vite", "build", "--watch"]);

const deadline = Date.now() + 120_000;
while (!existsSync(distIndex)) {
  if (Date.now() > deadline) {
    console.error("[tauri-frontend] timed out waiting for first build");
    shutdown(1);
  }
  await delay(300);
}

serve();
