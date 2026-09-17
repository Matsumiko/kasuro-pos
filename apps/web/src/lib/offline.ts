export type OfflineSalePayload = {
  business_id: string;
  outlet_id: string;
  register_id: string;
  shift_id: string;
  client_transaction_id: string;
  lines: Array<{ variant_id: string; quantity: number }>;
  payment: { method: 'cash'; amount_minor: number };
};

export type PendingOfflineSale = OfflineSalePayload & {
  idempotency_key: string;
  created_at: string;
  attempts: number;
  last_error?: string;
};

export type OfflineConflict = PendingOfflineSale & { reason: string };

const DB_NAME = 'kasuro-offline-v1';
const DB_VERSION = 1;
const PENDING_STORE = 'pending_sales';
const CONFLICT_STORE = 'sync_conflicts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING_STORE))
        db.createObjectStore(PENDING_STORE, { keyPath: 'client_transaction_id' });
      if (!db.objectStoreNames.contains(CONFLICT_STORE))
        db.createObjectStore(CONFLICT_STORE, { keyPath: 'client_transaction_id' });
      if (!db.objectStoreNames.contains('catalog_items'))
        db.createObjectStore('catalog_items', { keyPath: 'scope_key' });
      if (!db.objectStoreNames.contains('business_context'))
        db.createObjectStore('business_context', { keyPath: 'business_id' });
      if (!db.objectStoreNames.contains('catalog_updated_at'))
        db.createObjectStore('catalog_updated_at', { keyPath: 'business_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage unavailable'));
  });
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error('Offline storage read failed'));
  });
}

async function put(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Offline storage write failed'));
  });
}

async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Offline storage delete failed'));
  });
}

export async function queueOfflineSale(
  payload: OfflineSalePayload,
  error?: string,
): Promise<PendingOfflineSale> {
  const pending: PendingOfflineSale = {
    ...payload,
    idempotency_key: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    attempts: 0,
    ...(error ? { last_error: error } : {}),
  };
  await put(PENDING_STORE, pending);
  return pending;
}

export async function listPendingOfflineSales(): Promise<PendingOfflineSale[]> {
  return readAll<PendingOfflineSale>(PENDING_STORE);
}

export async function listOfflineConflicts(): Promise<OfflineConflict[]> {
  return readAll<OfflineConflict>(CONFLICT_STORE);
}

export async function syncOfflineSales(
  apiOrigin: string,
): Promise<{ synced: number; conflicts: number }> {
  const pending = await listPendingOfflineSales();
  let synced = 0;
  let conflicts = 0;
  for (const sale of pending) {
    try {
      const csrfToken =
        document.cookie
          .split('; ')
          .find((item) => item.startsWith('kasuro_csrf='))
          ?.split('=')[1] ?? '';
      const response = await fetch(
        `${apiOrigin}/api/v1/businesses/${sale.business_id}/sync/sales`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': sale.idempotency_key,
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(sale),
        },
      );
      if (response.ok) {
        await remove(PENDING_STORE, sale.client_transaction_id);
        synced += 1;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body: unknown = await response.json().catch(() => ({}));
        const reason =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          body.error &&
          typeof body.error === 'object' &&
          'message' in body.error &&
          typeof body.error.message === 'string'
            ? body.error.message
            : 'Sync ditolak';
        await put(CONFLICT_STORE, { ...sale, reason });
        await remove(PENDING_STORE, sale.client_transaction_id);
        conflicts += 1;
      } else {
        await put(PENDING_STORE, {
          ...sale,
          attempts: sale.attempts + 1,
          last_error: `HTTP ${response.status}`,
        });
      }
    } catch (error) {
      await put(PENDING_STORE, { ...sale, attempts: sale.attempts + 1, last_error: String(error) });
    }
  }
  return { synced, conflicts };
}

export type CachedCatalogItem = { variant_id: string; [key: string]: unknown };

export async function cacheCatalog(businessId: string, items: CachedCatalogItem[]): Promise<void> {
  await put('business_context', { business_id: businessId, updated_at: new Date().toISOString() });
  for (const item of items)
    await put('catalog_items', {
      scope_key: `${businessId}:${item.variant_id}`,
      business_id: businessId,
      item,
    });
  await put('catalog_updated_at', {
    business_id: businessId,
    updated_at: new Date().toISOString(),
  });
}

export async function readCachedCatalog<T>(businessId: string): Promise<T[]> {
  const items = await readAll<{ business_id: string; item: T }>('catalog_items');
  return items.filter((entry) => entry.business_id === businessId).map((entry) => entry.item);
}

export async function clearOfflineBusiness(businessId: string): Promise<void> {
  const items = await readAll<{ scope_key: string; business_id: string }>('catalog_items');
  for (const item of items.filter((entry) => entry.business_id === businessId))
    await remove('catalog_items', item.scope_key);
  await remove('business_context', businessId);
  await remove('catalog_updated_at', businessId);
}
