export type CashMovement = {
  movementType: 'cash_in' | 'cash_out';
  amountMinor: bigint;
};

export type ShiftCashInput = {
  openingCashMinor: bigint;
  cashSalesMinor: bigint;
  cashRefundsMinor: bigint;
  movements: readonly CashMovement[];
};

export function expectedShiftCash(input: ShiftCashInput): bigint {
  if (input.openingCashMinor < 0n || input.cashSalesMinor < 0n || input.cashRefundsMinor < 0n)
    throw new Error('Shift cash values cannot be negative');
  const movementTotal = input.movements.reduce((total, movement) => {
    if (movement.amountMinor <= 0n) throw new Error('Cash movement must be positive');
    return total + (movement.movementType === 'cash_in' ? movement.amountMinor : -movement.amountMinor);
  }, 0n);
  return input.openingCashMinor + input.cashSalesMinor - input.cashRefundsMinor + movementTotal;
}

export function cashDifference(expectedMinor: bigint, actualMinor: bigint): bigint {
  if (expectedMinor < 0n || actualMinor < 0n) throw new Error('Cash totals cannot be negative');
  return actualMinor - expectedMinor;
}
