import { describe, expect, it } from 'vitest';
import { assertBusinessScope } from '@kasuro/domain';

describe('foundation boundaries', () => {
  it('requires a business scope for tenant rules', () => {
    expect(assertBusinessScope({ businessId: 'business-a' })).toEqual({ businessId: 'business-a' });
    expect(() => assertBusinessScope({ businessId: ' ' })).toThrow('Business scope is required');
  });
});
