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

  app.get('/api/v1/businesses/:businessId/export/:resource', async (c) => {
    const membership = requirePermission(c, 'reports.export');
    if (!c.env.DB) return unavailable(c);
    const db = c.env.DB;
    const resource = (c.req.param('resource') ?? '').replace(/\.csv$/, '');
    const exportDefinitions: Record<
      string,
      { headers: string[]; query: string; scope?: 'sales' | 'inventory' | 'expenses' }
    > = {
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
          "SELECT customer_code,name,phone,email,total_spend_minor,transaction_count FROM customers WHERE business_id=? AND status='active'",
      },
      suppliers: {
        headers: ['supplier_code', 'name', 'phone', 'email'],
        query:
          "SELECT supplier_code,name,phone,email FROM suppliers WHERE business_id=? AND status='active'",
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
        scope: 'sales',
        query:
          "SELECT s.receipt_number,s.outlet_id,s.status,s.subtotal_minor,s.discount_minor,s.tax_minor,s.total_minor,s.cogs_minor,s.created_at FROM sales s WHERE s.business_id=? AND s.status IN ('completed','partially_refunded','refunded')",
      },
      inventory: {
        headers: [
          'outlet_id',
          'variant_id',
          'quantity_on_hand',
          'average_cost_minor',
          'updated_at',
        ],
        scope: 'inventory',
        query:
          'SELECT ib.outlet_id,ib.variant_id,ib.quantity_on_hand,ib.average_cost_minor,ib.updated_at FROM inventory_balances ib WHERE ib.business_id=?',
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
        scope: 'expenses',
        query:
          "SELECT e.outlet_id,e.amount_minor,e.category,e.description,e.expense_date,e.payment_method FROM expenses e WHERE e.business_id=? AND e.status='active'",
      },
    };
    const definition = exportDefinitions[resource];
    if (!definition) return notFound(c);
    const outletScope =
      definition.scope && !membership.allOutlets
        ? definition.scope === 'expenses'
          ? ' AND (e.outlet_id IS NULL OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=e.outlet_id))'
          : ` AND EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=${definition.scope === 'sales' ? 's' : 'ib'}.outlet_id)`
        : '';
    const result = await db
      .prepare(
        `${definition.query}${outletScope} ORDER BY ${definition.scope === 'sales' ? 's.created_at' : definition.scope === 'expenses' ? 'e.expense_date' : definition.scope === 'inventory' ? 'ib.outlet_id' : 'name'} DESC LIMIT 2000`,
      )
      .bind(membership.businessId, ...(outletScope ? [membership.memberId] : []))
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
      (body.import_type === 'opening_stock' && !membership.permissions.has('inventory.adjust')) ||
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
    const existingKeys = await importExistingKeys(c.env.DB, membership.businessId, job.import_type);
    const variantKeys = new Map<string, string>();
    const outletKeys = new Map<string, string>();
    if (job.import_type === 'opening_stock') {
      const [variants, outlets] = await Promise.all([
        c.env.DB.prepare(
          "SELECT id,sku FROM product_variants WHERE business_id=? AND status='active'",
        )
          .bind(membership.businessId)
          .all<{ id: string; sku: string }>(),
        c.env.DB.prepare("SELECT id,code FROM outlets WHERE business_id=? AND status='active'")
          .bind(membership.businessId)
          .all<{ id: string; code: string }>(),
      ]);
      for (const variant of variants.results) {
        variantKeys.set(variant.id, variant.id);
        variantKeys.set(variant.sku.toUpperCase(), variant.id);
      }
      for (const outlet of outlets.results) {
        outletKeys.set(outlet.id, outlet.id);
        outletKeys.set(outlet.code.toUpperCase(), outlet.id);
      }
    }
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
      let key = '';
      let error: string | null = null;
      if (job.import_type === 'opening_stock') {
        const variantKey = String(value.variant_id ?? value.sku ?? '').trim();
        const outletKey = String(value.outlet_id ?? value.outlet_code ?? '').trim();
        const quantity = integer(value.quantity);
        const cost = integer(value.unit_cost_minor);
        key = `${variantKey.toUpperCase()}|${outletKey.toUpperCase()}`;
        if (!variantKey || !outletKey) error = 'variant and outlet are required';
        else if (!variantKeys.has(variantKey) && !variantKeys.has(variantKey.toUpperCase()))
          error = 'variant not found';
        else if (!outletKeys.has(outletKey) && !outletKeys.has(outletKey.toUpperCase()))
          error = 'outlet not found';
        else if (quantity === undefined || quantity <= 0)
          error = 'quantity must be a positive integer';
        else if (cost === undefined || cost < 0)
          error = 'unit_cost_minor must be a non-negative integer';
        else if (seen.has(key)) error = 'duplicate variant and outlet in import';
      } else {
        key = String(value.sku ?? value.customer_code ?? value.supplier_code ?? '')
          .trim()
          .toUpperCase();
        const name = typeof value.name === 'string' ? value.name.trim() : '';
        const missing = !name || !key;
        const invalidNumber =
          job.import_type === 'products' &&
          ['price_minor', 'cost_minor', 'tax_rate_bp'].some(
            (field) => value[field] !== undefined && integer(value[field]) === undefined,
          );
        if (missing) error = 'name and unique code are required';
        else if (invalidNumber) error = 'numeric product fields are invalid';
        else if (
          job.import_type === 'products' &&
          ((value.price_minor !== undefined && (integer(value.price_minor) ?? -1) < 0) ||
            (value.cost_minor !== undefined && (integer(value.cost_minor) ?? -1) < 0) ||
            (value.tax_rate_bp !== undefined &&
              ((integer(value.tax_rate_bp) ?? -1) < 0 ||
                (integer(value.tax_rate_bp) ?? 0) > 10000)))
        )
          error = 'product amounts are out of range';
        else if (existingKeys.has(key)) error = 'code already exists';
        else if (seen.has(key)) error = 'duplicate code in import';
      }
      if (key) seen.add(key);
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
    await runBatches(c.env.DB, statements);
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
      'SELECT id,import_type,status,valid_rows,error_rows FROM import_jobs WHERE id=? AND business_id=?',
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
    if (job.status === 'imported')
      return c.json({
        data: { id: job.id, status: 'imported', rows_imported: job.valid_rows, idempotent: true },
      });
    if (job.status !== 'validated') return notFound(c);
    if (job.error_rows)
      return c.json(
        { error: { code: 'IMPORT_HAS_ERRORS', message: 'Resolve invalid rows before confirming' } },
        409,
      );
    const rows = await c.env.DB.prepare(
      "SELECT row_number,normalized_json FROM import_rows WHERE import_job_id=? AND status='valid' ORDER BY row_number LIMIT 10000",
    )
      .bind(job.id)
      .all<{ row_number: number; normalized_json: string }>();
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      const value = JSON.parse(row.normalized_json) as Record<string, unknown>;
      if (job.import_type === 'opening_stock') {
        const variantId = await resolveVariantId(c.env.DB, membership.businessId, value);
        const outletId = await resolveOutletId(c.env.DB, membership.businessId, value);
        const quantity = integer(value.quantity);
        const cost = integer(value.unit_cost_minor);
        if (!variantId || !outletId || quantity === undefined || cost === undefined)
          return c.json(
            {
              error: {
                code: 'IMPORT_CONFLICT',
                message: `Opening stock row ${row.row_number} changed after validation`,
              },
            },
            409,
          );
        const sourceId = `import:${job.id}:${row.row_number}`;
        const existing = await c.env.DB.prepare(
          'SELECT id FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? AND variant_id=? AND movement_type=?',
        )
          .bind(membership.businessId, 'opening_stock_import', sourceId, variantId, 'opening_stock')
          .first();
        if (existing) continue;
        const balance = await c.env.DB.prepare(
          'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
        )
          .bind(membership.businessId, outletId, variantId)
          .first<{ quantity_on_hand: number; average_cost_minor: number }>();
        if (!balance)
          return c.json(
            {
              error: {
                code: 'IMPORT_CONFLICT',
                message: `Inventory balance missing for row ${row.row_number}`,
              },
            },
            409,
          );
        const nextQuantity = balance.quantity_on_hand + quantity;
        const nextCost =
          balance.quantity_on_hand > 0
            ? Math.floor(
                (balance.quantity_on_hand * balance.average_cost_minor +
                  quantity * cost +
                  Math.floor(nextQuantity / 2)) /
                  nextQuantity,
              )
            : cost;
        statements.push(
          c.env.DB.prepare(
            'UPDATE inventory_balances SET quantity_on_hand=?,average_cost_minor=?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
          ).bind(nextQuantity, nextCost, now, membership.businessId, outletId, variantId),
          c.env.DB.prepare(
            'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(
            createId(),
            membership.businessId,
            outletId,
            variantId,
            'opening_stock',
            quantity,
            cost,
            'opening_stock_import',
            sourceId,
            membership.memberId,
            now,
          ),
        );
      } else if (job.import_type === 'products') {
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
      await runBatches(c.env.DB, statements);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE import_rows SET status='imported' WHERE import_job_id=? AND status='valid'",
        ).bind(job.id),
        c.env.DB.prepare(
          "UPDATE import_jobs SET status='imported',updated_at=? WHERE id=? AND business_id=? AND status='validated'",
        ).bind(now, job.id, membership.businessId),
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json(
          { error: { code: 'IMPORT_CONFLICT', message: 'An imported code already exists' } },
          409,
        );
      if (String(error).includes('INSUFFICIENT_STOCK'))
        return c.json(
          {
            error: {
              code: 'IMPORT_CONFLICT',
              message: 'Opening stock conflicts with current inventory policy',
            },
          },
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
      'SELECT r.row_number,r.status,r.error_json FROM import_rows r JOIN import_jobs j ON j.id=r.import_job_id AND j.business_id=? WHERE r.import_job_id=? ORDER BY r.row_number LIMIT 10000',
    )
      .bind(membership.businessId, c.req.param('importId'))
      .all();
    return c.json({ data: { ...job, rows: rows.results } });
  });
}
async function importExistingKeys(
  db: D1Database,
  businessId: string,
  importType: string,
): Promise<Set<string>> {
  if (importType === 'opening_stock') return new Set();
  const table =
    importType === 'products' ? 'products' : importType === 'customers' ? 'customers' : 'suppliers';
  const field =
    importType === 'products'
      ? 'sku'
      : importType === 'customers'
        ? 'customer_code'
        : 'supplier_code';
  const result = await db
    .prepare(`SELECT ${field} AS code FROM ${table} WHERE business_id=? AND status='active'`)
    .bind(businessId)
    .all<{ code: string }>();
  return new Set(result.results.map((row) => row.code.toUpperCase()));
}

async function resolveVariantId(
  db: D1Database,
  businessId: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  const key = String(value.variant_id ?? value.sku ?? '').trim();
  if (!key) return null;
  const result = await db
    .prepare(
      "SELECT id FROM product_variants WHERE business_id=? AND status='active' AND (id=? OR UPPER(sku)=?)",
    )
    .bind(businessId, key, key.toUpperCase())
    .first<{ id: string }>();
  return result?.id ?? null;
}

async function resolveOutletId(
  db: D1Database,
  businessId: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  const key = String(value.outlet_id ?? value.outlet_code ?? '').trim();
  if (!key) return null;
  const result = await db
    .prepare(
      "SELECT id FROM outlets WHERE business_id=? AND status='active' AND (id=? OR UPPER(code)=?)",
    )
    .bind(businessId, key, key.toUpperCase())
    .first<{ id: string }>();
  return result?.id ?? null;
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 50)
    await db.batch(statements.slice(offset, offset + 50));
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
