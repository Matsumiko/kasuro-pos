export type SaleStatus =
  'draft' | 'held' | 'completed' | 'void' | 'partially_refunded' | 'refunded' | 'sync_conflict';
const SALE_TRANSITIONS: Record<SaleStatus, readonly SaleStatus[]> = {
  draft: ['held', 'completed', 'void'],
  held: ['draft', 'void'],
  completed: ['void', 'partially_refunded', 'refunded'],
  void: [],
  partially_refunded: ['refunded'],
  refunded: [],
  sync_conflict: ['completed', 'void'],
};

export function canTransitionSale(from: SaleStatus, to: SaleStatus): boolean {
  return SALE_TRANSITIONS[from].includes(to);
}

export function assertSaleTransition(from: SaleStatus, to: SaleStatus): void {
  if (!canTransitionSale(from, to)) throw new Error(`Invalid sale transition: ${from} -> ${to}`);
}
