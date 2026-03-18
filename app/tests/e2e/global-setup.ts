import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import net from 'net';

const APP_DIR = resolve(__dirname, '../..');
const PID_FILE = resolve(APP_DIR, '.e2e-server.pid');
const PORT = 3100;
const RELAY_PORT = 7777;

function waitForPort(port: number, host = 'localhost', timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        return;
      }
      const socket = net.createConnection({ port, host });
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

function waitForHttp(url: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryFetch = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`HTTP ${url} not ready after ${timeoutMs}ms`));
        return;
      }
      try {
        const resp = await fetch(url);
        const text = await resp.text();
        if (resp.ok && !text.includes('missing required error components')) {
          resolve();
          return;
        }
      } catch {
        // fetch failed, retry
      }
      setTimeout(tryFetch, 2_000);
    };
    tryFetch();
  });
}

export default async function globalSetup() {
  console.log('[e2e] Waiting for strfry relay on port', RELAY_PORT);
  await waitForPort(RELAY_PORT);
  console.log('[e2e] Relay ready');

  console.log('[e2e] Starting Next.js dev server on port', PORT, 'with local relay');
  const server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: APP_DIR,
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_RELAYS: 'ws://localhost:7777',
    },
  });
  server.unref();

  if (server.pid) {
    writeFileSync(PID_FILE, String(server.pid));
  }

  console.log('[e2e] Waiting for dev server on port', PORT);
  await waitForPort(PORT, 'localhost', 60_000);
  console.log('[e2e] Port open, waiting for HTTP readiness...');
  await waitForHttp(`http://localhost:${PORT}/groups/`, 120_000);
  console.log('[e2e] Dev server ready (PID:', server.pid, ')');
}
