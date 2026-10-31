import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * 注文台帳の権限とアカウント境界。
 *
 * 注文台帳は日々の発送作業のため staff も使う。ただし
 * - お金が動く返品・返金、発送済み注文の取り消しは管理者以上
 * - 一括進捗・履歴は、指定した LINE アカウントの注文にしか触れない
 * ことをここで固定する。
 */

type Role = 'owner' | 'admin' | 'staff';

const state = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  lifecycleCalls: 0,
  historyCalls: 0,
}));

vi.mock('@line-crm/db', () => ({
  getOrder: async () => state.order,
  getOrderStatusHistory: async () => {
    state.historyCalls++;
    return [];
  },
  updateOrderLifecycle: async () => {
    state.lifecycleCalls++;
    return { ...state.order, lifecycle_status: 'returned' };
  },
  createOrder: async () => { throw new Error('not used'); },
  listOrders: async () => [],
  recordOrderShippingNotification: async () => null,
  transitionOrder: async () => null,
  updateOrder: async () => null,
  jstNow: () => '2026-10-31T00:00:00+09:00',
}));

const { orders } = await import('./orders.js');

const bulkSql: string[] = [];
const bulkBinds: unknown[][] = [];
function fakeDb(eligibleIds: string[]): D1Database {
  return {
    prepare(sql: string) {
      bulkSql.push(sql);
      return {
        bind(...args: unknown[]) {
          bulkBinds.push(args);
          return { all: async () => ({ results: eligibleIds.map((id) => ({ id })) }) };
        },
      };
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function appAs(role: Role, eligibleIds: string[] = []) {
  const app = new Hono<{ Variables: { staff: { id: string; role: Role } }; Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role });
    c.env = { DB: fakeDb(eligibleIds) } as never;
    await next();
  });
  app.route('/', orders);
  return app;
}

function shippedOrder() {
  return {
    id: 'o1', line_account_id: 'acc1', status: 'shipped', lifecycle_status: 'active',
    lifecycle_reason: null, refund_type: 'none', refund_status: 'not_required', refund_amount: null,
    items: [{ id: 'i1', item_name: '漢方薬', quantity: 1, quantity_unit: '個', unit_price: 3000 }],
    updated_at: 't1',
  };
}

function lifecycle(role: Role, action: string, order = shippedOrder()) {
  state.order = order;
  return appAs(role).request('/api/orders/o1/lifecycle', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lineAccountId: 'acc1', expectedUpdatedAt: 't1', action, reason: 'テスト',
      refundType: 'full', refundStatus: 'pending',
    }),
  });
}

beforeEach(() => {
  state.order = null;
  state.lifecycleCalls = 0;
  state.historyCalls = 0;
  bulkSql.length = 0;
  bulkBinds.length = 0;
});

describe('返品・返金と発送済みの取り消しは管理者以上', () => {
  for (const action of ['return_refund', 'void']) {
    test(`staff の ${action}（発送済み）は 403 で、保存されない`, async () => {
      const res = await lifecycle('staff', action);
      expect(res.status).toBe(403);
      expect(state.lifecycleCalls).toBe(0);
    });
    test(`admin の ${action}（発送済み）は通る`, async () => {
      const res = await lifecycle('admin', action);
      expect(res.status).toBe(200);
      expect(state.lifecycleCalls).toBe(1);
    });
  }

  test('staff の返金更新は 403', async () => {
    const res = await lifecycle('staff', 'update_refund', { ...shippedOrder(), lifecycle_status: 'returned' });
    expect(res.status).toBe(403);
    expect(state.lifecycleCalls).toBe(0);
  });

  test('staff でも発送前のキャンセルはできる', async () => {
    const res = await lifecycle('staff', 'cancel', { ...shippedOrder(), status: 'preparing' });
    expect(res.status).toBe(200);
    expect(state.lifecycleCalls).toBe(1);
  });

  test('staff でも発送前の誤登録の取り消しはできる', async () => {
    const res = await lifecycle('staff', 'void', { ...shippedOrder(), status: 'unconfirmed' });
    expect(res.status).toBe(200);
  });
});

describe('一括進捗は指定アカウントの注文だけ', () => {
  test('lineAccountId が無いと 400 で DB に触れない', async () => {
    const res = await appAs('staff', ['o1']).request('/api/orders/bulk-advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['o1'], status: 'preparing' }),
    });
    expect(res.status).toBe(400);
    expect(bulkSql).toHaveLength(0);
  });

  test('他アカウントの注文が混ざると 409', async () => {
    // DB はアカウント条件で絞った結果として o1 だけを返す（o2 は別アカウント）
    const res = await appAs('staff', ['o1']).request('/api/orders/bulk-advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'acc1', ids: ['o1', 'o2'], status: 'preparing' }),
    });
    expect(res.status).toBe(409);
    expect(bulkSql[0]).toContain('line_account_id = ?');
    expect(bulkBinds[0]).toContain('acc1');
  });

  test('同じアカウントの注文なら通る', async () => {
    const res = await appAs('staff', ['o1']).request('/api/orders/bulk-advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'acc1', ids: ['o1'], status: 'preparing' }),
    });
    expect(res.status).toBe(200);
    expect(bulkSql[1]).toContain('line_account_id = ?');
  });
});

describe('進捗履歴はアカウントを確認する', () => {
  test('lineAccountId が無いと 400', async () => {
    state.order = shippedOrder();
    const res = await appAs('staff').request('/api/orders/o1/history');
    expect(res.status).toBe(400);
    expect(state.historyCalls).toBe(0);
  });

  test('他アカウントの注文は 403', async () => {
    state.order = shippedOrder();
    const res = await appAs('staff').request('/api/orders/o1/history?lineAccountId=acc2');
    expect(res.status).toBe(403);
    expect(state.historyCalls).toBe(0);
  });

  test('同じアカウントなら読める', async () => {
    state.order = shippedOrder();
    const res = await appAs('staff').request('/api/orders/o1/history?lineAccountId=acc1');
    expect(res.status).toBe(200);
    expect(state.historyCalls).toBe(1);
  });
});
