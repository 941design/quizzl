/**
 * Serve the generated UI documentation gallery over local HTTP so it opens in a
 * browser with every screenshot loading correctly (opening index.html straight
 * off disk works too, but a server avoids any file:// quirks and gives a URL you
 * can hand to a colleague on the same machine/network).
 *
 * Zero dependencies — a minimal static file server rooted at the gallery output.
 * Does NOT regenerate anything; run `make screenshots` first to (re)build it.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const ROOT = process.env.SCREENSHOTS_OUT
  ? path.resolve(process.env.SCREENSHOTS_OUT)
  : path.join(APP_DIR, "screenshots-out");

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error(`[serve] No gallery at ${ROOT}/index.html`);
  console.error(`[serve] Generate it first:  make screenshots`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    // Resolve inside ROOT and reject any traversal outside it.
    const filePath = path.join(ROOT, rel);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch {
    res.writeHead(500).end("Server error");
  }
});

const startPort = Number(process.env.PORT) || 8080;

function listen(port, attemptsLeft) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`[serve] ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`[serve] UI documentation gallery: ${url}`);
    console.log(`[serve] Serving ${ROOT}`);
    console.log(`[serve] Press Ctrl-C to stop.`);
    // Best-effort browser open; never fail the server if it doesn't work.
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    try {
      const child = spawn(opener, [url], { stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
    } catch {
      /* headless / no opener — the printed URL is enough */
    }
  });
}

listen(startPort, 20);

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
