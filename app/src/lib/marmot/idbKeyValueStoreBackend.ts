import { get, set, del, clear, keys } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';

export class IdbKeyValueStoreBackend<T> {
  constructor(private readonly store: UseStore) {}

  async getItem(key: string): Promise<T | null> {
    const val = await get<T>(key, this.store);
    return val ?? null;
  }

  async setItem(key: string, value: T): Promise<T> {
    await set(key, value, this.store);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await del(key, this.store);
  }

  async clear(): Promise<void> {
    await clear(this.store);
  }

  async keys(): Promise<string[]> {
    const allKeys = await keys<string>(this.store);
    return allKeys;
  }
}
