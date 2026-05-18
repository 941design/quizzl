/**
 * Returns true when stored and current differ as sets of pubkeys.
 * Order-independent; same identities in any order returns false.
 */
export function membersChanged(stored: string[], current: string[]): boolean {
  if (stored.length !== current.length) return true;
  const storedSet = new Set(stored);
  return !current.every((k) => storedSet.has(k));
}
