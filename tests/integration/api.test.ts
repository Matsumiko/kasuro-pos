type ApiData = {
  [key: string]: unknown;
  [index: number]: ApiData;
  id?: string;
  variant_id?: string;
  total_minor?: number;
  status?: string;
  sale_status?: string;
  outlet_id?: string;
  auth_token?: string;
  csrf_token?: string;
  user?: { id: string };
};

type ApiBody = { data: ApiData; error?: { code: string } };

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../../apps/api/src/index';

type TestEnv = {
  DB: D1Database;
  ENVIRONMENT: string;
  API_VERSION: string;
  WEB_ORIGIN: string;
  SESSION_COOKIE_NAME: string;
};

type Auth = { token: string; csrf: string; userId: string };

const proxies: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  while (proxies.length) await proxies.pop()!.dispose();
});

describe('API integration over isolated local D1', () => {
  it('registers a merchant, completes a sale and refund, and enforces outlet scope', async () => {
    const proxy = await getPlatformProxy<TestEnv>({
      configPath: 'wrangler.toml',
      persist: false,
      remoteBindings: false,
    });
    proxies.push(proxy);
    await applyMigrations(proxy.env.DB);

    const owner = await register(proxy.env, 'owner@example.test');
    const business = await request(proxy.env, '/api/v1/businesses', {
      method: 'POST',
      auth: owner,
      body: { name: 'Scope Demo', slug: 'scope-demo', timezone: 'Asia/Jakarta' },
    });
    expect(business.status).toBe(201);
    const businessId = business.body.data.id as string;
    const customer = await request(proxy.env, `/api/v1/businesses/${businessId}/customers`, {
      method: 'POST',
      auth: owner,
      body: { customer_code: 'CUS-001', name: 'Ayu Customer', phone: '08123456789' },
    });
    expect(customer.status).toBe(201);
    const customerId = customer.body.data.id as string;
    const loyalty = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/loyalty/adjust`,
      {
        method: 'POST',
        auth: owner,
        body: { points_delta: 100, reason: 'Welcome bonus' },
      },
    );
    expect(loyalty.status).toBe(201);
    expect(loyalty.body.data.points_balance).toBe(100);
    const loyaltyDebit = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/loyalty/adjust`,
      {
        method: 'POST',
        auth: owner,
        body: { points_delta: -40, reason: 'Redeemed reward' },
      },
    );
    expect(loyaltyDebit.status).toBe(201);
    expect(loyaltyDebit.body.data.points_balance).toBe(60);
    const creditLimit = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/credit`,
      {
        method: 'PUT',
        auth: owner,
        body: { credit_limit_minor: 100000 },
      },
    );
    expect(creditLimit.status).toBe(200);
    const creditCharge = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/credit/charge`,
      {
        method: 'POST',
        auth: owner,
        body: { amount_minor: 25000, source_id: 'invoice-001' },
      },
    );
    expect(creditCharge.status).toBe(201);
    expect(creditCharge.body.data.balance_minor).toBe(25000);
    const creditPayment = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/credit/payment`,
      {
        method: 'POST',
        auth: owner,
        body: { amount_minor: 10000 },
      },
    );
    expect(creditPayment.status).toBe(201);
    const customerHistory = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/history`,
      { auth: owner },
    );
    expect(customerHistory.status).toBe(200);
    expect(customerHistory.body.data.loyalty_account.points_balance).toBe(60);
    expect(customerHistory.body.data.credit_account).toMatchObject({
      credit_limit_minor: 100000,
      balance_minor: 15000,
    });
    expect(customerHistory.body.data.loyalty_ledger).toHaveLength(2);
    const negativeLoyalty = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/loyalty/adjust`,
      {
        method: 'POST',
        auth: owner,
        body: { points_delta: -61, reason: 'Too many points' },
      },
    );
    expect(negativeLoyalty.status).toBe(409);
    expect(negativeLoyalty.body.error?.code).toBe('CONFLICT');
    const overCredit = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/${customerId}/credit/charge`,
      {
        method: 'POST',
        auth: owner,
        body: { amount_minor: 90000, source_id: 'invoice-over-limit' },
      },
    );
    expect(overCredit.status).toBe(409);
    expect(overCredit.body.error?.code).toBe('CREDIT_LIMIT');
    const missingCustomer = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers/not-a-customer/loyalty`,
      { auth: owner },
    );
    expect(missingCustomer.status).toBe(404);
    expect(customerHistory.body.data.credit_ledger).toHaveLength(2);

    const malang = await createOutlet(proxy.env, owner, businessId, 'MALANG', 'Malang');
    const batu = await createOutlet(proxy.env, owner, businessId, 'BATU', 'Batu');
    const product = await request(proxy.env, `/api/v1/businesses/${businessId}/products`, {
      method: 'POST',
      auth: owner,
      body: {
        name: 'Coffee',
        sku: 'COFFEE-001',
        label: 'Regular',
        price_minor: 20000,
        cost_minor: 10000,
      },
    });
    expect(product.status).toBe(201);

    const ownerInventory = await request(proxy.env, `/api/v1/businesses/${businessId}/inventory`, {
      auth: owner,
    });
    expect(ownerInventory.status).toBe(200);
    expect(ownerInventory.body.data).toHaveLength(2);
    const supplier = await request(proxy.env, `/api/v1/businesses/${businessId}/suppliers`, {
      method: 'POST',
      auth: owner,
      body: { supplier_code: 'SUP-001', name: 'Bean Supplier' },
    });
    expect(supplier.status).toBe(201);
    const purchase = await request(proxy.env, `/api/v1/businesses/${businessId}/purchases`, {
      method: 'POST',
      auth: owner,
      body: {
        supplier_id: supplier.body.data.id,
        outlet_id: batu.body.data.id,
        lines: [{ variant_id: product.body.data.variant_id, quantity: 4, unit_cost_minor: 12000 }],
      },
    });
    expect(purchase.status).toBe(201);
    expect(purchase.body.data.status).toBe('ordered');
    const purchaseLine = await proxy.env.DB.prepare(
      'SELECT id FROM purchase_order_lines WHERE purchase_order_id=?',
    )
      .bind(purchase.body.data.id)
      .first<{ id: string }>();
    expect(purchaseLine?.id).toBeTruthy();
    const firstReceipt = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases/${purchase.body.data.id}/receive`,
      {
        method: 'POST',
        auth: owner,
        body: { receipt_id: 'receipt-001', lines: [{ line_id: purchaseLine!.id, quantity: 2 }] },
      },
    );
    expect(firstReceipt.status).toBe(200);
    expect(firstReceipt.body.data.status).toBe('partially_received');
    const overReceipt = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases/${purchase.body.data.id}/receive`,
      {
        method: 'POST',
        auth: owner,
        body: { lines: [{ line_id: purchaseLine!.id, quantity: 3 }] },
      },
    );
    expect(overReceipt.status).toBe(409);
    expect(overReceipt.body.error?.code).toBe('RECEIVE_LIMIT');
    const duplicateReceipt = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases/${purchase.body.data.id}/receive`,
      {
        method: 'POST',
        auth: owner,
        body: { receipt_id: 'receipt-001', lines: [{ line_id: purchaseLine!.id, quantity: 2 }] },
      },
    );
    const expense = await request(proxy.env, `/api/v1/businesses/${businessId}/expenses`, {
      method: 'POST',
      auth: owner,
      body: {
        outlet_id: batu.body.data.id,
        amount_minor: 5000,
        category: 'Utilities',
        description: 'Internet subscription',
        expense_date: '2026-09-19',
        payment_method: 'cash',
      },
    });
    expect(expense.status).toBe(201);
    const expenseList = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/expenses?from=2026-09-19&to=2026-09-19`,
      { auth: owner },
    );
    expect(expenseList.status).toBe(200);
    expect(expenseList.body.data).toHaveLength(1);
    expect(duplicateReceipt.status).toBe(409);
    expect(duplicateReceipt.body.error?.code).toBe('CONFLICT');
    const finalReceipt = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases/${purchase.body.data.id}/receive`,
      {
        method: 'POST',
        auth: owner,
        body: { lines: [{ line_id: purchaseLine!.id, quantity: 2 }] },
      },
    );
    expect(finalReceipt.status).toBe(200);
    expect(finalReceipt.body.data.status).toBe('received');
    const receivedBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, batu.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    expect(receivedBalance).toEqual({ quantity_on_hand: 4, average_cost_minor: 12000 });
    const concurrentPurchase = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases`,
      {
        method: 'POST',
        auth: owner,
        body: {
          supplier_id: supplier.body.data.id,
          outlet_id: batu.body.data.id,
          lines: [
            { variant_id: product.body.data.variant_id, quantity: 4, unit_cost_minor: 13000 },
          ],
        },
      },
    );
    const concurrentLine = await proxy.env.DB.prepare(
      'SELECT id FROM purchase_order_lines WHERE purchase_order_id=?',
    )
      .bind(concurrentPurchase.body.data.id)
      .first<{ id: string }>();
    const concurrentReceipts = await Promise.all(
      ['receipt-concurrent-a', 'receipt-concurrent-b'].map((receipt_id) =>
        request(
          proxy.env,
          `/api/v1/businesses/${businessId}/purchases/${concurrentPurchase.body.data.id}/receive`,
          {
            method: 'POST',
            auth: owner,
            body: { receipt_id, lines: [{ line_id: concurrentLine!.id, quantity: 2 }] },
          },
        ),
      ),
    );
    expect(concurrentReceipts.every((receipt) => receipt.status === 200)).toBe(true);
    const concurrentBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, batu.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    expect(concurrentBalance).toEqual({ quantity_on_hand: 8, average_cost_minor: 12500 });
    const transfer = await request(proxy.env, `/api/v1/businesses/${businessId}/stock-transfers`, {
      method: 'POST',
      auth: owner,
      body: {
        source_outlet_id: batu.body.data.id,
        destination_outlet_id: malang.body.data.id,
        lines: [{ variant_id: product.body.data.variant_id, quantity: 2 }],
      },
    });
    expect(transfer.status).toBe(201);
    const concurrentSends = await Promise.all(
      [1, 2].map(() =>
        request(
          proxy.env,
          `/api/v1/businesses/${businessId}/stock-transfers/${transfer.body.data.id}/send`,
          { method: 'POST', auth: owner },
        ),
      ),
    );
    expect(concurrentSends.every((response) => response.status === 200)).toBe(true);
    const transferBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, batu.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number }>();
    expect(transferBalance?.quantity_on_hand).toBe(6);
    const transferMovements = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND source_type='stock_transfer' AND source_id=? AND movement_type='transfer_out'",
    )
      .bind(businessId, transfer.body.data.id)
      .first<{ count: number }>();
    expect(transferMovements?.count).toBe(1);
    const concurrentReceives = await Promise.all(
      [1, 2].map(() =>
        request(
          proxy.env,
          `/api/v1/businesses/${businessId}/stock-transfers/${transfer.body.data.id}/receive`,
          { method: 'POST', auth: owner },
        ),
      ),
    );
    expect(concurrentReceives.every((response) => response.status === 200)).toBe(true);
    const receiveBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, malang.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number }>();
    expect(receiveBalance?.quantity_on_hand).toBe(2);
    const receiveMovements = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND source_type='stock_transfer' AND source_id=? AND movement_type='transfer_in'",
    )
      .bind(businessId, transfer.body.data.id)
      .first<{ count: number }>();
    expect(receiveMovements?.count).toBe(1);
    const stockCount = await request(proxy.env, `/api/v1/businesses/${businessId}/stock-counts`, {
      method: 'POST',
      auth: owner,
      body: {
        outlet_id: batu.body.data.id,
        lines: [{ variant_id: product.body.data.variant_id, physical_quantity: 7 }],
      },
    });
    expect(stockCount.status).toBe(201);
    const concurrentPosts = await Promise.all(
      [1, 2].map(() =>
        request(
          proxy.env,
          `/api/v1/businesses/${businessId}/stock-counts/${stockCount.body.data.id}/post`,
          { method: 'POST', auth: owner },
        ),
      ),
    );
    expect(concurrentPosts.every((response) => response.status === 200)).toBe(true);
    const countBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, batu.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number }>();
    expect(countBalance?.quantity_on_hand).toBe(7);
    const countMovements = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND source_type='stock_count' AND source_id=? AND movement_type='stock_count'",
    )
      .bind(businessId, stockCount.body.data.id)
      .first<{ count: number }>();
    expect(countMovements?.count).toBe(1);
    const concurrentAdjustments = await Promise.all(
      ['adjustment-a', 'adjustment-b'].map((idempotency_key) =>
        request(proxy.env, `/api/v1/businesses/${businessId}/inventory/adjustments`, {
          method: 'POST',
          auth: owner,
          body: {
            outlet_id: batu.body.data.id,
            variant_id: product.body.data.variant_id,
            quantity_delta: 1,
            unit_cost_minor: 13000,
            reason: 'Concurrent recount',
            idempotency_key,
          },
        }),
      ),
    );
    expect(concurrentAdjustments.every((response) => response.status === 201)).toBe(true);
    const adjustedBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, batu.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    expect(adjustedBalance).toEqual({ quantity_on_hand: 9, average_cost_minor: 12612 });
    const rejectedAdjustment = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/inventory/adjustments`,
      {
        method: 'POST',
        auth: owner,
        body: {
          outlet_id: batu.body.data.id,
          variant_id: product.body.data.variant_id,
          quantity_delta: -10,
          unit_cost_minor: 13000,
          reason: 'Negative stock guard',
          idempotency_key: 'adjustment-negative',
        },
      },
    );
    expect(rejectedAdjustment.status).toBe(409);
    expect(rejectedAdjustment.body.error.code).toBe('INSUFFICIENT_STOCK');

    const purchaseListBeforeRestriction = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases`,
      { auth: owner },
    );
    expect(purchaseListBeforeRestriction.status).toBe(200);
    expect(purchaseListBeforeRestriction.body.data).toHaveLength(2);
    const registerRow = await proxy.env.DB.prepare(
      'SELECT id FROM registers WHERE business_id=? AND outlet_id=?',
    )
      .bind(businessId, malang.body.data.id)
      .first<{ id: string }>();
    expect(registerRow?.id).toBeTruthy();
    const stock = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/inventory/adjustments`,
      {
        method: 'POST',
        auth: owner,
        body: {
          outlet_id: malang.body.data.id,
          variant_id: product.body.data.variant_id,
          quantity_delta: 2,
          unit_cost_minor: 10000,
          reason: 'Opening stock',
          idempotency_key: 'opening-stock-1',
        },
      },
    );
    expect(stock.status).toBe(201);
    const shift = await request(proxy.env, `/api/v1/businesses/${businessId}/shifts`, {
      method: 'POST',
      auth: owner,
      body: { outlet_id: malang.body.data.id, register_id: registerRow!.id, opening_cash_minor: 0 },
    });
    expect(shift.status).toBe(201);
    const sale = await request(proxy.env, `/api/v1/businesses/${businessId}/sales`, {
      method: 'POST',
      auth: owner,
      body: {
        outlet_id: malang.body.data.id,
        register_id: registerRow!.id,
        shift_id: shift.body.data.id,
        client_transaction_id: 'sale-1',
        lines: [{ variant_id: product.body.data.variant_id, quantity: 1 }],
        payments: [{ method: 'cash', amount_minor: 20000 }],
      },
    });
    expect(sale.status).toBe(201);
    expect(sale.body.data.total_minor).toBe(20000);
    const raceOutlet = await createOutlet(proxy.env, owner, businessId, 'RACE', 'Race Outlet');
    const raceRegister = await proxy.env.DB.prepare(
      'SELECT id FROM registers WHERE business_id=? AND outlet_id=?',
    )
      .bind(businessId, raceOutlet.body.data.id)
      .first<{ id: string }>();
    await proxy.env.DB.prepare(
      'INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,?,?,?)',
    )
      .bind(
        businessId,
        raceOutlet.body.data.id,
        product.body.data.variant_id,
        0,
        10000,
        new Date().toISOString(),
      )
      .run();
    const raceStock = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/inventory/adjustments`,
      {
        method: 'POST',
        auth: owner,
        body: {
          outlet_id: raceOutlet.body.data.id,
          variant_id: product.body.data.variant_id,
          quantity_delta: 1,
          unit_cost_minor: 10000,
          reason: 'Sale race stock',
          idempotency_key: 'sale-race-stock',
        },
      },
    );
    expect(raceStock.status).toBe(201);
    const raceShift = await request(proxy.env, `/api/v1/businesses/${businessId}/shifts`, {
      method: 'POST',
      auth: owner,
      body: {
        outlet_id: raceOutlet.body.data.id,
        register_id: raceRegister!.id,
        opening_cash_minor: 0,
      },
    });
    expect(raceShift.status).toBe(201);
    const raceSales = await Promise.all(
      ['sale-race-a', 'sale-race-b'].map((client_transaction_id) =>
        request(proxy.env, `/api/v1/businesses/${businessId}/sales`, {
          method: 'POST',
          auth: owner,
          body: {
            outlet_id: raceOutlet.body.data.id,
            register_id: raceRegister!.id,
            shift_id: raceShift.body.data.id,
            client_transaction_id,
            lines: [{ variant_id: product.body.data.variant_id, quantity: 1 }],
            payments: [{ method: 'cash', amount_minor: 20000 }],
          },
        }),
      ),
    );
    expect(raceSales.map((response) => response.status).sort()).toEqual([201, 409]);
    const raceBalance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, raceOutlet.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number }>();
    expect(raceBalance?.quantity_on_hand).toBe(0);
    const raceMovements = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND outlet_id=? AND variant_id=? AND movement_type='sale'",
    )
      .bind(businessId, raceOutlet.body.data.id, product.body.data.variant_id)
      .first<{ count: number }>();
    expect(raceMovements?.count).toBe(1);
    const saleLine = await proxy.env.DB.prepare('SELECT id FROM sale_lines WHERE sale_id=?')
      .bind(sale.body.data.id)
      .first<{ id: string }>();
    expect(saleLine?.id).toBeTruthy();
    const offlinePayload = {
      client_transaction_id: 'offline-sale-1',
      outlet_id: malang.body.data.id,
      register_id: registerRow!.id,
      shift_id: shift.body.data.id,
      lines: [{ variant_id: product.body.data.variant_id, quantity: 1 }],
      payment: { method: 'cash', amount_minor: 20000 },
    };
    const syncedSale = await request(proxy.env, `/api/v1/businesses/${businessId}/sync/sales`, {
      method: 'POST',
      auth: owner,
      headers: { 'Idempotency-Key': 'offline-key-001' },
      body: offlinePayload,
    });
    expect(syncedSale.status).toBe(201);
    expect(syncedSale.body.data.status).toBe('completed');
    const replayedSale = await request(proxy.env, `/api/v1/businesses/${businessId}/sync/sales`, {
      method: 'POST',
      auth: owner,
      headers: { 'Idempotency-Key': 'offline-key-001' },
      body: offlinePayload,
    });
    expect(replayedSale.status).toBe(200);
    expect(replayedSale.body.idempotent).toBe(true);
    expect(replayedSale.body.data.id).toBe(syncedSale.body.data.id);
    const reusedKey = await request(proxy.env, `/api/v1/businesses/${businessId}/sync/sales`, {
      method: 'POST',
      auth: owner,
      headers: { 'Idempotency-Key': 'offline-key-001' },
      body: { ...offlinePayload, client_transaction_id: 'offline-sale-other' },
    });
    expect(reusedKey.status).toBe(409);
    expect(reusedKey.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const unsupportedPayment = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/sync/sales`,
      {
        method: 'POST',
        auth: owner,
        headers: { 'Idempotency-Key': 'offline-key-card' },
        body: {
          ...offlinePayload,
          client_transaction_id: 'offline-sale-card',
          payment: { method: 'qris', amount_minor: 20000 },
        },
      },
    );
    expect(unsupportedPayment.status).toBe(422);
    expect(unsupportedPayment.body.error?.code).toBe('OFFLINE_PAYMENT_UNSUPPORTED');
    const refund = await request(proxy.env, `/api/v1/businesses/${businessId}/refunds`, {
      method: 'POST',
      auth: owner,
      body: {
        sale_id: sale.body.data.id,
        reason: 'Customer return',
        payment_method: 'cash',
        lines: [{ sale_line_id: saleLine!.id, quantity: 1 }],
      },
      headers: { 'Idempotency-Key': 'refund-1' },
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.status).toBe('completed');
    expect(refund.body.data.sale_status).toBe('refunded');
    const report = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/reports/summary?date_from=2026-09-19&date_to=2026-09-19`,
      { auth: owner },
    );
    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject({
      transaction_count: 3,
      net_sales_minor: 60000,
      expenses_minor: 5000,
      operating_result_minor: 25000,
    });
    const archivedExpense = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/expenses/${expense.body.data.id}`,
      {
        method: 'PATCH',
        auth: owner,
        body: { status: 'archived' },
      },
    );
    expect(archivedExpense.status).toBe(200);
    const emptyExpenseList = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/expenses?from=2026-09-19&to=2026-09-19`,
      { auth: owner },
    );
    expect(emptyExpenseList.status).toBe(200);
    expect(emptyExpenseList.body.data).toHaveLength(0);

    const restricted = await register(proxy.env, 'staff@example.test');
    const role = await proxy.env.DB.prepare(
      "SELECT id FROM roles WHERE key='inventory_staff' AND business_id IS NULL",
    ).first<{ id: string }>();
    const memberId = 'member-restricted';
    expect(role?.id).toBe('role-inventory');
    await proxy.env.DB.batch([
      proxy.env.DB.prepare(
        "INSERT INTO business_members(id,business_id,user_id,status,all_outlets,joined_at,created_at,updated_at) VALUES(?,?,?,'active',0,datetime('now'),datetime('now'),datetime('now'))",
      ).bind(memberId, businessId, restricted.userId),
      proxy.env.DB.prepare('INSERT INTO member_roles(member_id,role_id) VALUES(?,?)').bind(
        memberId,
        role.id,
      ),
      proxy.env.DB.prepare('INSERT INTO member_outlets(member_id,outlet_id) VALUES(?,?)').bind(
        memberId,
        malang.body.data.id,
      ),
    ]);
    await proxy.env.DB.prepare('INSERT INTO member_roles(member_id,role_id) VALUES(?,?)')
      .bind(memberId, 'role-cashier')
      .run();
    const cashierOnly = await register(proxy.env, 'cashier-only@example.test');
    const cashierMemberId = 'member-cashier-only';
    await proxy.env.DB.batch([
      proxy.env.DB.prepare(
        "INSERT INTO business_members(id,business_id,user_id,status,all_outlets,joined_at,created_at,updated_at) VALUES(?,?,?,'active',0,datetime('now'),datetime('now'),datetime('now'))",
      ).bind(cashierMemberId, businessId, cashierOnly.userId),
      proxy.env.DB.prepare('INSERT INTO member_roles(member_id,role_id) VALUES(?,?)').bind(
        cashierMemberId,
        'role-cashier',
      ),
      proxy.env.DB.prepare('INSERT INTO member_outlets(member_id,outlet_id) VALUES(?,?)').bind(
        cashierMemberId,
        malang.body.data.id,
      ),
    ]);
    const cashierProducts = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/products?q=Coffee`,
      { auth: cashierOnly },
    );
    expect(cashierProducts.status).toBe(200);
    expect(cashierProducts.body.data[0]).not.toHaveProperty('cost_minor');
    expect(cashierProducts.body.data[0]).not.toHaveProperty('variant_cost_minor');
    const cashierProductDetail = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/products/${product.body.data.id}`,
      { auth: cashierOnly },
    );
    expect(cashierProductDetail.status).toBe(200);
    expect(cashierProductDetail.body.data).not.toHaveProperty('cost_minor');
    expect(cashierProductDetail.body.data.variants[0]).not.toHaveProperty('cost_minor');
    const restrictedSync = await request(proxy.env, `/api/v1/businesses/${businessId}/sync/sales`, {
      method: 'POST',
      auth: restricted,
      headers: { 'Idempotency-Key': 'offline-restricted-001' },
      body: {
        client_transaction_id: 'offline-restricted-001',
        outlet_id: batu.body.data.id,
        register_id: registerRow!.id,
        shift_id: shift.body.data.id,
        lines: [{ variant_id: product.body.data.variant_id, quantity: 1 }],
        payment: { method: 'cash', amount_minor: 20000 },
      },
    });
    expect(restrictedSync.status).toBe(404);
    const restrictedPurchases = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases`,
      { auth: restricted },
    );
    expect(restrictedPurchases.status).toBe(200);
    const restrictedPurchaseDetail = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/purchases/${purchase.body.data.id}`,
      { auth: restricted },
    );
    expect(restrictedPurchaseDetail.status).toBe(404);
    const restrictedCustomer = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/customers`,
      { auth: restricted },
    );
    expect(restrictedCustomer.status).toBe(200);

    const allowed = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/inventory?outlet_id=${malang.body.data.id}`,
      { auth: restricted },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toHaveLength(1);
    expect(allowed.body.data[0].outlet_id).toBe(malang.body.data.id);

    const denied = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/inventory?outlet_id=${batu.body.data.id}`,
      { auth: restricted },
    );
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');
    const restrictedExpenses = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/expenses`,
      { auth: restricted },
    );
    expect(restrictedExpenses.status).toBe(403);
    const restrictedReports = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/reports/summary?date_from=2026-09-19&date_to=2026-09-19`,
      { auth: restricted },
    );
    expect(restrictedReports.status).toBe(403);
  }, 30_000);
  it('validates imports, posts opening stock once, and preserves tenant export scope', async () => {
    const proxy = await getPlatformProxy<TestEnv>({
      configPath: 'wrangler.toml',
      persist: false,
      remoteBindings: false,
    });
    proxies.push(proxy);
    await applyMigrations(proxy.env.DB);
    const owner = await register(proxy.env, 'import-owner@example.test');
    const business = await request(proxy.env, '/api/v1/businesses', {
      method: 'POST',
      auth: owner,
      body: { name: 'Import Demo', slug: 'import-demo', timezone: 'Asia/Jakarta' },
    });
    const businessId = business.body.data.id as string;
    const outlet = await createOutlet(proxy.env, owner, businessId, 'MAIN', 'Main Outlet');
    const product = await request(proxy.env, `/api/v1/businesses/${businessId}/products`, {
      method: 'POST',
      auth: owner,
      body: {
        name: 'Imported Coffee',
        sku: 'IMPORT-001',
        label: 'Regular',
        price_minor: 20000,
        cost_minor: 10000,
      },
    });
    const opening = await request(proxy.env, `/api/v1/businesses/${businessId}/imports`, {
      method: 'POST',
      auth: owner,
      body: {
        import_type: 'opening_stock',
        filename: 'opening.json',
        rows: [{ sku: 'IMPORT-001', outlet_code: 'MAIN', quantity: 5, unit_cost_minor: 12000 }],
      },
    });
    expect(opening.status).toBe(201);
    const validation = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${opening.body.data.id}/validate`,
      { method: 'POST', auth: owner },
    );
    expect(validation.status).toBe(200);
    const detail = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${opening.body.data.id}`,
      { auth: owner },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.rows).toHaveLength(1);
    expect(detail.body.data.rows[0].status).toBe('valid');

    const restricted = await register(proxy.env, 'import-restricted@example.test');
    const restrictedMemberId = 'import-restricted-member';
    await proxy.env.DB.batch([
      proxy.env.DB.prepare(
        "INSERT INTO business_members(id,business_id,user_id,status,all_outlets,joined_at,created_at,updated_at) VALUES(?,?,?,'active',0,datetime('now'),datetime('now'),datetime('now'))",
      ).bind(restrictedMemberId, businessId, restricted.userId),
      proxy.env.DB.prepare('INSERT INTO member_roles(member_id,role_id) VALUES(?,?)').bind(
        restrictedMemberId,
        'role-inventory',
      ),
      proxy.env.DB.prepare('INSERT INTO member_outlets(member_id,outlet_id) VALUES(?,?)').bind(
        restrictedMemberId,
        outlet.body.data.id,
      ),
    ]);
    const restrictedOutlet = await createOutlet(
      proxy.env,
      owner,
      businessId,
      'RESTRICTED-TARGET',
      'Restricted Target',
    );
    expect(restrictedOutlet.status).toBe(201);
    const unauthorizedOpening = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports`,
      {
        method: 'POST',
        auth: owner,
        body: {
          import_type: 'opening_stock',
          filename: 'restricted-target.json',
          rows: [
            {
              sku: 'IMPORT-001',
              outlet_code: 'RESTRICTED-TARGET',
              quantity: 3,
              unit_cost_minor: 12000,
            },
          ],
        },
      },
    );
    const unauthorizedValidation = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${unauthorizedOpening.body.data.id}/validate`,
      { method: 'POST', auth: owner },
    );
    expect(unauthorizedValidation.status).toBe(200);
    const restrictedConfirmation = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${unauthorizedOpening.body.data.id}/confirm`,
      { method: 'POST', auth: restricted },
    );
    expect(restrictedConfirmation.status).toBe(404);
    const restrictedTargetMovement = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND source_type='opening_stock_import' AND outlet_id=?",
    )
      .bind(businessId, restrictedOutlet.body.data.id)
      .first<{ count: number }>();
    expect(restrictedTargetMovement?.count).toBe(0);
    const otherOwner = await register(proxy.env, 'import-other@example.test');
    const otherBusiness = await request(proxy.env, '/api/v1/businesses', {
      method: 'POST',
      auth: otherOwner,
      body: { name: 'Other Import Demo', slug: 'other-import-demo', timezone: 'Asia/Jakarta' },
    });
    const crossTenantDetail = await request(
      proxy.env,
      `/api/v1/businesses/${otherBusiness.body.data.id}/imports/${opening.body.data.id}`,
      { auth: otherOwner },
    );
    expect(crossTenantDetail.status).toBe(404);

    const confirmed = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${opening.body.data.id}/confirm`,
      { method: 'POST', auth: owner },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('imported');
    const replay = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${opening.body.data.id}/confirm`,
      { method: 'POST', auth: owner },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotent).toBe(true);
    const balance = await proxy.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(businessId, outlet.body.data.id, product.body.data.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    expect(balance).toEqual({ quantity_on_hand: 5, average_cost_minor: 12000 });
    const movement = await proxy.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE business_id=? AND source_type='opening_stock_import'",
    )
      .bind(businessId)
      .first<{ count: number }>();
    expect(movement?.count).toBe(1);
    const invalid = await request(proxy.env, `/api/v1/businesses/${businessId}/imports`, {
      method: 'POST',
      auth: owner,
      body: {
        import_type: 'opening_stock',
        filename: 'invalid.json',
        rows: [{ sku: 'MISSING', outlet_code: 'MAIN', quantity: 2, unit_cost_minor: 100 }],
      },
    });
    const invalidValidation = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${invalid.body.data.id}/validate`,
      { method: 'POST', auth: owner },
    );
    expect(invalidValidation.body.data.error_rows).toBe(1);
    const invalidConfirm = await request(
      proxy.env,
      `/api/v1/businesses/${businessId}/imports/${invalid.body.data.id}/confirm`,
      { method: 'POST', auth: owner },
    );
    expect(invalidConfirm.status).toBe(409);
    const csv = await app.fetch(
      new Request(`http://localhost/api/v1/businesses/${businessId}/export/inventory.csv`, {
        headers: {
          Authorization: `Bearer ${owner.token}`,
          'X-CSRF-Token': owner.csrf,
        },
      }),
      proxy.env,
    );
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain(outlet.body.data.id as string);
  }, 30_000);
  it('separates platform administration from tenant roles and records audit events', async () => {
    const proxy = await getPlatformProxy<TestEnv>({
      configPath: 'wrangler.toml',
      persist: false,
      remoteBindings: false,
    });
    proxies.push(proxy);
    await applyMigrations(proxy.env.DB);

    const owner = await register(proxy.env, 'platform-owner@example.test');
    const business = await request(proxy.env, '/api/v1/businesses', {
      method: 'POST',
      auth: owner,
      body: { name: 'Platform Scope Demo', slug: 'platform-scope-demo', timezone: 'Asia/Jakarta' },
    });
    const businessId = business.body.data.id as string;
    const invitationsBefore = await proxy.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM invitations WHERE business_id=?',
    )
      .bind(businessId)
      .first<{ count: number }>();
    const productionInvitation = await request(
      { ...proxy.env, ENVIRONMENT: 'production' },
      `/api/v1/businesses/${businessId}/staff/invitations`,
      {
        method: 'POST',
        auth: owner,
        body: { email: 'production-invite@example.test', role_key: 'cashier' },
      },
    );
    expect(productionInvitation.status).toBe(503);
    expect(productionInvitation.body.error?.code).toBe('INVITATION_DELIVERY_UNAVAILABLE');
    const invitationsAfter = await proxy.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM invitations WHERE business_id=?',
    )
      .bind(businessId)
      .first<{ count: number }>();
    expect(invitationsAfter?.count).toBe(invitationsBefore?.count);

    const admin = await register(proxy.env, 'platform-admin@example.test');
    const now = new Date().toISOString();
    await proxy.env.DB.prepare(
      "INSERT INTO platform_admins(user_id,status,created_at,updated_at) VALUES(?,'active',?,?)",
    )
      .bind(admin.userId, now, now)
      .run();

    const merchantMetrics = await request(proxy.env, '/api/v1/platform/metrics', { auth: owner });
    expect(merchantMetrics.status).toBe(403);
    const platformMetrics = await request(proxy.env, '/api/v1/platform/metrics', { auth: admin });
    expect(platformMetrics.status).toBe(200);
    expect(platformMetrics.body.data.users).toBe(2);

    const suspended = await request(proxy.env, `/api/v1/platform/businesses/${businessId}/status`, {
      method: 'POST',
      auth: admin,
      body: { status: 'suspended' },
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe('suspended');

    const suspendedTenant = await request(proxy.env, `/api/v1/businesses/${businessId}`, {
      auth: owner,
    });
    expect(suspendedTenant.status).toBe(404);

    const audit = await request(proxy.env, '/api/v1/platform/audit?entity_type=business&limit=1', {
      auth: admin,
    });
    expect(audit.status).toBe(200);
    expect(audit.body.data[0].action).toBe('business.suspended');
    expect(audit.body.data[0].entity_id).toBe(businessId);
  }, 30_000);
});

async function register(env: TestEnv, email: string): Promise<Auth> {
  const response = await request(env, '/api/v1/auth/register', {
    method: 'POST',
    body: { email, password: 'correct horse battery staple', display_name: email.split('@')[0] },
  });
  expect(response.status).toBe(201);
  return {
    token: response.body.data.auth_token as string,
    csrf: response.body.data.csrf_token as string,
    userId: response.body.data.user.id as string,
  };
}

async function createOutlet(
  env: TestEnv,
  auth: Auth,
  businessId: string,
  code: string,
  name: string,
): Promise<{ status: number; body: ApiBody }> {
  return request(env, `/api/v1/businesses/${businessId}/outlets`, {
    method: 'POST',
    auth,
    body: { code, name },
  });
}

async function request(
  env: TestEnv,
  path: string,
  options: {
    method?: string;
    auth?: Auth;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: ApiBody }> {
  const headers = new Headers({ Origin: 'http://localhost:5173', ...options.headers });
  if (options.auth) {
    headers.set('Authorization', `Bearer ${options.auth.token}`);
    headers.set('X-CSRF-Token', options.auth.csrf);
  }
  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    env,
  );
  const text = await response.text();
  const body = response.headers.get('content-type')?.includes('application/json')
    ? (JSON.parse(text) as ApiBody)
    : ({ data: {} } as ApiBody);
  return { status: response.status, body };
}

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationDir = 'database/migrations';
  for (const file of (await readdir(migrationDir)).sort()) {
    for (const statement of splitSql(await readFile(join(migrationDir, file), 'utf8'))) {
      await db.prepare(statement).run();
    }
  }
}

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let trigger = false;
  for (const line of sql.replace(/^\uFEFF/, '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    current += `${line}\n`;
    if (/CREATE TRIGGER\b/i.test(trimmed)) trigger = true;
    if (trigger ? /^END;\s*$/i.test(trimmed) : trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
      trigger = false;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) => !/^PRAGMA\b/i.test(statement));
}
