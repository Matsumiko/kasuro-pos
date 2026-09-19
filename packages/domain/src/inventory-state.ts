export type StockCountStatus = 'draft' | 'counting' | 'review' | 'approved' | 'posted' | 'cancelled';
export type StockTransferStatus =
  | 'draft'
  | 'requested'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

const STOCK_COUNT_TRANSITIONS: Record<StockCountStatus, readonly StockCountStatus[]> = {
  draft: ['counting', 'cancelled'],
  counting: ['review', 'cancelled'],
  review: ['approved', 'counting', 'cancelled'],
  approved: ['posted', 'counting', 'cancelled'],
  posted: [],
  cancelled: [],
};

const STOCK_TRANSFER_TRANSITIONS: Record<StockTransferStatus, readonly StockTransferStatus[]> = {
  draft: ['requested', 'cancelled'],
  requested: ['approved', 'sent', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export function canTransitionStockCount(from: StockCountStatus, to: StockCountStatus): boolean {
  return STOCK_COUNT_TRANSITIONS[from].includes(to);
}

export function canTransitionStockTransfer(
  from: StockTransferStatus,
  to: StockTransferStatus,
): boolean {
  return STOCK_TRANSFER_TRANSITIONS[from].includes(to);
}
