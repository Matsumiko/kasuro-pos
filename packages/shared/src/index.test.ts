import { describe, expect, it } from 'vitest';
import { calculateChange, calculateSaleTotals } from './index';

describe('sale money calculations', () => {
  it('keeps integer totals deterministic across line discounts', () => {
    const totals = calculateSaleTotals([
      { productId: 'p1', sku: 'A', name: 'A', unit: 'pcs', price: 10001, quantity: 2, discount: 1 },
      { productId: 'p2', sku: 'B', name: 'B', unit: 'pcs', price: 9999, quantity: 1, discount: 0 },
    ], 500, 1100);
    expect(totals).toEqual({ subtotal: 30000, discount: 500, tax: 1100, total: 30600 });
  });

  it('calculates change from split payments without floating point drift', () => {
    expect(calculateChange(150000, [
      { method: 'cash', amount: 50000 },
      { method: 'qris', amount: 100000 },
    ])).toBe(0);
  });
});
