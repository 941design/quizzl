/**
 * Gate-remediation (Codex round 4): `runInviteExpiryCycle` must migrate legacy
 * records before every sweep, and must NOT sweep when migration fails —
 * otherwise un-migrated legacy expired links flood the bell (AC-INV-3,
 * Design Decision 3). These tests drive the orchestration with injected
 * collaborators, so the migrate-before-sweep ordering is verified without
 * mounting NotificationBell (this repo has no jsdom).
 */
import { describe, it, expect, vi } from 'vitest';
import { runInviteExpiryCycle, type InviteExpiryCycleDeps } from '@/src/lib/marmot/inviteExpirySweep';

function makeDeps(overrides: Partial<InviteExpiryCycleDeps> = {}): {
  deps: InviteExpiryCycleDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: InviteExpiryCycleDeps = {
    migrate: vi.fn(async () => {
      calls.push('migrate');
    }),
    sweep: vi.fn(async () => {
      calls.push('sweep');
    }),
    derive: vi.fn(async () => {
      calls.push('derive');
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe('runInviteExpiryCycle', () => {
  it('migrates BEFORE sweeping, then derives (happy path ordering)', async () => {
    const { deps, calls } = makeDeps();
    await runInviteExpiryCycle(1000, deps);
    // Ordering is load-bearing: migrate must fully resolve before sweep runs.
    expect(calls).toEqual(['migrate', 'sweep', 'derive']);
    expect(deps.migrate).toHaveBeenCalledWith(1000);
    expect(deps.sweep).toHaveBeenCalledWith(1000);
    expect(deps.derive).toHaveBeenCalledWith(1000);
  });

  it('does NOT sweep when migration rejects (flood-suppression guard)', async () => {
    const migrate = vi.fn(async () => {
      throw new Error('idb write failed at startup');
    });
    const { deps, calls } = makeDeps({ migrate });
    await expect(runInviteExpiryCycle(2000, deps)).resolves.toBeUndefined();
    // Sweep must be skipped so an un-migrated legacy expired link is never
    // treated as newly-expired; derive still runs (it never floods on its own).
    expect(deps.sweep).not.toHaveBeenCalled();
    expect(calls).toEqual(['derive']);
    expect(deps.derive).toHaveBeenCalledWith(2000);
  });

  it('still derives even if the sweep itself throws (non-fatal)', async () => {
    const sweep = vi.fn(async () => {
      throw new Error('one bad link');
    });
    const { deps } = makeDeps({ sweep });
    await expect(runInviteExpiryCycle(3000, deps)).resolves.toBeUndefined();
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.sweep).toHaveBeenCalled();
    expect(deps.derive).toHaveBeenCalledWith(3000);
  });

  it('runs migration on every invocation (interval covers post-startup legacy records)', async () => {
    const { deps } = makeDeps();
    await runInviteExpiryCycle(10, deps);
    await runInviteExpiryCycle(20, deps);
    await runInviteExpiryCycle(30, deps);
    // Migration is not a once-only mount step — each interval tick re-migrates
    // so a legacy backup restored while the app is open is suppressed before
    // the next sweep sees it.
    expect(deps.migrate).toHaveBeenCalledTimes(3);
    expect(deps.sweep).toHaveBeenCalledTimes(3);
  });

  // Gate-remediation (Codex round 7): the derive (initInviteExpiries) is async
  // and reads IDB. The cycle MUST await it, or a caller that awaits the cycle
  // observes a still-stale badge.
  it('does not resolve until the async derive settles', async () => {
    const order: string[] = [];
    let releaseDerive: () => void = () => {};
    const derivePending = new Promise<void>((r) => {
      releaseDerive = r;
    });
    const deps: InviteExpiryCycleDeps = {
      migrate: vi.fn(async () => {}),
      sweep: vi.fn(async () => {}),
      derive: vi.fn(async () => {
        await derivePending;
        order.push('derive-settled');
      }),
    };
    const cyclePromise = runInviteExpiryCycle(1, deps).then(() => order.push('cycle-resolved'));
    // Let microtasks flush; the cycle must still be pending on the derive.
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseDerive();
    await cyclePromise;
    // derive settled BEFORE the cycle resolved — proving the await.
    expect(order).toEqual(['derive-settled', 'cycle-resolved']);
  });

  it('does not reject when the derive rejects (badge keeps its previous value)', async () => {
    const derive = vi.fn(async () => {
      throw new Error('idb read failed during derive');
    });
    const { deps } = makeDeps({ derive });
    await expect(runInviteExpiryCycle(1, deps)).resolves.toBeUndefined();
    expect(deps.migrate).toHaveBeenCalled();
    expect(deps.sweep).toHaveBeenCalled();
    expect(derive).toHaveBeenCalled();
  });
});
