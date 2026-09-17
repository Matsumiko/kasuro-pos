export type BusinessScope = { businessId: string };
export type OutletScope = BusinessScope & { outletId: string };

export function assertBusinessScope(scope: BusinessScope): BusinessScope {
  if (!scope.businessId.trim()) throw new Error('Business scope is required');
  return scope;
}

export * from './ids';
export * from './inventory';
export * from './money';
export * from './permissions';
export * from './pricing';
export * from './csv';
export * from './state-machines';
