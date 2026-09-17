export type TenantScope = { businessId: string };
export type OutletTenantScope = TenantScope & { outletId: string };

export function scopedWhere(scope: TenantScope): { sql: string; bindings: string[] } {
  if (!scope.businessId.trim()) throw new Error('businessId is required');
  return { sql: 'business_id = ?', bindings: [scope.businessId] };
}

export function outletScopedWhere(scope: OutletTenantScope): { sql: string; bindings: string[] } {
  if (!scope.outletId.trim()) throw new Error('outletId is required');
  const tenant = scopedWhere(scope);
  return { sql: `${tenant.sql} AND outlet_id = ?`, bindings: [...tenant.bindings, scope.outletId] };
}
