import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerReportRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/reports', businessContext);
  app.use('/api/v1/businesses/:businessId/reports/*', businessContext);
  app.get('/api/v1/businesses/:businessId/reports/summary', async (c) => {
    const membership = requirePermission(c, 'reports.sales');
    if (!c.env.DB) return unavailable(c);
    const filters = await reportFilters(c, membership);
    if (filters.error) return filters.error;
    const sales = await c.env.DB.prepare(
      `SELECT COUNT(*) AS transaction_count,COALESCE(SUM(subtotal_minor),0) AS gross_sales_minor,COALESCE(SUM(discount_minor),0) AS discounts_minor,COALESCE(SUM(tax_minor),0) AS tax_minor,COALESCE(SUM(total_minor),0) AS net_sales_minor,COALESCE(SUM(cogs_minor),0) AS cogs_minor FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') AND date(created_at)>=date(?) AND date(created_at)<=date(?)${filters.scope}`,
    )
      .bind(...filters.binds)
      .first();
    const expenses = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor),0) AS expenses_minor FROM expenses WHERE business_id=? AND status='active' AND date(expense_date)>=date(?) AND date(expense_date)<=date(?)${filters.scope}`,
    )
      .bind(...filters.binds)
      .first();
    return c.json({ data: summary(sales, expenses) });
  });
  app.get('/api/v1/businesses/:businessId/reports/overview', async (c) => {
    const membership = requirePermission(c, 'reports.sales');
    if (!c.env.DB) return unavailable(c);
    const filters = await reportFilters(c, membership);
    if (filters.error) return filters.error;
    const [summaryRows, expenseRows, dailyRows, paymentRows, topProductRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS transaction_count,COALESCE(SUM(total_minor),0) AS net_sales_minor,COALESCE(SUM(cogs_minor),0) AS cogs_minor FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') AND date(created_at)>=date(?) AND date(created_at)<=date(?)${filters.scope}`,
      )
        .bind(...filters.binds)
        .first(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount_minor),0) AS expenses_minor FROM expenses WHERE business_id=? AND status='active' AND date(expense_date)>=date(?) AND date(expense_date)<=date(?)${filters.scope}`,
      )
        .bind(...filters.binds)
        .first(),
      c.env.DB.prepare(
        `SELECT date(created_at) AS report_date,COUNT(*) AS transaction_count,COALESCE(SUM(total_minor),0) AS net_sales_minor FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') AND date(created_at)>=date(?) AND date(created_at)<=date(?)${filters.scope} GROUP BY date(created_at) ORDER BY report_date ASC LIMIT 366`,
      )
        .bind(...filters.binds)
        .all(),
      c.env.DB.prepare(
        `SELECT p.method,COALESCE(SUM(p.amount_minor),0) AS amount_minor,COUNT(*) AS payment_count FROM sale_payments p JOIN sales s ON s.id=p.sale_id AND s.business_id=? WHERE s.status IN ('completed','partially_refunded','refunded') AND date(s.created_at)>=date(?) AND date(s.created_at)<=date(?)${filters.joinedScope} GROUP BY p.method ORDER BY amount_minor DESC LIMIT 20`,
      )
        .bind(...filters.binds)
        .all(),
      c.env.DB.prepare(
        `SELECT l.product_name,SUM(l.quantity) AS quantity,COALESCE(SUM(l.line_net_minor),0) AS net_sales_minor FROM sale_lines l JOIN sales s ON s.id=l.sale_id AND s.business_id=? WHERE s.status IN ('completed','partially_refunded','refunded') AND date(s.created_at)>=date(?) AND date(s.created_at)<=date(?)${filters.joinedScope} GROUP BY l.variant_id,l.product_name ORDER BY net_sales_minor DESC LIMIT 10`,
      )
        .bind(...filters.binds)
        .all(),
    ]);
    return c.json({
      data: {
        summary: summary(summaryRows, expenseRows),
        daily: dailyRows.results,
        payments: paymentRows.results,
        top_products: topProductRows.results,
      },
    });
  });
  app.get('/api/v1/businesses/:businessId/reports/export.csv', async (c) => {
    const membership = requirePermission(c, 'reports.export');
    if (!c.env.DB) return unavailable(c);
    const filters = await reportFilters(c, membership);
    if (filters.error) return filters.error;
    const rows = await c.env.DB.prepare(
      `SELECT 'sale' AS type,receipt_number AS reference,total_minor AS amount_minor,date(created_at) AS report_date,status FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') AND date(created_at)>=date(?) AND date(created_at)<=date(?)${filters.scope} UNION ALL SELECT 'expense' AS type,id AS reference,-amount_minor AS amount_minor,expense_date AS report_date,status FROM expenses WHERE business_id=? AND status='active' AND date(expense_date)>=date(?) AND date(expense_date)<=date(?)${filters.scope} ORDER BY report_date DESC LIMIT 2000`,
    )
      .bind(...filters.binds, ...filters.binds)
      .all<{
        type: string;
        reference: string | null;
        amount_minor: number;
        report_date: string;
        status: string;
      }>();
    const csv = [
      'type,reference,amount_minor,report_date,status',
      ...rows.results.map((row) =>
        [
          row.type,
          csvCell(row.reference ?? ''),
          row.amount_minor,
          row.report_date,
          row.status,
        ].join(','),
      ),
    ].join('\n');
    return new Response(`${csv}\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="kasuro-report.csv"',
      },
    });
  });
}
type ReportFilterResult = {
  scope: string;
  joinedScope: string;
  binds: Array<string | number>;
  error?: Response;
};

async function reportFilters(
  c: {
    req: { query: (name: string) => string | undefined };
    env: Env['Bindings'];
    json: (body: unknown, status?: number) => Response;
  },
  membership: { businessId: string; memberId: string; allOutlets: boolean },
): Promise<ReportFilterResult> {
  const from =
    c.req.query('date_from')?.trim() ||
    new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = c.req.query('date_to')?.trim() || new Date().toISOString().slice(0, 10);
  const outletId = c.req.query('outlet_id')?.trim() || '';
  if (!isoDate(from) || !isoDate(to) || from > to || daysBetween(from, to) > 366)
    return {
      scope: '',
      joinedScope: '',
      binds: [],
      error: c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Date range must be valid and at most 366 days',
          },
        },
        422,
      ),
    };
  if (outletId && c.env.DB && !(await canAccessOutlet(c.env.DB, membership, outletId)))
    return {
      scope: '',
      joinedScope: '',
      binds: [],
      error: c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
    };
  const scope = outletId ? ' AND outlet_id=?' : '';
  const joinedScope = outletId ? ' AND s.outlet_id=?' : '';
  const binds: Array<string | number> = [membership.businessId, from, to];
  if (outletId) binds.push(outletId);
  if (!membership.allOutlets) {
    const outletScope =
      ' AND (outlet_id IS NULL OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=outlet_id))';
    const joinedOutletScope =
      ' AND (s.outlet_id IS NULL OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=s.outlet_id))';
    binds.push(membership.memberId);
    return { scope: scope + outletScope, joinedScope: joinedScope + joinedOutletScope, binds };
  }
  return { scope, joinedScope, binds };
}

function summary(sales: unknown, expenses: unknown): Record<string, number> {
  const row = (sales ?? {}) as Record<string, unknown>;
  const expense = Number((expenses as Record<string, unknown> | null)?.expenses_minor ?? 0);
  const net = Number(row.net_sales_minor ?? 0);
  const cogs = Number(row.cogs_minor ?? 0);
  return {
    transaction_count: Number(row.transaction_count ?? 0),
    gross_sales_minor: Number(row.gross_sales_minor ?? net),
    discounts_minor: Number(row.discounts_minor ?? 0),
    tax_minor: Number(row.tax_minor ?? 0),
    net_sales_minor: net,
    cogs_minor: cogs,
    expenses_minor: expense,
    gross_profit_minor: net - cogs,
    operating_result_minor: net - cogs - expense,
  };
}

async function canAccessOutlet(
  db: D1Database,
  membership: { businessId: string; memberId: string; allOutlets: boolean },
  outletId: string,
): Promise<boolean> {
  const row = membership.allOutlets
    ? await db
        .prepare("SELECT id FROM outlets WHERE business_id=? AND id=? AND status='active'")
        .bind(membership.businessId, outletId)
        .first()
    : await db
        .prepare(
          "SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'",
        )
        .bind(membership.businessId, outletId, membership.memberId)
        .first();
  return Boolean(row);
}
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function isoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
