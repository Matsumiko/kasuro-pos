import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission, type MembershipContext } from '../middleware/tenant';

export function registerExpenseRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/expenses', businessContext);
  app.use('/api/v1/businesses/:businessId/expenses/*', businessContext);
  app.get('/api/v1/businesses/:businessId/expenses', async (c) => {
    const membership = requirePermission(c, 'expenses.view_manage');
    if (!c.env.DB) return unavailable(c);
    const from = c.req.query('from')?.trim() ?? '';
    const to = c.req.query('to')?.trim() ?? '';
    const outletId = c.req.query('outlet_id')?.trim() ?? '';
    if ((from && !isoDate(from)) || (to && !isoDate(to)))
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid expense date filter' } },
        422,
      );
    if (outletId && !(await canAccessOutlet(c.env.DB, membership, outletId))) return notFound(c);
    const result = await c.env.DB.prepare(
      `SELECT e.id,e.outlet_id,e.amount_minor,e.category,e.description,e.expense_date,e.payment_method,e.status,e.created_at,o.name AS outlet_name
       FROM expenses e LEFT JOIN outlets o ON o.id=e.outlet_id AND o.business_id=e.business_id
       WHERE e.business_id=? AND e.status='active' AND (?='' OR e.expense_date>=?) AND (?='' OR e.expense_date<=?) AND (?='' OR e.outlet_id=?)
       AND (?=1 OR e.outlet_id IS NULL OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=e.outlet_id))
       ORDER BY e.expense_date DESC,e.created_at DESC LIMIT 100`,
    )
      .bind(
        membership.businessId,
        from,
        from,
        to,
        to,
        outletId,
        outletId,
        membership.allOutlets ? 1 : 0,
        membership.memberId,
      )
      .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/expenses/:expenseId', async (c) => {
    const membership = requirePermission(c, 'expenses.view_manage');
    if (!c.env.DB) return unavailable(c);
    const expense = await c.env.DB.prepare(
      `SELECT e.id,e.outlet_id,e.amount_minor,e.category,e.description,e.expense_date,e.payment_method,e.status,e.created_at,e.updated_at,o.name AS outlet_name
       FROM expenses e LEFT JOIN outlets o ON o.id=e.outlet_id AND o.business_id=e.business_id
       WHERE e.business_id=? AND e.id=?`,
    )
      .bind(membership.businessId, c.req.param('expenseId'))
      .first<{ outlet_id: string | null }>();
    if (
      !expense ||
      (expense.outlet_id && !(await canAccessOutlet(c.env.DB, membership, expense.outlet_id)))
    )
      return notFound(c);
    return c.json({ data: expense });
  });
  app.post('/api/v1/businesses/:businessId/expenses', async (c) => {
    const membership = requirePermission(c, 'expenses.view_manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      outlet_id?: string;
      amount_minor?: string | number;
      category?: string;
      description?: string;
      expense_date?: string;
      payment_method?: string;
    }>();
    const amount = integer(body.amount_minor);
    const category = body.category?.trim();
    const description = body.description?.trim();
    const paymentMethod = body.payment_method?.trim();
    if (
      !amount ||
      amount <= 0 ||
      !category ||
      category.length > 80 ||
      !description ||
      description.length > 500 ||
      !body.expense_date ||
      !isoDate(body.expense_date) ||
      !paymentMethod ||
      paymentMethod.length > 40
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Expense fields are invalid' } },
        422,
      );
    if (body.outlet_id && !(await canAccessOutlet(c.env.DB, membership, body.outlet_id)))
      return notFound(c);
    const now = new Date().toISOString();
    const id = createId();
    await c.env.DB.prepare(
      `INSERT INTO expenses(id,business_id,outlet_id,amount_minor,category,description,expense_date,payment_method,actor_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        membership.businessId,
        body.outlet_id ?? null,
        amount,
        category,
        description,
        body.expense_date,
        paymentMethod,
        membership.memberId,
        now,
        now,
      )
      .run();
    return c.json({ data: { id, amount_minor: amount, category, status: 'active' } }, 201);
  });
  app.patch('/api/v1/businesses/:businessId/expenses/:expenseId', async (c) => {
    const membership = requirePermission(c, 'expenses.view_manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      status?: 'active' | 'archived';
      description?: string;
      amount_minor?: string | number;
    }>();
    const amount = body.amount_minor === undefined ? undefined : integer(body.amount_minor);
    if (body.amount_minor !== undefined && (amount === undefined || amount <= 0))
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Amount must be positive' } },
        422,
      );
    if (body.status && body.status !== 'active' && body.status !== 'archived')
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 422);
    if (
      body.description !== undefined &&
      (!body.description.trim() || body.description.trim().length > 500)
    )
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid description' } }, 422);
    const current = await c.env.DB.prepare(
      'SELECT outlet_id FROM expenses WHERE business_id=? AND id=?',
    )
      .bind(membership.businessId, c.req.param('expenseId'))
      .first<{ outlet_id: string | null }>();
    if (
      !current ||
      (current.outlet_id && !(await canAccessOutlet(c.env.DB, membership, current.outlet_id)))
    )
      return notFound(c);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.status) {
      fields.push('status=?');
      values.push(body.status);
    }
    if (body.description !== undefined) {
      fields.push('description=?');
      values.push(body.description.trim());
    }
    if (amount !== undefined) {
      fields.push('amount_minor=?');
      values.push(amount);
    }
    if (!fields.length)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No changes supplied' } }, 422);
    fields.push('updated_at=?');
    values.push(new Date().toISOString(), membership.businessId, c.req.param('expenseId'));
    const result = await c.env.DB.prepare(
      `UPDATE expenses SET ${fields.join(',')} WHERE business_id=? AND id=?`,
    )
      .bind(...values)
      .run();
    if (!result.meta.changes) return notFound(c);
    return c.json({ data: { id: c.req.param('expenseId'), updated: true } });
  });
}
async function canAccessOutlet(
  db: D1Database,
  membership: MembershipContext,
  outletId: string,
): Promise<boolean> {
  const row = membership.allOutlets
    ? await db
        .prepare("SELECT id FROM outlets WHERE business_id=? AND id=? AND status='active'")
        .bind(membership.businessId, outletId)
        .first()
    : await db
        .prepare(
          `SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id
           WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'`,
        )
        .bind(membership.businessId, outletId, membership.memberId)
        .first();
  return Boolean(row);
}

function isoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}
function integer(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
