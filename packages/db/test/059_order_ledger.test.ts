import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOrder, getOrderStatusHistory, listOrders, transitionOrder, updateOrder, updateOrderLifecycle } from '../src/orders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

type BoundStatement = D1PreparedStatement & { __run: () => D1Result };

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (query: string) => ({
    bind(...params: unknown[]) {
      const stmt = sqlite.prepare(query);
      const bound = {
        __run() {
          const result = stmt.run(...params);
          return { results: [], success: true, meta: { changes: result.changes } } as unknown as D1Result;
        },
        async run() { return bound.__run(); },
        async first<T>() { return (stmt.get(...params) as T) ?? null; },
        async all<T>() { return { results: stmt.all(...params) as T[], success: true, meta: {} }; },
      };
      return bound as unknown as D1PreparedStatement;
    },
  } as unknown as D1PreparedStatement);
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      return sqlite.transaction(() => statements.map((statement) => (statement as BoundStatement).__run()))();
    },
  } as unknown as D1Database;
}

describe('059 order ledger', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, created_at, updated_at)
       VALUES ('account-1', 'channel-1', '鈴木薬舗', 'token', 'secret', '2026-01-01', '2026-01-01')`,
    ).run();
    db = asD1(sqlite);
  });

  it('keeps an order open until all four stages are completed and records every transition', async () => {
    const order = await createOrder(db, {
      lineAccountId: 'account-1', customerName: 'お客様', source: 'line',
      shippingMethod: '宅配便', staffId: 'staff-1',
      items: [{ itemName: '漢方薬', quantity: 2, unitPrice: 5000 }],
    });
    expect(order.status).toBe('unconfirmed');
    expect(order.items).toHaveLength(1);

    let current = order;
    for (const next of ['preparing', 'ready_to_ship', 'shipped'] as const) {
      const updated = await transitionOrder(db, {
        id: order.id, fromStatus: current.status, toStatus: next, staffId: 'staff-1',
        ...(next === 'shipped' ? { carrier: '配送会社', trackingNumber: '123456' } : {}),
      });
      expect(updated?.status).toBe(next);
      current = updated!;
    }

    const history = await getOrderStatusHistory(db, order.id);
    expect(history).toHaveLength(4);
    expect(current.shipped_at).toBeTruthy();
    expect(current.tracking_number).toBe('123456');
  });

  it('does not overwrite a newer status through a stale screen', async () => {
    const order = await createOrder(db, {
      lineAccountId: 'account-1', customerName: 'お客様', staffId: 'staff-1',
      items: [{ itemName: '商品', quantity: 1 }],
    });
    expect(await transitionOrder(db, {
      id: order.id, fromStatus: 'unconfirmed', toStatus: 'preparing', staffId: 'staff-1',
    })).not.toBeNull();
    expect(await transitionOrder(db, {
      id: order.id, fromStatus: 'unconfirmed', toStatus: 'preparing', staffId: 'staff-2',
    })).toBeNull();
    expect(await getOrderStatusHistory(db, order.id)).toHaveLength(2);
  });

  it('lists orders separately from chat status and rejects invalid database states', async () => {
    await createOrder(db, {
      lineAccountId: 'account-1', customerName: 'お客様', staffId: 'staff-1',
      items: [{ itemName: '商品', quantity: 1 }],
    });
    expect(await listOrders(db, { lineAccountId: 'account-1' })).toHaveLength(1);
    expect(() => sqlite.prepare(
      `UPDATE orders SET status = 'resolved' WHERE line_account_id = 'account-1'`,
    ).run()).toThrow();
    expect(() => sqlite.prepare(
      `UPDATE order_items SET quantity = 0`,
    ).run()).toThrow();
  });

  it('edits an order at any stage, keeps its stage, unit and audit trail', async () => {
    const order = await createOrder(db, {
      lineAccountId: 'account-1', customerName: 'お客様', staffId: 'staff-1',
      items: [{ itemName: '漢方薬', quantity: 14, quantityUnit: '包', unitPrice: 300 }],
    });
    const preparing = await transitionOrder(db, {
      id: order.id, fromStatus: 'unconfirmed', toStatus: 'preparing', staffId: 'staff-1',
    });
    const updated = await updateOrder(db, {
      id: order.id, expectedUpdatedAt: preparing!.updated_at, customerName: 'お客様',
      source: 'phone', shippingMethod: '宅配便', note: '変更済み', staffId: 'staff-2',
      carrier: '佐川急便', trackingNumber: '1234567890', expectedDeliveryDate: '2026-08-18',
      deliveryTimeSlot: '14時〜16時', deliveryInstruction: '宅配ボックス',
      items: [{ itemName: '漢方薬', quantity: 21, quantityUnit: '包', unitPrice: 300 }],
    });
    expect(updated?.status).toBe('preparing');
    expect(updated?.items?.[0]).toMatchObject({ quantity: 21, quantity_unit: '包', unit_price: 300 });
    expect(updated).toMatchObject({
      carrier: '佐川急便', tracking_number: '1234567890', expected_delivery_date: '2026-08-18',
      delivery_time_slot: '14時〜16時', delivery_instruction: '宅配ボックス',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM order_edit_history WHERE order_id = ?').get(order.id))
      .toEqual({ count: 1 });
    const audit = sqlite.prepare('SELECT before_json, after_json FROM order_edit_history WHERE order_id = ?').get(order.id) as { before_json: string; after_json: string };
    expect(JSON.parse(audit.before_json)).toMatchObject({ expectedDeliveryDate: null, deliveryTimeSlot: null, deliveryInstruction: null });
    expect(JSON.parse(audit.after_json)).toMatchObject({ expectedDeliveryDate: '2026-08-18', deliveryTimeSlot: '14時〜16時', deliveryInstruction: '宅配ボックス' });
    expect(await updateOrder(db, {
      id: order.id, expectedUpdatedAt: preparing!.updated_at, customerName: '古い画面',
      source: 'line', staffId: 'staff-1', items: [{ itemName: '上書き', quantity: 1 }],
    })).toBeNull();
    expect((await listOrders(db, { lineAccountId: 'account-1' }))[0].customer_name_snapshot).toBe('お客様');
  });

  it('keeps cancellation and post-shipment refunds as auditable records without deleting orders', async () => {
    const cancelOrder = await createOrder(db, {
      lineAccountId: 'account-1', customerName: 'キャンセル対象', staffId: 'staff-1',
      items: [{ itemName: '商品', quantity: 1, unitPrice: 4000 }],
    });
    const cancelled = await updateOrderLifecycle(db, {
      id: cancelOrder.id, expectedUpdatedAt: cancelOrder.updated_at,
      lifecycleStatus: 'cancelled', reason: 'お客様都合', refundType: 'none',
      refundStatus: 'not_required', staffId: 'staff-1',
    });
    expect(cancelled).toMatchObject({ lifecycle_status: 'cancelled', status: 'unconfirmed' });

    let shipped = await createOrder(db, {
      lineAccountId: 'account-1', customerName: '返品対象', staffId: 'staff-1',
      items: [{ itemName: '商品', quantity: 2, unitPrice: 5000 }],
    });
    for (const next of ['preparing', 'ready_to_ship', 'shipped'] as const) {
      shipped = (await transitionOrder(db, {
        id: shipped.id, fromStatus: shipped.status, toStatus: next, staffId: 'staff-1',
      }))!;
    }
    const returned = await updateOrderLifecycle(db, {
      id: shipped.id, expectedUpdatedAt: shipped.updated_at,
      lifecycleStatus: 'returned', reason: '返品受付', refundType: 'partial',
      refundStatus: 'pending', refundAmount: 3000, staffId: 'staff-2',
    });
    expect(returned).toMatchObject({
      lifecycle_status: 'returned', status: 'shipped', refund_type: 'partial',
      refund_status: 'pending', refund_amount: 3000,
    });
    const refunded = await updateOrderLifecycle(db, {
      id: returned!.id, expectedUpdatedAt: returned!.updated_at,
      lifecycleStatus: 'returned', reason: '返金完了', refundType: 'partial',
      refundStatus: 'completed', refundAmount: 3000, staffId: 'staff-2',
    });
    expect(refunded?.refund_processed_at).toBeTruthy();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM order_lifecycle_history').get())
      .toEqual({ count: 3 });
    expect(await listOrders(db, { lineAccountId: 'account-1' })).toHaveLength(2);
  });
});
