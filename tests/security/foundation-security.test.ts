import { describe, expect, it } from 'vitest';
import { outletScopedWhere, scopedWhere } from '@kasuro/db';
import { canTransitionSale, escapeCsvCell } from '@kasuro/domain';

describe('security and data boundaries', () => {
  it('requires tenant predicates before resource selectors', () => {
    expect(scopedWhere({ businessId: 'business-a' })).toEqual({
      sql: 'business_id = ?',
      bindings: ['business-a'],
    });
    expect(outletScopedWhere({ businessId: 'business-a', outletId: 'outlet-a' }).sql).toBe(
      'business_id = ? AND outlet_id = ?',
    );
  });

  it('rejects invalid sale transitions and spreadsheet formulas', () => {
    expect(canTransitionSale('completed', 'held')).toBe(false);
    expect(canTransitionSale('completed', 'partially_refunded')).toBe(true);
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell('text,with,commas')).toBe('"text,with,commas"');
  });
});
