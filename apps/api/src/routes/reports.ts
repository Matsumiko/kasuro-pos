import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerReportRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/reports', businessContext);
  app.use('/api/v1/businesses/:businessId/reports/*', businessContext);
  app.get('/api/v1/businesses/:businessId/reports/summary', async (c) => {
    const membership = requirePermission(c, 'reports.sales');
    if (!c.env.DB) return unavailable(c);
    const outletId = c.req.query('outlet_id');
    const dateFrom = c.req.query('date_from') ?? '1970-01-01';
    const dateTo = c.req.query('date_to') ?? '2999-12-31';
    const scope = outletId ? ' AND outlet_id=?' : '';
    const binds = outletId
      ? [membership.businessId, dateFrom, dateTo, outletId]
      : [membership.businessId, dateFrom, dateTo];
    const sales = await c.env.DB.prepare(
      `SELECT COUNT(*) AS transaction_count,COALESCE(SUM(subtotal_minor),0) AS gross_sales_minor,COALESCE(SUM(discount_minor),0) AS discounts_minor,COALESCE(SUM(tax_minor),0) AS tax_minor,COALESCE(SUM(total_minor),0) AS net_sales_minor,COALESCE(SUM(cogs_minor),0) AS cogs_minor FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') AND date(created_at)>=date(?) AND date(created_at)<=date(?)${scope}`,
    )
      .bind(...binds)
      .first();
    const expenses = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor),0) AS expenses_minor FROM expenses WHERE business_id=? AND status='active' AND date(expense_date)>=date(?) AND date(expense_date)<=date(?)${scope}`,
    )
      .bind(...binds)
      .first();
    return c.json({
      data: {
        ...sales,
        expenses_minor: expenses?.expenses_minor ?? 0,
        gross_profit_minor: Number(sales?.net_sales_minor ?? 0) - Number(sales?.cogs_minor ?? 0),
        operating_result_minor:
          Number(sales?.net_sales_minor ?? 0) -
          Number(sales?.cogs_minor ?? 0) -
          Number(expenses?.expenses_minor ?? 0),
      },
    });
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
