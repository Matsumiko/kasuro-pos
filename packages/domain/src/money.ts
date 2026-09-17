export type Money = bigint;

export function parseMoney(value: string): Money {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Money must be a non-negative integer string');
  return BigInt(value);
}

export function formatMoney(value: Money, currency = 'IDR'): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  return (numerator + denominator / 2n) / denominator;
}
