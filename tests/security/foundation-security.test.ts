import { describe, expect, it } from 'vitest';
import { outletScopedWhere, scopedWhere } from '@kasuro/db';
import { canTransitionSale, escapeCsvCell } from '@kasuro/domain';
import { isAllowedWebOrigin } from '../../apps/api/src/middleware/origin';

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
  it('allows trusted Pages previews but rejects lookalike origins', () => {
    expect(
      isAllowedWebOrigin(
        'https://ef6d8525.kasuro-pos-web.pages.dev',
        'https://kasuro-pos-web.pages.dev',
      ),
    ).toBe(true);
    expect(
      isAllowedWebOrigin(
        'https://kasuro-pos-web.pages.dev.attacker.example',
        'https://kasuro-pos-web.pages.dev',
      ),
    ).toBe(false);
    expect(
      isAllowedWebOrigin(
        'http://ef6d8525.kasuro-pos-web.pages.dev',
        'https://kasuro-pos-web.pages.dev',
      ),
    ).toBe(false);
  });
});
