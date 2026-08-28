import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { requireChartAccess } from './chart-access.js';
import type { Env } from '../index.js';

type Staff = Env['Variables']['staff'];

function appWith(staff: Staff | null) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (staff) c.set('staff', staff);
    return next();
  });
  app.use('/api/consultation-charts/*', requireChartAccess);
  app.get('/api/consultation-charts/:friendId', (c) => c.json({ success: true }));
  return app;
}

const owner: Staff = { id: 'o', name: 'オーナー', role: 'owner', canViewCharts: false };
const registered: Staff = { id: 'r', name: '登録済み', role: 'staff', canViewCharts: true };
const unregistered: Staff = { id: 'u', name: '未登録', role: 'staff', canViewCharts: false };
const unregisteredAdmin: Staff = { id: 'a', name: '未登録管理者', role: 'admin', canViewCharts: false };

const path = '/api/consultation-charts/friend-1';

describe('相談カルテは登録制', () => {
  test('オーナーは登録がなくても閲覧できる', async () => {
    const res = await appWith(owner).request(path);
    expect(res.status).toBe(200);
  });

  test('登録された担当者は閲覧できる', async () => {
    const res = await appWith(registered).request(path);
    expect(res.status).toBe(200);
  });

  test('未登録の担当者は 403 で止まる', async () => {
    const res = await appWith(unregistered).request(path);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('登録が必要');
  });

  test('管理者でも登録がなければ止まる（役割だけでは通さない）', async () => {
    const res = await appWith(unregisteredAdmin).request(path);
    expect(res.status).toBe(403);
  });

  test('認証されていなければ 401', async () => {
    const res = await appWith(null).request(path);
    expect(res.status).toBe(401);
  });
});
