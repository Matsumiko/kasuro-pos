export type Role = 'owner' | 'admin' | 'manager' | 'cashier' | 'inventory_staff';

export type Product = {
  id: string;
  businessId: string;
  categoryId: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  reorderPoint: number;
  imageUrl: string | null;
  isFavorite: boolean;
};

export type CartLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  quantity: number;
  discount: number;
};

export type SalePayment = {
  method: 'cash' | 'debit_card' | 'credit_card' | 'bank_transfer' | 'qris' | 'e_wallet' | 'custom';
  amount: number;
  reference?: string;
};

export type CheckoutPayload = {
  clientTransactionId: string;
  outletId: string;
  customerId?: string;
  lines: CartLine[];
  payments: SalePayment[];
  discount: number;
  tax: number;
  note?: string;
};

export type SaleTotals = { subtotal: number; discount: number; tax: number; total: number };

export type CheckoutResult = {
  saleId: string;
  receiptNumber: string;
  total: number;
  change: number;
  status: 'completed' | 'pending_sync';
};

export type ApiError = { error: { code: string; message: string; details?: unknown } };

export const PERMISSIONS = {
  createSale: 'sales.create',
  refundSale: 'sales.refund',
  adjustInventory: 'inventory.adjust',
  manageProducts: 'products.manage',
  viewReports: 'reports.view',
} as const;

export function calculateSaleTotals(lines: CartLine[], discount: number, tax: number) {
  const subtotal = lines.reduce((sum, line) => sum + (line.price * line.quantity) - line.discount, 0);
  const total = Math.max(0, subtotal - discount + tax);
  return { subtotal, discount, tax, total };
}

export function calculateChange(total: number, payments: SalePayment[]) {
  return payments.reduce((sum, payment) => sum + payment.amount, 0) - total;
}
