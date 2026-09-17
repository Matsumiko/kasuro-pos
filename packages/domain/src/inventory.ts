import { roundHalfUp, type Money } from './money';

export type InventoryBalance = { quantity: bigint; averageCost: Money };

export function weightedAverageCost(
  balance: InventoryBalance,
  receivedQuantity: bigint,
  receivedCost: Money,
): Money {
  if (receivedQuantity <= 0n || receivedCost < 0n) throw new Error('Invalid receipt');
  const oldValue = balance.quantity > 0n ? balance.quantity * balance.averageCost : 0n;
  const nextQuantity = balance.quantity + receivedQuantity;
  return roundHalfUp(oldValue + receivedQuantity * receivedCost, nextQuantity);
}

export function canDecrement(
  balance: InventoryBalance,
  quantity: bigint,
  allowNegative: boolean,
): boolean {
  if (quantity <= 0n) return false;
  return allowNegative || balance.quantity >= quantity;
}

export function decrement(
  balance: InventoryBalance,
  quantity: bigint,
  allowNegative: boolean,
): InventoryBalance {
  if (!canDecrement(balance, quantity, allowNegative)) throw new Error('INSUFFICIENT_STOCK');
  return { quantity: balance.quantity - quantity, averageCost: balance.averageCost };
}
