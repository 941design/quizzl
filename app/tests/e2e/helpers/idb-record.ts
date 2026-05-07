import type { Page } from '@playwright/test';

/**
 * Delete a single keyed record from a named IndexedDB store.
 *
 * Works for any idb-keyval or raw IndexedDB store. Leaves all other records intact.
 *
 * FIXTURE-07-002 — permanent test infrastructure.
 */
export async function deleteIdbRecord(
  page: Page,
  dbName: string,
  storeName: string,
  key: string,
): Promise<void> {
  await page.evaluate(
    ({ dbName: db, storeName: store, key: k }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db);
        req.onsuccess = () => {
          const database = req.result;
          let tx: IDBTransaction;
          try {
            tx = database.transaction(store, 'readwrite');
          } catch {
            // Store may not exist if database was never written to
            database.close();
            resolve();
            return;
          }
          const objStore = tx.objectStore(store);
          const del = objStore.delete(k);
          del.onsuccess = () => { database.close(); resolve(); };
          del.onerror = () => { database.close(); reject(del.error); };
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // resolve if blocked to avoid hanging
      }),
    { dbName, storeName, key },
  );
}

/**
 * Read a single record from a named IndexedDB store.
 * Returns null if the record is absent.
 */
export async function readIdbRecord<T = unknown>(
  page: Page,
  dbName: string,
  storeName: string,
  key: string,
): Promise<T | null> {
  return page.evaluate(
    ({ dbName: db, storeName: store, key: k }) =>
      new Promise<unknown>((resolve, reject) => {
        const req = indexedDB.open(db);
        req.onsuccess = () => {
          const database = req.result;
          let tx: IDBTransaction;
          try {
            tx = database.transaction(store, 'readonly');
          } catch {
            database.close();
            resolve(null);
            return;
          }
          const objStore = tx.objectStore(store);
          const get = objStore.get(k);
          get.onsuccess = () => { database.close(); resolve(get.result ?? null); };
          get.onerror = () => { database.close(); reject(get.error); };
        };
        req.onerror = () => reject(req.error);
      }),
    { dbName, storeName, key },
  ) as Promise<T | null>;
}

/**
 * Write a single record to a named IndexedDB store.
 */
export async function writeIdbRecord(
  page: Page,
  dbName: string,
  storeName: string,
  key: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    ({ dbName: db, storeName: store, key: k, value: v }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db);
        req.onsuccess = () => {
          const database = req.result;
          const tx = database.transaction(store, 'readwrite');
          const objStore = tx.objectStore(store);
          const put = objStore.put(v, k);
          put.onsuccess = () => { database.close(); resolve(); };
          put.onerror = () => { database.close(); reject(put.error); };
        };
        req.onerror = () => reject(req.error);
      }),
    { dbName, storeName, key, value },
  );
}
