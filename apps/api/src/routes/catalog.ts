import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerCatalogRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/products', businessContext);
  app.use('/api/v1/businesses/:businessId/products/*', businessContext);
  app.use('/api/v1/businesses/:businessId/inventory', businessContext);
  app.use('/api/v1/businesses/:businessId/inventory/*', businessContext);
  app.use('/api/v1/businesses/:businessId/catalog-options', businessContext);
  app.use('/api/v1/businesses/:businessId/catalog-options/*', businessContext);
  app.get('/api/v1/businesses/:businessId/products', async (c) => {
    const membership = requirePermission(c, 'products.view');
    if (!c.env.DB) return unavailable(c);
    const query = c.req.query('q')?.trim() ?? '';
    const includeArchived = c.req.query('include_archived') === '1';
    const search = `%${query}%`;
    const result = await c.env.DB.prepare(
      `SELECT p.id,p.name,p.sku,p.barcode,p.unit_key,p.price_minor,p.cost_minor,p.tax_rate_bp,p.reorder_level,p.status,
        p.category_id,c.name AS category_name,p.brand_id,b.name AS brand_name,
        v.id AS variant_id,v.label AS variant_label,v.sku AS variant_sku,v.barcode AS variant_barcode,
        COALESCE(v.price_minor,p.price_minor) AS selling_price_minor,COALESCE(v.cost_minor,p.cost_minor) AS variant_cost_minor
      FROM products p JOIN product_variants v ON v.product_id=p.id AND (?=1 OR v.status='active')
      LEFT JOIN categories c ON c.id=p.category_id AND c.business_id=p.business_id
      LEFT JOIN brands b ON b.id=p.brand_id AND b.business_id=p.business_id
      WHERE p.business_id=? AND (?=1 OR p.status='active') AND (?='' OR p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
      ORDER BY p.name,v.label LIMIT 100`,
    )
      .bind(
        includeArchived ? 1 : 0,
        membership.businessId,
        includeArchived ? 1 : 0,
        query,
        search,
        search,
        search,
        search,
        search,
      )
      .all();
    const data = membership.permissions.has('products.view_cost')
      ? result.results
      : result.results.map((row) => withoutCosts(row));
    return c.json({ data });
  });
  app.get('/api/v1/businesses/:businessId/catalog-options', async (c) => {
    const membership = requirePermission(c, 'products.view');
    if (!c.env.DB) return unavailable(c);
    const [categories, brands] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id,name FROM categories WHERE business_id=? AND status='active' ORDER BY name LIMIT 200",
      )
        .bind(membership.businessId)
        .all(),
      c.env.DB.prepare(
        "SELECT id,name FROM brands WHERE business_id=? AND status='active' ORDER BY name LIMIT 200",
      )
        .bind(membership.businessId)
        .all(),
    ]);
    return c.json({ data: { categories: categories.results, brands: brands.results } });
  });

  app.post('/api/v1/businesses/:businessId/catalog-options', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<Partial<{ type: 'category' | 'brand'; name: string }>>();
    const type = body.type;
    const name = body.name?.trim();
    if ((type !== 'category' && type !== 'brand') || !name || name.length > 120)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Jenis dan nama katalog wajib valid' } },
        422,
      );
    const table = type === 'category' ? 'categories' : 'brands';
    const id = createId();
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        `INSERT INTO ${table}(id,business_id,name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)`,
      )
        .bind(id, membership.businessId, name, now, now)
        .run();
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'Nama sudah digunakan' } }, 409);
    }
    return c.json({ data: { id, name, type, status: 'active' } }, 201);
  });
  app.get('/api/v1/businesses/:businessId/products/:productId', async (c) => {
    const membership = requirePermission(c, 'products.view');
    if (!c.env.DB) return unavailable(c);
    const product = await c.env.DB.prepare(
      `SELECT p.id,p.name,p.sku,p.barcode,p.description,p.unit_key,p.price_minor,p.cost_minor,p.tax_rate_bp,p.reorder_level,p.status,
          p.category_id,p.brand_id,c.name AS category_name,b.name AS brand_name
         FROM products p LEFT JOIN categories c ON c.id=p.category_id AND c.business_id=p.business_id
         LEFT JOIN brands b ON b.id=p.brand_id AND b.business_id=p.business_id
         WHERE p.business_id=? AND p.id=?`,
    )
      .bind(membership.businessId, c.req.param('productId'))
      .first<Record<string, unknown>>();
    if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const variants = await c.env.DB.prepare(
      `SELECT id,label,sku,barcode,price_minor,cost_minor,options_json,status,created_at,updated_at
         FROM product_variants WHERE business_id=? AND product_id=? ORDER BY status,label`,
    )
      .bind(membership.businessId, c.req.param('productId'))
      .all<Record<string, unknown>>();
    return c.json({
      data: {
        ...(membership.permissions.has('products.view_cost') ? product : withoutCosts(product)),
        variants: membership.permissions.has('products.view_cost')
          ? variants.results
          : variants.results.map((row) => withoutCosts(row)),
      },
    });
  });
  app.post('/api/v1/businesses/:businessId/products/:productId/variants', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const productId = c.req.param('productId');
    const product = await c.env.DB.prepare(
      "SELECT id FROM products WHERE business_id=? AND id=? AND status='active'",
    )
      .bind(membership.businessId, productId)
      .first();
    if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const body = await c.req.json<
      Partial<{
        label: string;
        sku: string;
        barcode: string;
        price_minor: string | number;
        cost_minor: string | number;
        options_json: string;
      }>
    >();
    const label = body.label?.trim();
    const sku = body.sku?.trim().toUpperCase();
    const price = body.price_minor === undefined ? undefined : integer(body.price_minor);
    const cost = body.cost_minor === undefined ? undefined : integer(body.cost_minor);
    if (
      !label ||
      !sku ||
      label.length > 120 ||
      sku.length > 80 ||
      (price !== undefined && (price === undefined || price < 0)) ||
      (cost !== undefined && (cost === undefined || cost < 0))
    )
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid variant data' } }, 422);
    const id = createId();
    const now = new Date().toISOString();
    try {
      const outlets = await c.env.DB.prepare(
        "SELECT id FROM outlets WHERE business_id=? AND status='active'",
      )
        .bind(membership.businessId)
        .all<{ id: string }>();
      const statements = [
        c.env.DB.prepare(
          `INSERT INTO product_variants(id,business_id,product_id,label,sku,barcode,price_minor,cost_minor,options_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)`,
        ).bind(
          id,
          membership.businessId,
          productId,
          label,
          sku,
          body.barcode?.trim() || null,
          price ?? null,
          cost ?? null,
          body.options_json?.trim() || '{}',
          now,
          now,
        ),
      ];
      for (const outlet of outlets.results)
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,0,COALESCE(?,0),?)`,
          ).bind(membership.businessId, outlet.id, id, cost ?? 0, now),
        );
      await c.env.DB.batch(statements);
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'SKU or barcode already exists' } }, 409);
    }
    return c.json({ data: { id, product_id: productId, label, sku, status: 'active' } }, 201);
  });

  app.patch('/api/v1/businesses/:businessId/products/:productId/variants/:variantId', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const variantId = c.req.param('variantId');
    const current = await c.env.DB.prepare(
      'SELECT id FROM product_variants WHERE business_id=? AND product_id=? AND id=?',
    )
      .bind(membership.businessId, c.req.param('productId'), variantId)
      .first();
    if (!current) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const body = await c.req.json<
      Partial<{
        status: 'active' | 'archived';
        label: string;
        barcode: string;
        price_minor: string | number;
        cost_minor: string | number;
      }>
    >();
    if (body.status && body.status !== 'active' && body.status !== 'archived')
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 422);
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if (body.label !== undefined) {
      const value = body.label.trim();
      if (!value || value.length > 120)
        return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid label' } }, 422);
      fields.push('label=?');
      values.push(value);
    }
    if (body.barcode !== undefined) {
      fields.push('barcode=?');
      values.push(body.barcode.trim() || null);
    }
    for (const key of ['price_minor', 'cost_minor'] as const) {
      if (body[key] === undefined) continue;
      const value = integer(body[key]);
      if (value === undefined || value < 0)
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid variant amount' } },
          422,
        );
      fields.push(`${key}=?`);
      values.push(value);
    }
    if (body.status) {
      fields.push('status=?');
      values.push(body.status);
    }
    if (!fields.length)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No changes supplied' } }, 422);
    fields.push('updated_at=?');
    values.push(
      new Date().toISOString(),
      membership.businessId,
      c.req.param('productId'),
      variantId,
    );
    try {
      await c.env.DB.prepare(
        `UPDATE product_variants SET ${fields.join(',')} WHERE business_id=? AND product_id=? AND id=?`,
      )
        .bind(...values)
        .run();
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'Barcode already exists' } }, 409);
    }
    return c.json({ data: { id: variantId, updated: true } });
  });

  app.post('/api/v1/businesses/:businessId/products', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<
      Partial<{
        name: string;
        sku: string;
        barcode: string;
        description: string;
        unit_key: string;
        price_minor: string | number;
        cost_minor: string | number;
        tax_rate_bp: string | number;
        reorder_level: string | number;
        category_id: string;
        brand_id: string;
        label: string;
      }>
    >();
    const name = body.name?.trim();
    const sku = body.sku?.trim().toUpperCase();
    const label = body.label?.trim() || 'Default';
    const price = integer(body.price_minor);
    const cost = integer(body.cost_minor ?? 0);
    const taxRate = integer(body.tax_rate_bp ?? 0);
    const reorderLevel = integer(body.reorder_level ?? 0);
    if (
      !name ||
      !sku ||
      !label ||
      price === undefined ||
      cost === undefined ||
      taxRate === undefined ||
      reorderLevel === undefined ||
      price < 0 ||
      cost < 0 ||
      taxRate < 0 ||
      taxRate > 10000 ||
      reorderLevel < 0 ||
      name.length > 160 ||
      sku.length > 80 ||
      label.length > 120
    )
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid product data' } }, 422);
    const now = new Date().toISOString();
    const productId = createId();
    const variantId = createId();
    if (body.category_id || body.brand_id) {
      const metadata = await c.env.DB.prepare(
        `SELECT (SELECT id FROM categories WHERE id=? AND business_id=? AND status='active') AS category_id,
                (SELECT id FROM brands WHERE id=? AND business_id=? AND status='active') AS brand_id`,
      )
        .bind(
          body.category_id ?? '',
          membership.businessId,
          body.brand_id ?? '',
          membership.businessId,
        )
        .first<{ category_id: string | null; brand_id: string | null }>();
      if (
        (body.category_id && metadata?.category_id !== body.category_id) ||
        (body.brand_id && metadata?.brand_id !== body.brand_id)
      )
        return c.json({ error: { code: 'NOT_FOUND', message: 'Catalog option not found' } }, 404);
    }
    try {
      const outlets = await c.env.DB.prepare(
        "SELECT id FROM outlets WHERE business_id=? AND status='active'",
      )
        .bind(membership.businessId)
        .all<{ id: string }>();
      const statements = [
        c.env.DB.prepare(
          `INSERT INTO products(id,business_id,category_id,brand_id,name,sku,barcode,description,unit_key,price_minor,cost_minor,tax_rate_bp,reorder_level,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
        ).bind(
          productId,
          membership.businessId,
          body.category_id || null,
          body.brand_id || null,
          name,
          sku,
          body.barcode?.trim() || null,
          body.description?.trim() || null,
          body.unit_key?.trim() || 'pcs',
          price,
          cost,
          taxRate,
          reorderLevel,
          now,
          now,
        ),
        c.env.DB.prepare(
          `INSERT INTO product_variants(id,business_id,product_id,label,sku,barcode,price_minor,cost_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)`,
        ).bind(
          variantId,
          membership.businessId,
          productId,
          label,
          sku,
          body.barcode?.trim() || null,
          price,
          cost,
          now,
          now,
        ),
      ];
      for (const outlet of outlets.results)
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,0,?,?)`,
          ).bind(membership.businessId, outlet.id, variantId, cost, now),
        );
      await c.env.DB.batch(statements);
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'SKU or barcode already exists' } }, 409);
    }
    return c.json(
      {
        data: {
          id: productId,
          variant_id: variantId,
          name,
          sku,
          price_minor: price,
          status: 'active',
        },
      },
      201,
    );
  });
  app.patch('/api/v1/businesses/:businessId/products/:productId', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<
      Partial<{
        name: string;
        barcode: string;
        description: string;
        unit_key: string;
        price_minor: string | number;
        cost_minor: string | number;
        tax_rate_bp: string | number;
        reorder_level: string | number;
        category_id: string | null;
        brand_id: string | null;
        status: 'active' | 'archived';
      }>
    >();
    const productId = c.req.param('productId');
    const current = await c.env.DB.prepare('SELECT id FROM products WHERE business_id=? AND id=?')
      .bind(membership.businessId, productId)
      .first();
    if (!current) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    if (body.status && body.status !== 'active' && body.status !== 'archived')
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status' } }, 422);
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if (body.name !== undefined) {
      const value = body.name.trim();
      if (!value || value.length > 160)
        return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid name' } }, 422);
      fields.push('name=?');
      values.push(value);
    }
    if (body.barcode !== undefined) {
      fields.push('barcode=?');
      values.push(body.barcode.trim() || null);
    }
    if (body.description !== undefined) {
      fields.push('description=?');
      values.push(body.description.trim() || null);
    }
    if (body.unit_key !== undefined) {
      fields.push('unit_key=?');
      values.push(body.unit_key.trim() || 'pcs');
    }
    for (const [key, label] of [
      ['price_minor', 'price'],
      ['cost_minor', 'cost'],
      ['tax_rate_bp', 'tax'],
      ['reorder_level', 'reorder'],
    ] as const) {
      if (body[key] === undefined) continue;
      const value = integer(body[key]);
      if (value === undefined || value < 0 || (label === 'tax' && value > 10000))
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid numeric field' } },
          422,
        );
      fields.push(`${key}=?`);
      values.push(value);
    }
    if (body.category_id !== undefined) {
      fields.push('category_id=?');
      values.push(body.category_id || null);
    }
    if (body.brand_id !== undefined) {
      fields.push('brand_id=?');
      values.push(body.brand_id || null);
    }
    if (body.status) {
      fields.push('status=?');
      values.push(body.status);
    }
    if (body.category_id || body.brand_id) {
      const metadata = await c.env.DB.prepare(
        `SELECT (SELECT id FROM categories WHERE id=? AND business_id=? AND status='active') AS category_id,
                (SELECT id FROM brands WHERE id=? AND business_id=? AND status='active') AS brand_id`,
      )
        .bind(
          body.category_id ?? '',
          membership.businessId,
          body.brand_id ?? '',
          membership.businessId,
        )
        .first<{ category_id: string | null; brand_id: string | null }>();
      if (
        (body.category_id && metadata?.category_id !== body.category_id) ||
        (body.brand_id && metadata?.brand_id !== body.brand_id)
      )
        return c.json({ error: { code: 'NOT_FOUND', message: 'Catalog option not found' } }, 404);
    }
    if (!fields.length)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No changes supplied' } }, 422);
    fields.push('updated_at=?');
    values.push(new Date().toISOString(), membership.businessId, productId);
    try {
      await c.env.DB.prepare(`UPDATE products SET ${fields.join(',')} WHERE business_id=? AND id=?`)
        .bind(...values)
        .run();
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'SKU or barcode already exists' } }, 409);
    }
    return c.json({ data: { id: productId, updated: true } });
  });

  app.get('/api/v1/businesses/:businessId/inventory', async (c) => {
    const membership = requirePermission(c, 'inventory.view');
    if (!c.env.DB) return unavailable(c);
    const outletId = c.req.query('outlet_id');
    if (
      outletId &&
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        outletId,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const scope = membership.allOutlets
      ? 'ib.business_id=? AND (? IS NULL OR ib.outlet_id=?)'
      : 'ib.business_id=? AND mo.member_id=? AND (? IS NULL OR ib.outlet_id=?)';
    const bindings = membership.allOutlets
      ? [membership.businessId, outletId ?? null, outletId ?? null]
      : [membership.businessId, membership.memberId, outletId ?? null, outletId ?? null];
    const result = await c.env.DB.prepare(
      `SELECT ib.outlet_id,ib.variant_id,p.name,p.sku,v.label,ib.quantity_on_hand,ib.average_cost_minor,ib.updated_at
      FROM inventory_balances ib JOIN product_variants v ON v.id=ib.variant_id JOIN products p ON p.id=v.product_id
      ${membership.allOutlets ? '' : 'JOIN member_outlets mo ON mo.outlet_id=ib.outlet_id'}
      WHERE ${scope} ORDER BY p.name,v.label LIMIT 200`,
    )
      .bind(...bindings)
      .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/inventory/movements', async (c) => {
    const membership = requirePermission(c, 'inventory.view');
    if (!c.env.DB) return unavailable(c);
    const outletId = c.req.query('outlet_id');
    if (
      outletId &&
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        outletId,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const scope = membership.allOutlets
      ? 'sm.business_id=? AND (? IS NULL OR sm.outlet_id=?)'
      : 'sm.business_id=? AND mo.member_id=? AND (? IS NULL OR sm.outlet_id=?)';
    const bindings = membership.allOutlets
      ? [membership.businessId, outletId ?? null, outletId ?? null]
      : [membership.businessId, membership.memberId, outletId ?? null, outletId ?? null];
    const result = await c.env.DB.prepare(
      `SELECT sm.id,sm.outlet_id,sm.variant_id,p.name,p.sku,v.label,sm.movement_type,sm.quantity_delta,sm.unit_cost_minor,sm.source_type,sm.source_id,sm.created_at
      FROM stock_movements sm JOIN product_variants v ON v.id=sm.variant_id JOIN products p ON p.id=v.product_id
      ${membership.allOutlets ? '' : 'JOIN member_outlets mo ON mo.outlet_id=sm.outlet_id'}
      WHERE ${scope} ORDER BY sm.created_at DESC,sm.id DESC LIMIT 100`,
    )
      .bind(...bindings)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/inventory/adjustments', async (c) => {
    const membership = requirePermission(c, 'inventory.adjust');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<
      Partial<{
        outlet_id: string;
        variant_id: string;
        quantity_delta: string | number;
        unit_cost_minor: string | number;
        reason: string;
        idempotency_key: string;
      }>
    >();
    const delta = integer(body.quantity_delta);
    const cost = integer(body.unit_cost_minor ?? 0);
    const idempotencyKey = body.idempotency_key?.trim();
    if (
      !body.outlet_id ||
      !body.variant_id ||
      delta === undefined ||
      delta === 0 ||
      cost === undefined ||
      cost < 0 ||
      !body.reason?.trim() ||
      (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey))
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Outlet, variant, quantity, cost, reason and a valid idempotency key are required',
          },
        },
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
    const variant = await c.env.DB.prepare(
      "SELECT id FROM product_variants WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(body.variant_id, membership.businessId)
      .first();
    if (!variant) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const balance = await c.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(membership.businessId, body.outlet_id, body.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    if (!balance)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Inventory balance not found' } }, 404);
    const sourceId = idempotencyKey ? `adjustment:${idempotencyKey}` : createId();
    if (idempotencyKey) {
      const previous = await c.env.DB.prepare(
        'SELECT 1 FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? AND variant_id=? AND movement_type=?',
      )
        .bind(membership.businessId, 'adjustment', sourceId, body.variant_id, 'adjustment')
        .first();
      if (previous)
        return adjustmentResult(
          c.env.DB,
          membership.businessId,
          body.outlet_id,
          body.variant_id,
          sourceId,
          true,
        );
    }
    const now = new Date().toISOString();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand+?,average_cost_minor=CASE WHEN quantity_on_hand > 0 AND quantity_on_hand+? > 0 THEN CAST((quantity_on_hand * average_cost_minor + ? * ? + (quantity_on_hand + ?)/2) / (quantity_on_hand + ?) AS INTEGER) WHEN quantity_on_hand+? > 0 THEN ? ELSE 0 END,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=? AND quantity_on_hand+? >= 0',
        ).bind(
          delta,
          delta,
          delta,
          cost,
          delta,
          delta,
          delta,
          cost,
          now,
          membership.businessId,
          body.outlet_id,
          body.variant_id,
          delta,
        ),
        c.env.DB.prepare(
          `INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,client_transaction_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`,
        ).bind(
          createId(),
          membership.businessId,
          body.outlet_id,
          body.variant_id,
          'adjustment',
          delta,
          cost,
          'adjustment',
          sourceId,
          membership.memberId,
          idempotencyKey ?? null,
          now,
        ),
      ]);
    } catch (error) {
      const duplicate = idempotencyKey
        ? await c.env.DB.prepare(
            'SELECT 1 FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? AND variant_id=? AND movement_type=?',
          )
            .bind(membership.businessId, 'adjustment', sourceId, body.variant_id, 'adjustment')
            .first()
        : null;
      if (duplicate)
        return adjustmentResult(
          c.env.DB,
          membership.businessId,
          body.outlet_id,
          body.variant_id,
          sourceId,
          true,
        );
      throw error;
    }
    const movement = await c.env.DB.prepare(
      'SELECT 1 FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? AND variant_id=? AND movement_type=?',
    )
      .bind(membership.businessId, 'adjustment', sourceId, body.variant_id, 'adjustment')
      .first();
    if (!movement)
      return c.json(
        { error: { code: 'INSUFFICIENT_STOCK', message: 'Adjustment would make stock negative' } },
        409,
      );
    return adjustmentResult(
      c.env.DB,
      membership.businessId,
      body.outlet_id,
      body.variant_id,
      sourceId,
      false,
      201,
    );
  });
}
async function adjustmentResult(
  db: D1Database,
  businessId: string,
  outletId: string,
  variantId: string,
  sourceId: string,
  idempotent: boolean,
  status = 200,
): Promise<Response> {
  const balance = await db
    .prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
    .bind(businessId, outletId, variantId)
    .first<{ quantity_on_hand: number; average_cost_minor: number }>();
  return new Response(
    JSON.stringify({
      data: {
        source_id: sourceId,
        outlet_id: outletId,
        variant_id: variantId,
        quantity_on_hand: balance?.quantity_on_hand ?? 0,
        average_cost_minor: balance?.average_cost_minor ?? 0,
        idempotent,
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function withoutCosts<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'cost_minor' | 'variant_cost_minor'> {
  const publicRow = { ...row };
  delete publicRow.cost_minor;
  delete publicRow.variant_cost_minor;
  return publicRow;
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
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
