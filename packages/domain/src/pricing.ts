import { roundHalfUp, type Money } from './money';

export type CartLine = {
  id: string;
  quantity: bigint;
  unitPrice: Money;
  itemDiscount: Money;
  taxRateBp: bigint;
};

export type PricedLine = CartLine & { gross: Money; net: Money; tax: Money };

export function priceLine(line: CartLine, taxMode: 'inclusive' | 'exclusive'): PricedLine {
  if (line.quantity <= 0n || line.unitPrice < 0n || line.itemDiscount < 0n)
    throw new Error('Invalid line values');
  const gross = line.quantity * line.unitPrice;
  const discount = line.itemDiscount > gross ? gross : line.itemDiscount;
  const taxableBase = gross - discount;
  const tax =
    taxMode === 'inclusive'
      ? roundHalfUp(taxableBase * line.taxRateBp, 10000n + line.taxRateBp)
      : roundHalfUp(taxableBase * line.taxRateBp, 10000n);
  const net = taxMode === 'inclusive' ? taxableBase : taxableBase + tax;
  return { ...line, itemDiscount: discount, gross, net, tax };
}

export function allocateDiscount(
  lines: readonly PricedLine[],
  discount: Money,
): Map<string, Money> {
  const subtotal = lines.reduce((sum, line) => sum + line.gross - line.itemDiscount, 0n);
  const requested = discount < 0n ? 0n : discount > subtotal ? subtotal : discount;
  const result = new Map<string, Money>();
  if (requested === 0n || subtotal === 0n)
    return lines.reduce((map, line) => map.set(line.id, 0n), result);
  let allocated = 0n;
  const remainders: Array<{ id: string; remainder: bigint }> = [];
  for (const line of lines) {
    const base = line.gross - line.itemDiscount;
    const numerator = requested * base;
    const share = numerator / subtotal;
    result.set(line.id, share);
    allocated += share;
    remainders.push({ id: line.id, remainder: numerator % subtotal });
  }
  remainders.sort((a, b) =>
    b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.id.localeCompare(b.id),
  );
  let remainder = requested - allocated;
  for (const item of remainders) {
    if (remainder === 0n) break;
    result.set(item.id, result.get(item.id)! + 1n);
    remainder -= 1n;
  }
  return result;
}
export type PricedCart = {
  lines: PricedLine[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
};

export function priceCart(
  lines: readonly CartLine[],
  discount: Money,
  taxMode: 'inclusive' | 'exclusive',
): PricedCart {
  const baseLines = lines.map((line) => priceLine(line, taxMode));
  const allocation = allocateDiscount(baseLines, discount);
  const pricedLines = baseLines.map((line) =>
    priceLine(
      { ...line, itemDiscount: line.itemDiscount + (allocation.get(line.id) ?? 0n) },
      taxMode,
    ),
  );
  const subtotal = baseLines.reduce((sum, line) => sum + line.gross - line.itemDiscount, 0n);
  const allocatedDiscount = [...allocation.values()].reduce((sum, value) => sum + value, 0n);
  const tax = pricedLines.reduce((sum, line) => sum + line.tax, 0n);
  const total = pricedLines.reduce((sum, line) => sum + line.net, 0n);
  return { lines: pricedLines, subtotal, discount: allocatedDiscount, tax, total };
}

export type PaymentInput = {
  method: 'cash' | 'transfer' | 'qris';
  amount: Money;
  reference?: string;
};

export type AllocatedPayment = PaymentInput & {
  applied: Money;
  received: Money;
  change: Money;
};

export function allocatePayments(
  total: Money,
  payments: readonly PaymentInput[],
): AllocatedPayment[] {
  if (total < 0n || payments.length === 0) throw new Error('Payment is required');
  if (payments.filter((payment) => payment.method === 'cash').length > 1)
    throw new Error('Only one cash payment is allowed');
  if (payments.some((payment) => payment.amount <= 0n))
    throw new Error('Payment amount is invalid');
  if (payments.some((payment) => payment.method !== 'cash' && !payment.reference?.trim()))
    throw new Error('Non-cash payment reference is required');
  const nonCashTotal = payments
    .filter((payment) => payment.method !== 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0n);
  if (nonCashTotal > total || payments.reduce((sum, payment) => sum + payment.amount, 0n) < total)
    throw new Error('Payment does not cover total');
  let remaining = total;
  const applied = payments.map(() => 0n);
  payments.forEach((payment, index) => {
    if (payment.method === 'cash') return;
    applied[index] = payment.amount < remaining ? payment.amount : remaining;
    remaining -= applied[index];
  });
  payments.forEach((payment, index) => {
    if (payment.method !== 'cash') return;
    applied[index] = payment.amount < remaining ? payment.amount : remaining;
    remaining -= applied[index];
  });
  return payments.map((payment, index) => {
    const appliedAmount = applied[index] ?? 0n;
    return {
      ...payment,
      applied: appliedAmount,
      received: payment.amount,
      change: payment.method === 'cash' ? payment.amount - appliedAmount : 0n,
    };
  });
}
