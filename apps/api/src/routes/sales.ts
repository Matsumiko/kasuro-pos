import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { allocateDiscount, priceLine } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';
export function registerSalesRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/shifts', businessContext);
  app.use('/api/v1/businesses/:businessId/shifts/*', businessContext);
  app.use('/api/v1/businesses/:businessId/sales', businessContext);
  app.use('/api/v1/businesses/:businessId/sales/*', businessContext);

  app.get('/api/v1/businesses/:businessId/shifts/current', async (c) => {
    const membership = requirePermission(c, 'pos.use');
    if (!c.env.DB) return unavailable(c);
    const outletId = c.req.query('outlet_id');
    if (
      !outletId ||
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        outletId,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const shift = await c.env.DB.prepare(
      `SELECT s.id,s.outlet_id,s.register_id,s.status,s.opening_cash_minor,s.opened_at,r.name AS register_name
      FROM shifts s JOIN registers r ON r.id=s.register_id WHERE s.business_id=? AND s.outlet_id=? AND s.cashier_member_id=? AND s.status IN ('open','closing') ORDER BY s.opened_at DESC LIMIT 1`,
    )
      .bind(membership.businessId, outletId, membership.memberId)
      .first();
    return c.json({ data: shift ?? null });
  });

  app.post('/api/v1/businesses/:businessId/shifts', async (c) => {
    const membership = requirePermission(c, 'pos.use');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      outlet_id?: string;
      register_id?: string;
      opening_cash_minor?: string | number;
    }>();
    const opening = integer(body.opening_cash_minor);
    if (
      !body.outlet_id ||
      !body.register_id ||
      opening === undefined ||
      opening < 0 ||
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        body.outlet_id,
      ))
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid outlet, register and opening cash are required',
          },
        },
        422,
      );
    const register = await c.env.DB.prepare(
      "SELECT id FROM registers WHERE id=? AND business_id=? AND outlet_id=? AND status='active'",
    )
      .bind(body.register_id, membership.businessId, body.outlet_id)
      .first();
    if (!register)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Register not found' } }, 404);
    const shiftId = createId();
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        `INSERT INTO shifts(id,business_id,outlet_id,register_id,cashier_member_id,status,opening_cash_minor,opened_at,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?,?)`,
      )
        .bind(
          shiftId,
          membership.businessId,
          body.outlet_id,
          body.register_id,
          membership.memberId,
          opening,
          now,
          now,
          now,
        )
        .run();
    } catch {
      return c.json(
        { error: { code: 'CONFLICT', message: 'An active shift already exists' } },
        409,
      );
    }
    return c.json(
      {
        data: {
          id: shiftId,
          outlet_id: body.outlet_id,
          register_id: body.register_id,
          status: 'open',
          opening_cash_minor: opening,
        },
      },
      201,
    );
  });

  app.post('/api/v1/businesses/:businessId/shifts/:shiftId/cash-movements', async (c) => {
    const membership = requirePermission(c, 'pos.use');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      movement_type?: 'cash_in' | 'cash_out';
      amount_minor?: string | number;
      reason?: string;
    }>();
    const amount = integer(body.amount_minor);
    if (
      !body.movement_type ||
      !['cash_in', 'cash_out'].includes(body.movement_type) ||
      amount === undefined ||
      amount <= 0 ||
      !body.reason?.trim()
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Movement type, amount and reason are required',
          },
        },
        422,
      );
    const shift = await c.env.DB.prepare(
      "SELECT id,outlet_id FROM shifts WHERE id=? AND business_id=? AND cashier_member_id=? AND status='open'",
    )
      .bind(c.req.param('shiftId'), membership.businessId, membership.memberId)
      .first<{ id: string; outlet_id: string }>();
    if (
      !shift ||
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        shift.outlet_id,
      ))
    )
      return notFound(c);
    const now = new Date().toISOString();
    const id = createId();
    await c.env.DB.prepare(
      'INSERT INTO cash_movements(id,business_id,outlet_id,shift_id,movement_type,amount_minor,reason,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        membership.businessId,
        shift.outlet_id,
        shift.id,
        body.movement_type,
        amount,
        body.reason.trim(),
        membership.memberId,
        now,
      )
      .run();
    return c.json(
      { data: { id, shift_id: shift.id, movement_type: body.movement_type, amount_minor: amount } },
      201,
    );
  });

  app.post('/api/v1/businesses/:businessId/shifts/:shiftId/close', async (c) => {
    const membership = requirePermission(c, 'pos.use');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{ actual_cash_minor?: string | number }>();
    const actual = integer(body.actual_cash_minor);
    if (actual === undefined || actual < 0)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Actual cash is required' } },
        422,
      );
    const shift = await c.env.DB.prepare(
      `SELECT id,opening_cash_minor FROM shifts WHERE id=? AND business_id=? AND cashier_member_id=? AND status='open'`,
    )
      .bind(c.req.param('shiftId'), membership.businessId, membership.memberId)
      .first<{ id: string; opening_cash_minor: number }>();
    if (!shift)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Open shift not found' } }, 404);
    const totals = await c.env.DB.prepare(
      `SELECT
      COALESCE((SELECT SUM(sp.amount_minor-sp.change_minor) FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id WHERE s.shift_id=? AND s.status IN ('completed','partially_refunded','refunded') AND sp.method='cash'),0) AS cash_sales,
      COALESCE((SELECT SUM(CASE WHEN movement_type='cash_in' THEN amount_minor ELSE -amount_minor END) FROM cash_movements WHERE shift_id=?),0) AS cash_movements`,
    )
      .bind(shift.id, shift.id)
      .first<{ cash_sales: number; cash_movements: number }>();
    const expected =
      shift.opening_cash_minor + (totals?.cash_sales ?? 0) + (totals?.cash_movements ?? 0);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE shifts SET status='closed',expected_cash_minor=?,actual_cash_minor=?,difference_minor=?,closed_at=?,updated_at=? WHERE id=? AND business_id=? AND status='open'`,
    )
      .bind(expected, actual, actual - expected, now, now, shift.id, membership.businessId)
      .run();
    return c.json({
      data: {
        id: shift.id,
        status: 'closed',
        expected_cash_minor: expected,
        actual_cash_minor: actual,
        difference_minor: actual - expected,
      },
    });
  });

  app.post('/api/v1/businesses/:businessId/sales/hold', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<SaleInput>();
    if (
      !body.outlet_id ||
      !body.register_id ||
      !body.shift_id ||
      !body.client_transaction_id ||
      !body.lines?.length
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Sale context and lines are required' } },
        422,
      );
    if (
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        body.outlet_id,
      ))
    )
      return notFound(c);
    const shift = await c.env.DB.prepare(
      "SELECT id FROM shifts WHERE id=? AND business_id=? AND outlet_id=? AND register_id=? AND cashier_member_id=? AND status='open'",
    )
      .bind(
        body.shift_id,
        membership.businessId,
        body.outlet_id,
        body.register_id,
        membership.memberId,
      )
      .first();
    if (!shift)
      return c.json({ error: { code: 'SHIFT_REQUIRED', message: 'Open shift is required' } }, 409);
    const existing = await c.env.DB.prepare(
      'SELECT id,status,total_minor FROM sales WHERE business_id=? AND client_transaction_id=?',
    )
      .bind(membership.businessId, body.client_transaction_id)
      .first();
    if (existing) return c.json({ data: existing, idempotent: true });
    const variants = await loadVariants(
      c.env.DB,
      membership.businessId,
      body.lines.map((line) => line.variant_id),
    );
    if (variants.length !== body.lines.length) return notFound(c);
    const lines = body.lines.map((input) => {
      const variant = variants.find((item) => item.id === input.variant_id)!;
      const quantity = integer(input.quantity);
      if (!quantity || quantity <= 0) throw new Error('VALIDATION');
      return priceLine(
        {
          id: input.variant_id,
          quantity: BigInt(quantity),
          unitPrice: BigInt(variant.price_minor),
          itemDiscount: BigInt(integer(input.item_discount_minor) ?? 0),
          taxRateBp: BigInt(variant.tax_rate_bp),
        },
        'exclusive',
      );
    });
    const allocation = allocateDiscount(lines, BigInt(integer(body.discount_minor) ?? 0));
    const subtotal = lines.reduce((sum, line) => sum + line.gross - line.itemDiscount, 0n);
    const discount = [...allocation.values()].reduce((sum, value) => sum + value, 0n);
    const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
    const total = subtotal - discount + tax;
    const now = new Date().toISOString();
    const saleId = createId();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO sales(id,business_id,outlet_id,register_id,shift_id,cashier_member_id,customer_id,receipt_number,client_transaction_id,status,currency_code,subtotal_minor,discount_minor,tax_minor,total_minor,cogs_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,?,'held','IDR',?,?,?,?,?,?,?)`,
      ).bind(
        saleId,
        membership.businessId,
        body.outlet_id,
        body.register_id,
        body.shift_id,
        membership.memberId,
        body.customer_id ?? null,
        body.client_transaction_id,
        Number(subtotal),
        Number(discount),
        Number(tax),
        Number(total),
        0,
        now,
        now,
      ),
    ];
    for (const line of lines) {
      const variant = variants.find((item) => item.id === line.id)!;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO sale_lines(id,sale_id,variant_id,product_name,sku,quantity,unit_price_minor,item_discount_minor,tax_rate_bp,tax_minor,line_net_minor,unit_cost_minor,cogs_minor,refundable_quantity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          createId(),
          saleId,
          line.id,
          variant.product_name,
          variant.sku,
          Number(line.quantity),
          Number(line.unitPrice),
          Number(line.itemDiscount + (allocation.get(line.id) ?? 0n)),
          variant.tax_rate_bp,
          Number(line.tax),
          Number(line.net),
          variant.cost_minor,
          0,
          Number(line.quantity),
          now,
        ),
      );
    }
    await c.env.DB.batch(statements);
    return c.json({ data: { id: saleId, status: 'held', total_minor: Number(total) } }, 201);
  });

  app.post('/api/v1/businesses/:businessId/sales/:saleId/resume', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      "UPDATE sales SET status='draft',updated_at=? WHERE id=? AND business_id=? AND cashier_member_id=? AND status='held'",
    )
      .bind(
        new Date().toISOString(),
        c.req.param('saleId'),
        membership.businessId,
        membership.memberId,
      )
      .run();
    if (!result.meta.changes) return notFound(c);
    return c.json({ data: { id: c.req.param('saleId'), status: 'draft' } });
  });

  app.post('/api/v1/businesses/:businessId/sales/:saleId/complete', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const db = c.env.DB;
    const body = await c.req.json<{
      payments?: Array<{ method: string; amount_minor: string | number; reference?: string }>;
    }>();
    const sale = await db
      .prepare(
        "SELECT id,outlet_id,shift_id,total_minor FROM sales WHERE id=? AND business_id=? AND cashier_member_id=? AND status='draft'",
      )
      .bind(c.req.param('saleId'), membership.businessId, membership.memberId)
      .first<{ id: string; outlet_id: string; shift_id: string; total_minor: number }>();
    if (!sale) return notFound(c);
    const shift = await db
      .prepare(
        "SELECT id FROM shifts WHERE id=? AND business_id=? AND outlet_id=? AND cashier_member_id=? AND status='open'",
      )
      .bind(sale.shift_id, membership.businessId, sale.outlet_id, membership.memberId)
      .first();
    if (!shift)
      return c.json({ error: { code: 'SHIFT_REQUIRED', message: 'Open shift is required' } }, 409);
    if (
      !(await canAccessOutlet(
        db,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        sale.outlet_id,
      ))
    )
      return notFound(c);
    const payments = body.payments ?? [];
    const parsedPayments = payments.map((payment) => ({
      ...payment,
      amount: integer(payment.amount_minor),
    }));
    if (
      !parsedPayments.length ||
      parsedPayments.some(
        (payment) => !payment.method || payment.amount === undefined || payment.amount <= 0,
      ) ||
      parsedPayments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0) < sale.total_minor
    )
      return c.json(
        { error: { code: 'PAYMENT_REQUIRED', message: 'Payment must cover the sale total' } },
        422,
      );
    const lines = await db
      .prepare(
        'SELECT id,variant_id,quantity,unit_cost_minor FROM sale_lines WHERE sale_id=? ORDER BY id',
      )
      .bind(sale.id)
      .all<{ id: string; variant_id: string; quantity: number; unit_cost_minor: number }>();
    for (const line of lines.results) {
      const balance = await db
        .prepare(
          'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
        )
        .bind(membership.businessId, sale.outlet_id, line.variant_id)
        .first<{ quantity_on_hand: number }>();
      if (!balance || balance.quantity_on_hand < line.quantity)
        return c.json(
          { error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' } },
          409,
        );
    }
    const now = new Date().toISOString();
    const cashPayment = parsedPayments.find((payment) => payment.method === 'cash');
    const nonCashTotal = parsedPayments
      .filter((payment) => payment !== cashPayment)
      .reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
    const change = (cashPayment?.amount ?? 0) - Math.max(0, sale.total_minor - nonCashTotal);
    const statements = lines.results.flatMap((line) => [
      db
        .prepare(
          'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand-?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
        )
        .bind(line.quantity, now, membership.businessId, sale.outlet_id, line.variant_id),
      db
        .prepare(
          'UPDATE sale_lines SET cogs_minor=quantity*unit_cost_minor WHERE id=? AND sale_id=?',
        )
        .bind(line.id, sale.id),
      db
        .prepare(
          'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          createId(),
          membership.businessId,
          sale.outlet_id,
          line.variant_id,
          'sale',
          -line.quantity,
          line.unit_cost_minor,
          'sale',
          sale.id,
          membership.memberId,
          now,
        ),
    ]);
    for (const payment of parsedPayments)
      statements.push(
        db
          .prepare(
            'INSERT INTO sale_payments(id,sale_id,method,amount_minor,received_minor,change_minor,reference,created_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            createId(),
            sale.id,
            payment.method,
            Math.min(payment.amount!, sale.total_minor),
            payment.amount,
            payment === cashPayment ? Math.max(0, change) : 0,
            payment.reference ?? null,
            now,
          ),
      );
    const cogs = lines.results.reduce((sum, line) => sum + line.quantity * line.unit_cost_minor, 0);
    statements.push(
      db
        .prepare(
          "UPDATE sales SET status='completed',cogs_minor=?,receipt_number=?,updated_at=? WHERE id=? AND business_id=? AND status='draft'",
        )
        .bind(
          cogs,
          `KSR-${now.slice(0, 10).replaceAll('-', '')}-${sale.id.slice(0, 6).toUpperCase()}`,
          now,
          sale.id,
          membership.businessId,
        ),
    );
    try {
      await db.batch(statements);
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json({ error: { code: 'CONFLICT', message: 'Sale already completed' } }, 409);
      throw error;
    }
    const completed = await db
      .prepare('SELECT receipt_number,status,cogs_minor FROM sales WHERE id=? AND business_id=?')
      .bind(sale.id, membership.businessId)
      .first<{ receipt_number: string; status: string; cogs_minor: number }>();
    return c.json({
      data: {
        id: sale.id,
        receipt_number: completed?.receipt_number,
        status: completed?.status,
        total_minor: sale.total_minor,
        cogs_minor: completed?.cogs_minor ?? cogs,
        change_minor: Math.max(0, change),
      },
    });
  });

  app.get('/api/v1/businesses/:businessId/sales/held', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT id,outlet_id,status,total_minor,created_at FROM sales WHERE business_id=? AND cashier_member_id=? AND status='held' ORDER BY created_at DESC,id DESC LIMIT 50`,
    )
      .bind(membership.businessId, membership.memberId)
      .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/sales/:saleId', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const saleId = c.req.param('saleId');
    const sale = await c.env.DB.prepare(
      'SELECT id,receipt_number,outlet_id,register_id,shift_id,status,subtotal_minor,discount_minor,tax_minor,total_minor,created_at FROM sales WHERE id=? AND business_id=?',
    )
      .bind(saleId, membership.businessId)
      .first();
    if (!sale) return notFound(c);
    const lines = await c.env.DB.prepare(
      'SELECT id,variant_id,product_name,sku,quantity,unit_price_minor,item_discount_minor,tax_minor,line_net_minor,refundable_quantity FROM sale_lines WHERE sale_id=? ORDER BY id',
    )
      .bind(saleId)
      .all();
    const payments = await c.env.DB.prepare(
      'SELECT method,amount_minor,received_minor,change_minor,reference FROM sale_payments WHERE sale_id=? ORDER BY created_at,id',
    )
      .bind(saleId)
      .all();
    return c.json({ data: { ...sale, lines: lines.results, payments: payments.results } });
  });

  app.post('/api/v1/businesses/:businessId/sales/:saleId/void', async (c) => {
    const membership = requirePermission(c, 'sales.void');
    if (!c.env.DB) return unavailable(c);
    const saleId = c.req.param('saleId');
    const sale = await c.env.DB.prepare(
      "SELECT id,status FROM sales WHERE id=? AND business_id=? AND cashier_member_id=? AND status IN ('draft','held')",
    )
      .bind(saleId, membership.businessId, membership.memberId)
      .first<{ id: string; status: string }>();
    if (!sale) return notFound(c);
    await c.env.DB.prepare(
      "UPDATE sales SET status='void',updated_at=? WHERE id=? AND business_id=? AND status IN ('draft','held')",
    )
      .bind(new Date().toISOString(), saleId, membership.businessId)
      .run();
    return c.json({ data: { id: saleId, status: 'void' } });
  });

  app.post('/api/v1/businesses/:businessId/sales', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<SaleInput>();
    if (
      !body.outlet_id ||
      !body.register_id ||
      !body.shift_id ||
      !body.client_transaction_id ||
      !Array.isArray(body.lines) ||
      body.lines.length === 0
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Sale context and lines are required' } },
        422,
      );
    if (
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        body.outlet_id,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const existing = await c.env.DB.prepare(
      'SELECT id,status,total_minor,receipt_number FROM sales WHERE business_id=? AND client_transaction_id=?',
    )
      .bind(membership.businessId, body.client_transaction_id)
      .first();
    if (existing) return c.json({ data: existing, idempotent: true });
    const shift = await c.env.DB.prepare(
      `SELECT id FROM shifts WHERE id=? AND business_id=? AND outlet_id=? AND register_id=? AND cashier_member_id=? AND status='open'`,
    )
      .bind(
        body.shift_id,
        membership.businessId,
        body.outlet_id,
        body.register_id,
        membership.memberId,
      )
      .first();
    if (!shift)
      return c.json({ error: { code: 'SHIFT_REQUIRED', message: 'Open shift is required' } }, 409);
    const settings = await c.env.DB.prepare(
      'SELECT tax_mode,stock_policy FROM business_settings WHERE business_id=?',
    )
      .bind(membership.businessId)
      .first<{
        tax_mode: 'inclusive' | 'exclusive';
        stock_policy: 'prevent_negative' | 'allow_negative';
      }>();
    const variants = await loadVariants(
      c.env.DB,
      membership.businessId,
      body.lines.map((line) => line.variant_id),
    );
    if (variants.length !== body.lines.length)
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'One or more products were not found' } },
        404,
      );
    const lines = body.lines.map((line) => {
      const variant = variants.find((item) => item.id === line.variant_id)!;
      const quantity = integer(line.quantity);
      if (!quantity || quantity <= 0) throw new Error('VALIDATION');
      return priceLine(
        {
          id: line.variant_id,
          quantity: BigInt(quantity),
          unitPrice: BigInt(variant.price_minor),
          itemDiscount: BigInt(integer(line.item_discount_minor) ?? 0),
          taxRateBp: BigInt(variant.tax_rate_bp),
        },
        settings?.tax_mode ?? 'exclusive',
      );
    });
    const allocation = allocateDiscount(lines, BigInt(integer(body.discount_minor) ?? 0));
    const subtotal = lines.reduce((sum, line) => sum + line.gross - line.itemDiscount, 0n);
    const discount = [...allocation.values()].reduce((sum, value) => sum + value, 0n);
    const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
    const total =
      settings?.tax_mode === 'inclusive' ? subtotal - discount : subtotal - discount + tax;
    if ((settings?.stock_policy ?? 'prevent_negative') === 'prevent_negative') {
      for (const line of lines) {
        const balance = await c.env.DB.prepare(
          'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
        )
          .bind(membership.businessId, body.outlet_id, line.id)
          .first<{ quantity_on_hand: number }>();
        if (!balance || balance.quantity_on_hand < Number(line.quantity))
          return c.json(
            { error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' } },
            409,
          );
      }
    }
    const saleId = createId();
    const now = new Date().toISOString();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO sales(id,business_id,outlet_id,register_id,shift_id,cashier_member_id,customer_id,receipt_number,client_transaction_id,status,currency_code,subtotal_minor,discount_minor,tax_minor,total_minor,cogs_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,?,'completed','IDR',?,?,?,?,?,?,?)`,
      ).bind(
        saleId,
        membership.businessId,
        body.outlet_id,
        body.register_id,
        body.shift_id,
        membership.memberId,
        body.customer_id ?? null,
        body.client_transaction_id,
        Number(subtotal),
        Number(discount),
        Number(tax),
        Number(total),
        0,
        now,
        now,
      ),
    ];
    for (const line of lines) {
      const variant = variants.find((item) => item.id === line.id)!;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO sale_lines(id,sale_id,variant_id,product_name,sku,quantity,unit_price_minor,item_discount_minor,tax_rate_bp,tax_minor,line_net_minor,unit_cost_minor,cogs_minor,refundable_quantity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          createId(),
          saleId,
          line.id,
          variant.product_name,
          variant.sku,
          Number(line.quantity),
          Number(line.unitPrice),
          Number(line.itemDiscount + (allocation.get(line.id) ?? 0n)),
          variant.tax_rate_bp,
          Number(line.tax),
          Number(line.net),
          variant.cost_minor,
          Number(line.quantity) * variant.cost_minor,
          Number(line.quantity),
          now,
        ),
      );
      statements.push(
        c.env.DB.prepare(
          'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand-?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
        ).bind(Number(line.quantity), now, membership.businessId, body.outlet_id, line.id),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,client_transaction_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          createId(),
          membership.businessId,
          body.outlet_id,
          line.id,
          'sale',
          -Number(line.quantity),
          variant.cost_minor,
          'sale',
          saleId,
          membership.memberId,
          body.client_transaction_id,
          now,
        ),
      );
    }
    const payments = body.payments ?? (body.payment ? [body.payment] : []);
    if (!payments.length)
      return c.json(
        { error: { code: 'PAYMENT_REQUIRED', message: 'At least one payment is required' } },
        422,
      );
    const parsedPayments = payments.map((payment) => ({
      ...payment,
      amount: integer(payment.amount_minor),
    }));
    if (
      parsedPayments.some(
        (payment) => !payment.method || payment.amount === undefined || payment.amount <= 0,
      ) ||
      parsedPayments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0) < Number(total)
    )
      return c.json(
        { error: { code: 'PAYMENT_REQUIRED', message: 'Payment must cover the sale total' } },
        422,
      );
    const cashPayment = parsedPayments.find((payment) => payment.method === 'cash');
    const change =
      (cashPayment?.amount ?? 0) -
      Math.max(
        0,
        Number(total) -
          parsedPayments
            .filter((payment) => payment !== cashPayment)
            .reduce((sum, payment) => sum + (payment.amount ?? 0), 0),
      );
    for (const payment of parsedPayments)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO sale_payments(id,sale_id,method,amount_minor,received_minor,change_minor,reference,created_at) VALUES(?,?,?,?,?,?,?,?)`,
        ).bind(
          createId(),
          saleId,
          payment.method,
          Math.min(payment.amount!, Number(total)),
          payment.amount,
          payment === cashPayment ? Math.max(0, change) : 0,
          payment.reference ?? null,
          now,
        ),
      );
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json(
          { error: { code: 'CONFLICT', message: 'Sale already exists or stock conflict' } },
          409,
        );
      if (String(error).includes('INSUFFICIENT_STOCK'))
        return c.json(
          { error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' } },
          409,
        );
      throw error;
    }
    const receipt = `KSR-${now.slice(0, 10).replaceAll('-', '')}-${saleId.slice(0, 6).toUpperCase()}`;
    await c.env.DB.prepare(
      'UPDATE sales SET receipt_number=?,updated_at=? WHERE id=? AND business_id=?',
    )
      .bind(receipt, now, saleId, membership.businessId)
      .run();
    return c.json(
      {
        data: {
          id: saleId,
          receipt_number: receipt,
          status: 'completed',
          subtotal_minor: Number(subtotal),
          discount_minor: Number(discount),
          tax_minor: Number(tax),
          total_minor: Number(total),
          change_minor: Math.max(0, change),
        },
      },
      201,
    );
  });

  app.get('/api/v1/businesses/:businessId/sales', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT id,receipt_number,outlet_id,status,subtotal_minor,discount_minor,tax_minor,total_minor,created_at FROM sales WHERE business_id=? ORDER BY created_at DESC,id DESC LIMIT 100`,
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
  });
}

type SaleInput = {
  outlet_id?: string;
  register_id?: string;
  shift_id?: string;
  customer_id?: string;
  client_transaction_id?: string;
  discount_minor?: string | number;
  lines: Array<{
    variant_id: string;
    quantity: string | number;
    item_discount_minor?: string | number;
  }>;
  payment?: { method: string; amount_minor: string | number; reference?: string };
  payments?: Array<{ method: string; amount_minor: string | number; reference?: string }>;
};
type VariantRow = {
  id: string;
  product_name: string;
  sku: string;
  price_minor: number;
  cost_minor: number;
  tax_rate_bp: number;
};

async function loadVariants(
  db: D1Database,
  businessId: string,
  ids: string[],
): Promise<VariantRow[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) return [];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT v.id,p.name AS product_name, v.sku, COALESCE(v.price_minor,p.price_minor) AS price_minor, COALESCE(v.cost_minor,p.cost_minor) AS cost_minor,p.tax_rate_bp FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.business_id=? AND v.status='active' AND p.status='active' AND v.id IN (${placeholders})`,
    )
    .bind(businessId, ...uniqueIds)
    .all<VariantRow>();
  return result.results;
}

async function canAccessOutlet(
  db: D1Database,
  businessId: string,
  memberId: string,
  allOutlets: boolean,
  outletId: string,
): Promise<boolean> {
  const row = allOutlets
    ? await db
        .prepare("SELECT id FROM outlets WHERE business_id=? AND id=? AND status='active'")
        .bind(businessId, outletId)
        .first()
    : await db
        .prepare(
          `SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'`,
        )
        .bind(businessId, outletId, memberId)
        .first();
  return Boolean(row);
}

function integer(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
