import { readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

const PID_FILE = resolve(__dirname, '../../.e2e-server.pid');

export default async function globalTeardown() {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (pid) {
      console.log('[e2e] Stopping dev server (PID group:', -pid, ')');
      try {
        // Kill the entire process group (negative PID) since the server was
        // spawned with detached:true. Killing only the npx wrapper leaves
        // the actual next dev process alive, holding the port.
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process group may already be gone; try the single PID as fallback
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      }
    }
    unlinkSync(PID_FILE);
  } catch {
    // PID file doesn't exist, nothing to clean up
  }
}
