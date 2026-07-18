/**
 * Orchestrates the documentation-screenshot run:
 *   1. wait for the strfry relay + blossom mock (brought up by `make screenshots`)
 *   2. boot `next dev` on a random free port (relay-wired, like run-e2e.mjs)
 *   3. run the Playwright capture (playwright.screenshots.config.ts)
 *   4. build the browsable HTML gallery from the emitted manifest.json
 *   5. tear the dev server down
 *
 * Populated states (groups, DMs, contacts) need the relay, so this always runs
 * in relay mode — the Make target owns the Docker lifecycle around it.
 */
import { spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const nodeCommand = process.execPath;
const RELAY_PORT = 7777;
const BLOSSOM_MOCK_PORT = 3001;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const OUT_DIR = process.env.SCREENSHOTS_OUT
  ? path.resolve(process.env.SCREENSHOTS_OUT)
  : path.join(APP_DIR, "screenshots-out");

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a local port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForPort(port, host = "localhost", timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        return;
      }
      const socket = createConnection({ port, host });
      socket.on("connect", () => { socket.destroy(); resolve(); });
      socket.on("error", () => { socket.destroy(); setTimeout(tryConnect, 500); });
    };
    tryConnect();
  });
}

console.log(`[screenshots] Waiting for strfry relay on port ${RELAY_PORT}`);
await waitForPort(RELAY_PORT);
console.log("[screenshots] Relay ready");
console.log(`[screenshots] Waiting for blossom-mock on port ${BLOSSOM_MOCK_PORT}`);
await waitForPort(BLOSSOM_MOCK_PORT);
console.log("[screenshots] Blossom mock ready");

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;

const serverEnv = { ...process.env };
serverEnv.NEXT_PUBLIC_RELAYS = `ws://localhost:${RELAY_PORT}`;
serverEnv.NEXT_PUBLIC_BLOSSOM_BASE_URL = `http://localhost:${BLOSSOM_MOCK_PORT}`;
// Same maintainer identity the e2e suite pins (USER_B) so the feedback channel
// renders as available rather than "unavailable".
serverEnv.NEXT_PUBLIC_MAINTAINER_NPUBS =
  'npub14cjwfhp3fpfafzj0prkz6jjlwvkmrlq8a6xjccgugyfj3wlq2scq9267f9';

const devServer = spawn(npxCommand, ["next", "dev", "--port", String(port)], {
  stdio: "inherit",
  detached: true,
  env: serverEnv,
});

function stopServer() {
  if (devServer.exitCode === null) {
    try {
      process.kill(-devServer.pid, "SIGTERM");
    } catch {
      try { devServer.kill("SIGTERM"); } catch { /* already dead */ }
    }
  }
}

process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

async function waitForServer(timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (devServer.exitCode !== null) {
      throw new Error(`Dev server exited early with code ${devServer.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

try {
  await waitForServer();
  console.log(`[screenshots] Dev server ready on ${baseUrl}`);

  const captureCode = await run(
    npxCommand,
    ["playwright", "test", "--config=playwright.screenshots.config.ts"],
    { ...process.env, BASE_URL: baseUrl, SCREENSHOTS_OUT: OUT_DIR },
  );
  // Capture is best-effort per screen; only a hard runner crash should abort
  // before we build the gallery from whatever manifest was written.

  const galleryCode = await run(
    nodeCommand,
    [path.join(APP_DIR, "scripts", "build-gallery.mjs")],
    { ...process.env, SCREENSHOTS_OUT: OUT_DIR },
  );

  stopServer();
  process.exit(captureCode === 0 ? galleryCode : captureCode);
} catch (error) {
  stopServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
