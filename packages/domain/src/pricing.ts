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
