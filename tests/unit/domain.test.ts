import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  allocatePayments,
  canDecrement,
  canTransitionStockCount,
  canTransitionStockTransfer,
  cashDifference,
  expectedShiftCash,
  parseMoney,
  priceCart,
  priceLine,
  refundTotal,
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

describe('shift cash rules', () => {
  it('includes opening cash, sales, refunds, and signed movements', () => {
    const expected = expectedShiftCash({
      openingCashMinor: 100000n,
      cashSalesMinor: 25000n,
      cashRefundsMinor: 5000n,
      movements: [
        { movementType: 'cash_in', amountMinor: 10000n },
        { movementType: 'cash_out', amountMinor: 3000n },
      ],
    });
    expect(expected).toBe(127000n);
    expect(cashDifference(expected, 126500n)).toBe(-500n);
  });

  it('rejects negative values and non-positive movements', () => {
    expect(() =>
      expectedShiftCash({
        openingCashMinor: 0n,
        cashSalesMinor: 0n,
        cashRefundsMinor: 0n,
        movements: [{ movementType: 'cash_out', amountMinor: 0n }],
      }),
    ).toThrow();
  });
});

describe('POS checkout rules', () => {
  it('prices a cart with deterministic tax and discount totals', () => {
    const cart = priceCart(
      [
        { id: 'coffee', quantity: 2n, unitPrice: 100n, itemDiscount: 0n, taxRateBp: 1000n },
        { id: 'cake', quantity: 1n, unitPrice: 50n, itemDiscount: 0n, taxRateBp: 0n },
      ],
      25n,
      'exclusive',
    );
    expect(cart.subtotal).toBe(250n);
    expect(cart.discount).toBe(25n);
    expect(cart.tax).toBe(18n);
    expect(cart.total).toBe(243n);
  });

  it('allocates split payments and cash change without floating point', () => {
    const payments = allocatePayments(1000n, [
      { method: 'transfer', amount: 400n, reference: 'TRX-1' },
      { method: 'cash', amount: 700n },
    ]);
    expect(payments.map((payment) => payment.applied)).toEqual([400n, 600n]);
    expect(payments[1]?.change).toBe(100n);
  });

  it('rejects non-cash payments without a reference or over-large non-cash tender', () => {
    expect(() => allocatePayments(1000n, [{ method: 'qris', amount: 1000n }])).toThrow();
    expect(() =>
      allocatePayments(1000n, [{ method: 'transfer', amount: 1100n, reference: 'TRX-1' }]),
    ).toThrow();
  });
});

describe('refund allocation rules', () => {
  it('allocates the stored line total proportionally and rejects duplicates or excess quantity', () => {
    const lines = [
      { id: 'coffee', quantity: 3n, refundableQuantity: 3n, lineTotal: 100n },
      { id: 'cake', quantity: 1n, refundableQuantity: 1n, lineTotal: 50n },
    ];
    expect(refundTotal(lines, [{ saleLineId: 'coffee', quantity: 1n }])).toBe(33n);
    expect(refundTotal(lines, [{ saleLineId: 'coffee', quantity: 3n }, { saleLineId: 'cake', quantity: 1n }])).toBe(150n);
    expect(() => refundTotal(lines, [{ saleLineId: 'coffee', quantity: 1n }, { saleLineId: 'coffee', quantity: 1n }])).toThrow('Duplicate refund line');
    expect(() => refundTotal(lines, [{ saleLineId: 'coffee', quantity: 4n }])).toThrow('Invalid refund quantity');
  });
});

describe('inventory workflow transitions', () => {
  it('keeps unposted counts non-mutating and terminal states closed', () => {
    expect(canTransitionStockCount('counting', 'review')).toBe(true);
    expect(canTransitionStockCount('counting', 'posted')).toBe(false);
    expect(canTransitionStockCount('posted', 'counting')).toBe(false);
  });

  it('requires a sent transfer before receipt and makes receipt terminal', () => {
    expect(canTransitionStockTransfer('requested', 'sent')).toBe(true);
    expect(canTransitionStockTransfer('requested', 'received')).toBe(false);
    expect(canTransitionStockTransfer('sent', 'received')).toBe(true);
    expect(canTransitionStockTransfer('received', 'sent')).toBe(false);
  });
});
