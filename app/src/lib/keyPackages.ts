/**
 * KeyPackage publication utilities.
 * Publishes kind 443 KeyPackages to Nostr relays using the MarmotClient.
 * Called on first app launch and when key package count drops below threshold.
 */

import { DEFAULT_RELAYS } from '@/src/types';

export const KEY_PACKAGE_COUNT = 5;
export const KEY_PACKAGE_REPLENISH_THRESHOLD = 2;

/**
 * Publish `count` key packages for the given MarmotClient.
 * Wraps the operation in try/catch — marmot-ts is alpha.
 * Returns the number of successfully published key packages.
 */
export async function publishKeyPackages(
  keyPackageManager: import('@internet-privacy/marmot-ts').KeyPackageManager,
  count: number = KEY_PACKAGE_COUNT,
  relays: string[] = [...DEFAULT_RELAYS]
): Promise<number> {
  let published = 0;
  for (let i = 0; i < count; i++) {
    try {
      await keyPackageManager.create({
        relays,
        isLastResort: i === count - 1, // last one is last-resort
        client: 'quizzl',
      });
      published++;
    } catch (err) {
      console.warn(`[keyPackages] Failed to publish key package ${i + 1}:`, err);
      // Continue — partial success is acceptable
    }
  }
  return published;
}

/**
 * Check how many unused local key packages exist.
 * Returns the count.
 */
export async function countAvailableKeyPackages(
  keyPackageManager: import('@internet-privacy/marmot-ts').KeyPackageManager
): Promise<number> {
  try {
    const packages = await keyPackageManager.list();
    return packages.filter((p) => !p.used).length;
  } catch {
    return 0;
  }
}

/**
 * Replenish key packages if below threshold.
 */
export async function replenishKeyPackagesIfNeeded(
  keyPackageManager: import('@internet-privacy/marmot-ts').KeyPackageManager,
  relays: string[] = [...DEFAULT_RELAYS]
): Promise<void> {
  const available = await countAvailableKeyPackages(keyPackageManager);
  if (available < KEY_PACKAGE_REPLENISH_THRESHOLD) {
    const needed = KEY_PACKAGE_COUNT - available;
    await publishKeyPackages(keyPackageManager, needed, relays);
  }
}
