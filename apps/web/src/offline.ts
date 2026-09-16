import { openDB, type DBSchema } from 'idb';
import type { CheckoutPayload } from '@kasuro/shared';

interface KasuroDB extends DBSchema {
  pendingSales: { key: string; value: CheckoutPayload; indexes: { 'by-created': string } };
}

const database = openDB<KasuroDB>('kasuro-pos', 1, {
  upgrade(db) {
    const store = db.createObjectStore('pendingSales', { keyPath: 'clientTransactionId' });
    store.createIndex('by-created', 'clientTransactionId');
  },
});

export async function queueSale(payload: CheckoutPayload) {
  const db = await database;
  await db.put('pendingSales', payload);
}

export async function pendingSales() {
  const db = await database;
  return db.getAll('pendingSales');
}

export async function removePendingSale(clientTransactionId: string) {
  const db = await database;
  await db.delete('pendingSales', clientTransactionId);
}
