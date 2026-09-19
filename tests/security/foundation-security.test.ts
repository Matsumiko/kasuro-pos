import { describe, expect, it } from 'vitest';
import { memberOutletPredicate, outletScopedWhere, scopedWhere } from '@kasuro/db';
import { canTransitionSale, escapeCsvCell } from '@kasuro/domain';
import { isAllowedWebOrigin } from '../../apps/api/src/middleware/origin';
import app from '../../apps/api/src/index';
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

  it('adds an outlet membership predicate only for restricted members', () => {
    expect(memberOutletPredicate('s', true)).toEqual({ sql: '', placeholderCount: 0 });
    expect(memberOutletPredicate('s', false)).toEqual({
      sql: ' AND EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=s.outlet_id)',
      placeholderCount: 1,
    });
  });

  it('allows only forward refund transitions and never reopens a refunded sale', () => {
    expect(canTransitionSale('completed', 'partially_refunded')).toBe(true);
    expect(canTransitionSale('partially_refunded', 'refunded')).toBe(true);
    expect(canTransitionSale('refunded', 'completed')).toBe(false);
    expect(canTransitionSale('refunded', 'partially_refunded')).toBe(false);
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
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

  it('returns a client error for malformed JSON instead of leaking a server error', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      { ENVIRONMENT: 'local' },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
    });
  });

  it('sets baseline security headers on API responses', async () => {
    const response = await app.fetch(new Request('http://localhost/health'), {
      ENVIRONMENT: 'production',
      API_VERSION: 'test',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });
});
