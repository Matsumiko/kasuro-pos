import type { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import { createId, toCsv } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerImportExportRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/export', businessContext);
  app.use('/api/v1/businesses/:businessId/export/*', businessContext);
  app.use('/api/v1/businesses/:businessId/imports', businessContext);
  app.use('/api/v1/businesses/:businessId/imports/*', businessContext);
  app.get('/api/v1/businesses/:businessId/export/products.csv', async (c) => {
    const membership = requirePermission(c, 'reports.export');
    if (!c.env.DB) return unavailable(c);
    const products = await c.env.DB.prepare(
      `SELECT p.name,p.sku,p.barcode,p.unit_key,p.price_minor,p.cost_minor,p.tax_rate_bp FROM products p WHERE p.business_id=? AND p.status='active' ORDER BY p.name LIMIT 1000`,
    )
      .bind(membership.businessId)
      .all<{
        name: string;
        sku: string;
        barcode: string | null;
        unit_key: string;
        price_minor: number;
        cost_minor: number;
        tax_rate_bp: number;
      }>();
    const csv = toCsv([
      ['name', 'sku', 'barcode', 'unit_key', 'price_minor', 'cost_minor', 'tax_rate_bp'],
      ...products.results.map((row) => [
        row.name,
        row.sku,
        row.barcode ?? '',
        row.unit_key,
        String(row.price_minor),
        String(row.cost_minor),
        String(row.tax_rate_bp),
      ]),
    ]);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="kasuro-products.csv"');
    return c.body(csv);
  });

  app.get('/api/v1/businesses/:businessId/export/:resource.csv', async (c) => {
    const membership = requirePermission(c, 'reports.export');
    if (!c.env.DB) return unavailable(c);
    const db = c.env.DB;
    const resource = c.req.param('resource') ?? '';
    const exportDefinitions: Record<string, { headers: string[]; query: string }> = {
      customers: {
        headers: [
          'customer_code',
          'name',
          'phone',
          'email',
          'total_spend_minor',
          'transaction_count',
        ],
        query:
          "SELECT customer_code,name,phone,email,total_spend_minor,transaction_count FROM customers WHERE business_id=? AND status='active' ORDER BY name LIMIT 2000",
      },
      suppliers: {
        headers: ['supplier_code', 'name', 'phone', 'email'],
        query:
          "SELECT supplier_code,name,phone,email FROM suppliers WHERE business_id=? AND status='active' ORDER BY name LIMIT 2000",
      },
      sales: {
        headers: [
          'receipt_number',
          'outlet_id',
          'status',
          'subtotal_minor',
          'discount_minor',
          'tax_minor',
          'total_minor',
          'cogs_minor',
          'created_at',
        ],
        query:
          "SELECT receipt_number,outlet_id,status,subtotal_minor,discount_minor,tax_minor,total_minor,cogs_minor,created_at FROM sales WHERE business_id=? AND status IN ('completed','partially_refunded','refunded') ORDER BY created_at DESC LIMIT 2000",
      },
      inventory: {
        headers: [
          'outlet_id',
          'variant_id',
          'quantity_on_hand',
          'average_cost_minor',
          'updated_at',
        ],
        query:
          'SELECT outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at FROM inventory_balances WHERE business_id=? ORDER BY outlet_id,variant_id LIMIT 2000',
      },
      expenses: {
        headers: [
          'outlet_id',
          'amount_minor',
          'category',
          'description',
          'expense_date',
          'payment_method',
        ],
        query:
          "SELECT outlet_id,amount_minor,category,description,expense_date,payment_method FROM expenses WHERE business_id=? AND status='active' ORDER BY expense_date DESC LIMIT 2000",
      },
    };
    const definition = exportDefinitions[resource];
    if (!definition) return notFound(c);
    const result = await db
      .prepare(definition.query)
      .bind(membership.businessId)
      .all<Record<string, unknown>>();
    const csv = toCsv([
      definition.headers,
      ...result.results.map((row) => definition.headers.map((header) => String(row[header] ?? ''))),
    ]);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="kasuro-${resource}.csv"`);
    return c.body(csv);
  });
  app.post('/api/v1/businesses/:businessId/imports', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const db = c.env.DB;
    const body = await c.req.json<{
      import_type?: 'products' | 'customers' | 'suppliers' | 'opening_stock';
      filename?: string;
      rows?: unknown[];
    }>();
    const supported = new Set(['products', 'customers', 'suppliers', 'opening_stock']);
    const filename = body.filename?.trim();
    if (
      !body.import_type ||
      !supported.has(body.import_type) ||
      !filename ||
      filename.length > 200 ||
      /[\\/\0]/.test(filename) ||
      !Array.isArray(body.rows) ||
      body.rows.length === 0 ||
      body.rows.length > 10000 ||
      body.rows.some((row) => !row || typeof row !== 'object' || JSON.stringify(row).length > 8192)
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Import type, safe filename, and 1-10000 bounded rows are required',
          },
        },
        422,
      );
    const id = createId();
    const now = new Date().toISOString();
    const statements = [
      db
        .prepare(
          `INSERT INTO import_jobs(id,business_id,actor_member_id,import_type,status,filename,total_rows,created_at,updated_at) VALUES(?,?,?,?,'uploaded',?,?,?,?)`,
        )
        .bind(
          id,
          membership.businessId,
          membership.memberId,
          body.import_type,
          filename,
          body.rows.length,
          now,
          now,
        ),
    ];
    body.rows.forEach((row, index) =>
      statements.push(
        db
          .prepare(
            "INSERT INTO import_rows(id,import_job_id,row_number,raw_json,status) VALUES(?,?,?,?,'pending')",
          )
          .bind(createId(), id, index + 1, JSON.stringify(row)),
      ),
    );
    await db.batch(statements);
    return c.json({ data: { id, status: 'uploaded', total_rows: body.rows.length } }, 201);
  });
  app.post('/api/v1/businesses/:businessId/imports/:importId/validate', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const job = await c.env.DB.prepare(
      "SELECT id,import_type,status FROM import_jobs WHERE id=? AND business_id=? AND status IN ('uploaded','parsed','validated')",
    )
      .bind(c.req.param('importId'), membership.businessId)
      .first<{ id: string; import_type: string; status: string }>();
    if (!job) return notFound(c);
    const rows = await c.env.DB.prepare(
      'SELECT id,row_number,raw_json FROM import_rows WHERE import_job_id=? ORDER BY row_number LIMIT 10000',
    )
      .bind(job.id)
      .all<{ id: string; row_number: number; raw_json: string }>();
    const seen = new Set<string>();
    let valid = 0;
    let errors = 0;
    const statements = [];
    for (const row of rows.results) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.raw_json) as unknown;
      } catch {
        parsed = null;
      }
      const parsedRecord = z.record(z.string(), z.unknown()).safeParse(parsed);
      const value = parsedRecord.success ? parsedRecord.data : {};
      const key = String(value.sku ?? value.customer_code ?? value.supplier_code ?? '')
        .trim()
        .toUpperCase();
      const name = typeof value.name === 'string' ? value.name.trim() : '';
      const missing = !name || !key;
      const invalidNumber =
        job.import_type === 'products' &&
        ['price_minor', 'cost_minor', 'tax_rate_bp'].some(
          (field) => value[field] !== undefined && integer(value[field]) === undefined,
        );
      const duplicate = Boolean(key && seen.has(key));
      if (key) seen.add(key);
      const error = missing
        ? 'name and unique code are required'
        : invalidNumber
          ? 'numeric product fields are invalid'
          : duplicate
            ? 'duplicate code in import'
            : null;
      if (error) errors++;
      else valid++;
      statements.push(
        c.env.DB.prepare(
          'UPDATE import_rows SET normalized_json=?,error_json=?,status=? WHERE id=?',
        ).bind(
          error ? null : JSON.stringify(value),
          error ? JSON.stringify({ message: error }) : null,
          error ? 'invalid' : 'valid',
          row.id,
        ),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE import_jobs SET status='validated',valid_rows=?,error_rows=?,updated_at=? WHERE id=? AND business_id=?",
      ).bind(valid, errors, new Date().toISOString(), job.id, membership.businessId),
    );
    await c.env.DB.batch(statements);
    const details = await c.env.DB.prepare(
      "SELECT row_number,status,error_json FROM import_rows WHERE import_job_id=? AND status='invalid' ORDER BY row_number LIMIT 100",
    )
      .bind(job.id)
      .all<{ row_number: number; status: string; error_json: string | null }>();
    return c.json({
      data: {
        id: job.id,
        status: 'validated',
        total_rows: rows.results.length,
        valid_rows: valid,
        error_rows: errors,
        rows: details.results,
      },
    });
  });
  app.post('/api/v1/businesses/:businessId/imports/:importId/confirm', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const job = await c.env.DB.prepare(
      "SELECT id,import_type,status,valid_rows,error_rows FROM import_jobs WHERE id=? AND business_id=? AND status='validated'",
    )
      .bind(c.req.param('importId'), membership.businessId)
      .first<{
        id: string;
        import_type: string;
        status: string;
        valid_rows: number;
        error_rows: number;
      }>();
    if (!job) return notFound(c);
    if (job.error_rows)
      return c.json(
        { error: { code: 'IMPORT_HAS_ERRORS', message: 'Resolve invalid rows before confirming' } },
        409,
      );
    if (job.import_type === 'opening_stock')
      return c.json(
        {
          error: {
            code: 'IMPORT_UNSUPPORTED',
            message: 'Opening stock requires an outlet and cost per row',
          },
        },
        422,
      );
    const rows = await c.env.DB.prepare(
      "SELECT normalized_json FROM import_rows WHERE import_job_id=? AND status='valid' ORDER BY row_number LIMIT 10000",
    )
      .bind(job.id)
      .all<{ normalized_json: string }>();
    const now = new Date().toISOString();
    const statements = [];
    for (const row of rows.results) {
      const value = JSON.parse(row.normalized_json) as Record<string, unknown>;
      if (job.import_type === 'products') {
        const productId = createId();
        const variantId = createId();
        const price = integer(value.price_minor) ?? 0;
        const cost = integer(value.cost_minor) ?? 0;
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO products(id,business_id,name,sku,barcode,unit_key,price_minor,cost_minor,tax_rate_bp,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,? ,'active',?,?)",
          ).bind(
            productId,
            membership.businessId,
            String(value.name).trim(),
            String(value.sku).trim().toUpperCase(),
            value.barcode ? String(value.barcode).trim() : null,
            value.unit_key ? String(value.unit_key) : 'pcs',
            price,
            cost,
            integer(value.tax_rate_bp) ?? 0,
            now,
            now,
          ),
        );
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO product_variants(id,business_id,product_id,label,sku,barcode,price_minor,cost_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,'active',?,?)",
          ).bind(
            variantId,
            membership.businessId,
            productId,
            'Default',
            String(value.sku).trim().toUpperCase(),
            value.barcode ? String(value.barcode).trim() : null,
            price,
            cost,
            now,
            now,
          ),
        );
        const outlets = await c.env.DB.prepare(
          "SELECT id FROM outlets WHERE business_id=? AND status='active'",
        )
          .bind(membership.businessId)
          .all<{ id: string }>();
        for (const outlet of outlets.results)
          statements.push(
            c.env.DB.prepare(
              'INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,0,?,?)',
            ).bind(membership.businessId, outlet.id, variantId, cost, now),
          );
      } else if (job.import_type === 'customers' || job.import_type === 'suppliers') {
        const table = job.import_type;
        const codeField = job.import_type === 'customers' ? 'customer_code' : 'supplier_code';
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO ${table}(id,business_id,${codeField},name,phone,email,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)`,
          ).bind(
            createId(),
            membership.businessId,
            String(value[codeField]).trim().toUpperCase(),
            String(value.name).trim(),
            value.phone ? String(value.phone).trim() : null,
            value.email ? String(value.email).trim().toLowerCase() : null,
            value.notes ? String(value.notes).trim() : null,
            now,
            now,
          ),
        );
      }
    }
    try {
      for (let offset = 0; offset < statements.length; offset += 50)
        await c.env.DB.batch(statements.slice(offset, offset + 50));
      await c.env.DB.prepare(
        "UPDATE import_rows SET status='imported' WHERE import_job_id=? AND status='valid'",
      )
        .bind(job.id)
        .run();
      await c.env.DB.prepare(
        "UPDATE import_jobs SET status='imported',updated_at=? WHERE id=? AND business_id=? AND status='validated'",
      )
        .bind(new Date().toISOString(), job.id, membership.businessId)
        .run();
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json(
          { error: { code: 'IMPORT_CONFLICT', message: 'An imported code already exists' } },
          409,
        );
      throw error;
    }
    return c.json({ data: { id: job.id, status: 'imported', rows_imported: job.valid_rows } });
  });
  app.get('/api/v1/businesses/:businessId/imports/:importId', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const job = await c.env.DB.prepare(
      'SELECT id,import_type,status,filename,total_rows,valid_rows,error_rows,created_at,updated_at FROM import_jobs WHERE id=? AND business_id=?',
    )
      .bind(c.req.param('importId'), membership.businessId)
      .first();
    if (!job) return notFound(c);
    const rows = await c.env.DB.prepare(
      'SELECT row_number,status,error_json FROM import_rows WHERE import_job_id=? ORDER BY row_number LIMIT 10000',
    )
      .bind(c.req.param('importId'))
      .all();
    return c.json({ data: { ...job, rows: rows.results } });
  });
}
function integer(value: unknown): number | undefined {
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
function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}
