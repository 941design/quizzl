import { spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const isGroups = !!process.env.E2E_GROUPS;
const RELAY_PORT = 7777;
const BLOSSOM_MOCK_PORT = 3001;

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

// Groups mode: wait for strfry relay and blossom-mock
if (isGroups) {
  console.log(`[e2e] Waiting for strfry relay on port ${RELAY_PORT}`);
  await waitForPort(RELAY_PORT);
  console.log("[e2e] Relay ready");
  console.log(`[e2e] Waiting for blossom-mock on port ${BLOSSOM_MOCK_PORT}`);
  await waitForPort(BLOSSOM_MOCK_PORT);
  console.log("[e2e] Blossom mock ready");
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;

const serverEnv = { ...process.env };
if (isGroups) {
  serverEnv.NEXT_PUBLIC_RELAYS = `ws://localhost:${RELAY_PORT}`;
  serverEnv.NEXT_PUBLIC_BLOSSOM_BASE_URL = `http://localhost:${BLOSSOM_MOCK_PORT}`;
}

const devServer = spawn(npxCommand, ["next", "dev", "--port", String(port)], {
  stdio: "inherit",
  detached: true,
  env: serverEnv,
});

function stopServer() {
  if (devServer.exitCode === null) {
    try {
      // Kill entire process group (detached) to ensure next dev is stopped
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
      // Keep polling until the dev server is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

try {
  await waitForServer();
  console.log(`[e2e] Dev server ready on ${baseUrl}`);

  const runner = spawn(npxCommand, ["playwright", "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      BASE_URL: baseUrl,
      E2E_GROUPS: process.env.E2E_GROUPS || "",
      BLOSSOM_BASE_URL: isGroups ? `http://localhost:${BLOSSOM_MOCK_PORT}` : "",
    },
  });

  const exitCode = await new Promise((resolve, reject) => {
    runner.on("exit", resolve);
    runner.on("error", reject);
  });

  stopServer();
  process.exit(exitCode ?? 1);
} catch (error) {
  stopServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
