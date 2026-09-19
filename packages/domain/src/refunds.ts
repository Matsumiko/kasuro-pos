export type RefundableLine = {
  id: string;
  quantity: bigint;
  refundableQuantity: bigint;
  lineTotal: bigint;
};

export type RefundRequestLine = {
  saleLineId: string;
  quantity: bigint;
};

export function refundLineAmount(line: RefundableLine, quantity: bigint): bigint {
  if (line.quantity <= 0n || line.lineTotal < 0n || quantity <= 0n || quantity > line.refundableQuantity)
    throw new Error('Invalid refund quantity');
  return (line.lineTotal * quantity + line.quantity / 2n) / line.quantity;
}

export function refundTotal(
  lines: readonly RefundableLine[],
  request: readonly RefundRequestLine[],
): bigint {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  return request.reduce((total, item) => {
    if (seen.has(item.saleLineId)) throw new Error('Duplicate refund line');
    seen.add(item.saleLineId);
    const line = byId.get(item.saleLineId);
    if (!line) throw new Error('Refund line not found');
    return total + refundLineAmount(line, item.quantity);
  }, 0n);
}
