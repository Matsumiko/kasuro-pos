import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerExpenseRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/expenses', businessContext);
  app.get('/api/v1/businesses/:businessId/expenses', async (c) => {
    const membership = requirePermission(c, 'expenses.view_manage');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT id,outlet_id,amount_minor,category,description,expense_date,payment_method,status,created_at FROM expenses WHERE business_id=? AND status='active' ORDER BY expense_date DESC,created_at DESC LIMIT 100`,
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
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
    if (
      !amount ||
      amount <= 0 ||
      !body.category?.trim() ||
      !body.description?.trim() ||
      !body.expense_date ||
      !body.payment_method?.trim()
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Expense fields are required' } },
        422,
      );
    if (body.outlet_id) {
      const outlet = await c.env.DB.prepare(
        "SELECT id FROM outlets WHERE id=? AND business_id=? AND status='active'",
      )
        .bind(body.outlet_id, membership.businessId)
        .first();
      if (!outlet)
        return c.json({ error: { code: 'NOT_FOUND', message: 'Outlet not found' } }, 404);
    }
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
        body.category.trim(),
        body.description.trim(),
        body.expense_date,
        body.payment_method.trim(),
        membership.memberId,
        now,
        now,
      )
      .run();
    return c.json(
      { data: { id, amount_minor: amount, category: body.category.trim(), status: 'active' } },
      201,
    );
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
    if (amount !== undefined && (!amount || amount <= 0))
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Amount must be positive' } },
        422,
      );
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.status) {
      fields.push('status=?');
      values.push(body.status);
    }
    if (body.description !== undefined && body.description.trim()) {
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
    if (!result.meta.changes)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    return c.json({ data: { id: c.req.param('expenseId'), updated: true } });
  });
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
