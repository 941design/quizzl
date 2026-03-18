import { readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

const PID_FILE = resolve(__dirname, '../../.e2e-server.pid');

export default async function globalTeardown() {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (pid) {
      console.log('[e2e] Stopping static server (PID:', pid, ')');
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may already be gone
      }
    }
    unlinkSync(PID_FILE);
  } catch {
    // PID file doesn't exist, nothing to clean up
  }
}
