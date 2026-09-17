import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  canDecrement,
  parseMoney,
  priceLine,
  weightedAverageCost,
} from '@kasuro/domain';

describe('financial domain rules', () => {
  it('uses integer money and inclusive tax without floating point', () => {
    expect(parseMoney('125000')).toBe(125000n);
    expect(() => parseMoney('12.50')).toThrow();
    expect(
      priceLine(
        { id: 'a', quantity: 1n, unitPrice: 110000n, itemDiscount: 0n, taxRateBp: 1000n },
        'inclusive',
      ).tax,
    ).toBe(10000n);
  });

  it('caps discounts and allocates every minor unit deterministically', () => {
    const lines = [
      priceLine(
        { id: 'a', quantity: 1n, unitPrice: 100n, itemDiscount: 0n, taxRateBp: 0n },
        'exclusive',
      ),
      priceLine(
        { id: 'b', quantity: 1n, unitPrice: 50n, itemDiscount: 0n, taxRateBp: 0n },
        'exclusive',
      ),
    ];
    const allocation = allocateDiscount(lines, 101n);
    expect(allocation.get('a')).toBe(67n);
    expect(allocation.get('b')).toBe(34n);
    expect([...allocation.values()].reduce((sum, value) => sum + value, 0n)).toBe(101n);
  });

  it('computes exclusive tax after an item discount', () => {
    const line = priceLine(
      { id: 'a', quantity: 2n, unitPrice: 100n, itemDiscount: 25n, taxRateBp: 1000n },
      'exclusive',
    );
    expect(line.gross).toBe(200n);
    expect(line.itemDiscount).toBe(25n);
    expect(line.tax).toBe(18n);
    expect(line.net).toBe(193n);
  });

  it('enforces stock policy and weighted-average cost', () => {
    expect(canDecrement({ quantity: 1n, averageCost: 100n }, 2n, false)).toBe(false);
    expect(canDecrement({ quantity: 1n, averageCost: 100n }, 2n, true)).toBe(true);
    expect(weightedAverageCost({ quantity: 10n, averageCost: 100n }, 10n, 200n)).toBe(150n);
  });
});
