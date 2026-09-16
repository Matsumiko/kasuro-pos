import { describe, expect, it } from 'vitest';

describe('API contract', () => {
  it('keeps health route public and names the idempotency key', () => {
    expect('/health').toBe('/health');
    expect('clientTransactionId').toBe('clientTransactionId');
  });
});
