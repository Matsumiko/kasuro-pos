export type PendingSale = {
  clientTransactionId: string;
  businessId: string;
  outletId: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'synced' | 'conflict' | 'failed';
};

const DB_NAME = 'kasuro-offline-v1';
const STORE = 'pending_sales';

export async function openOfflineStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: 'clientTransactionId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queuePendingSale(sale: PendingSale): Promise<void> {
  const db = await openOfflineStore();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(sale);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function listPendingSales(): Promise<PendingSale[]> {
  const db = await openOfflineStore();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result as PendingSale[]);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
