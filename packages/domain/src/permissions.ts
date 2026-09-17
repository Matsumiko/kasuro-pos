export const PERMISSIONS = [
  'dashboard.view',
  'pos.use',
  'sales.view',
  'sales.create',
  'sales.discount',
  'sales.void',
  'sales.refund',
  'sales.reprint_receipt',
  'products.view',
  'products.create_update',
  'products.archive',
  'products.view_cost',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.stock_opname',
  'purchases.view_create',
  'purchases.receive',
  'customers.view_manage',
  'customers.credit_manage',
  'loyalty.manage',
  'suppliers.manage',
  'expenses.view_manage',
  'reports.sales',
  'reports.profit',
  'reports.inventory',
  'reports.export',
  'staff.view',
  'staff.invite',
  'staff.manage_roles',
  'outlets.view',
  'outlets.manage',
  'settings.view',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function hasPermission(granted: ReadonlySet<string>, permission: Permission): boolean {
  return granted.has(permission);
}
