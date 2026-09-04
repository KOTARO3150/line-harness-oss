import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getTags: vi.fn(),
  getTagsWithUsage: vi.fn(),
  getTagWithUsage: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  countAutomationRefs: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { tags } = await import('./tags.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

function appAs(role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role });
    c.env = { DB: {} as D1Database };
    await next();
  });
  app.route('/', tags);
  return app;
}

const emptyUsage = {
  friends: 0,
  scenarioTriggers: 0,
  scenarioSteps: 0,
  forms: 0,
  entryRoutes: 0,
  trackedLinks: 0,
  bookingMenus: 0,
  affiliateOffers: 0,
  broadcasts: 0,
};

function tagRow(over: Partial<{ id: string; name: string; color: string }> = {}) {
  return {
    id: over.id ?? 't1',
    name: over.name ?? 'タグ',
    color: over.color ?? '#3B82F6',
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  // 既定は「参照ゼロ」。参照ありのケースは各テストで上書きする。
  dbMocks.countAutomationRefs.mockImplementation(
    (u: typeof emptyUsage) =>
      u.scenarioTriggers +
      u.scenarioSteps +
      u.forms +
      u.entryRoutes +
      u.trackedLinks +
      u.bookingMenus +
      u.affiliateOffers +
      u.broadcasts,
  );
});

describe('GET /api/tags', () => {
  test('既定は素の一覧（重いサブクエリを走らせない）', async () => {
    dbMocks.getTags.mockResolvedValue([tagRow()]);
    const res = await appAs('staff').request('/api/tags');
    expect(res.status).toBe(200);
    expect(dbMocks.getTagsWithUsage).not.toHaveBeenCalled();
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data[0].name).toBe('タグ');
  });

  test('withUsage=1 で参照数がつく', async () => {
    dbMocks.getTagsWithUsage.mockResolvedValue([
      { ...tagRow(), usage: { ...emptyUsage, friends: 3, scenarioTriggers: 1 } },
    ]);
    const res = await appAs('staff').request('/api/tags?withUsage=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { usage: { friends: number }; automationRefs: number }[];
    };
    expect(body.data[0].usage.friends).toBe(3);
    expect(body.data[0].automationRefs).toBe(1);
  });

  test('閲覧はどの担当者でもできる', async () => {
    dbMocks.getTags.mockResolvedValue([]);
    expect((await appAs('staff').request('/api/tags')).status).toBe(200);
  });
});

describe('POST /api/tags', () => {
  test('作成できる', async () => {
    dbMocks.createTag.mockResolvedValue(tagRow({ name: '新規' }));
    const res = await appAs('owner').request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  新規  ' }),
    });
    expect(res.status).toBe(201);
    // 前後の空白は落とす（見た目が同じで別タグ、を防ぐ）
    expect(dbMocks.createTag).toHaveBeenCalledWith(expect.anything(), {
      name: '新規',
      color: undefined,
    });
  });

  test('空の名前は 400', async () => {
    const res = await appAs('owner').request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.createTag).not.toHaveBeenCalled();
  });

  test('名前の重複は 409（500 にしない）', async () => {
    dbMocks.createTag.mockRejectedValue(
      new Error('D1_ERROR: UNIQUE constraint failed: tags.name'),
    );
    const res = await appAs('owner').request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重複' }),
    });
    expect(res.status).toBe(409);
  });

  test('staff は作成できない', async () => {
    const res = await appAs('staff').request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(dbMocks.createTag).not.toHaveBeenCalled();
  });
});

describe('PUT /api/tags/:id', () => {
  test('改名できる', async () => {
    dbMocks.updateTag.mockResolvedValue(tagRow({ name: '改名後' }));
    const res = await appAs('admin').request('/api/tags/t1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '改名後' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('改名後');
  });

  test('色の形式が不正なら 400', async () => {
    const res = await appAs('owner').request('/api/tags/t1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: 'red' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.updateTag).not.toHaveBeenCalled();
  });

  test('存在しないタグは 404', async () => {
    dbMocks.updateTag.mockResolvedValue(null);
    const res = await appAs('owner').request('/api/tags/missing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  test('staff は変更できない', async () => {
    const res = await appAs('staff').request('/api/tags/t1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/tags/:id', () => {
  test('参照が無ければ消せる', async () => {
    dbMocks.getTagWithUsage.mockResolvedValue({ ...tagRow(), usage: emptyUsage });
    const res = await appAs('owner').request('/api/tags/t1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(dbMocks.deleteTag).toHaveBeenCalled();
  });

  test('友だちに付いているだけなら消せる', async () => {
    dbMocks.getTagWithUsage.mockResolvedValue({
      ...tagRow(),
      usage: { ...emptyUsage, friends: 120 },
    });
    const res = await appAs('owner').request('/api/tags/t1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('シナリオから参照されていたら 409 で止め、何が使っているか返す', async () => {
    dbMocks.getTagWithUsage.mockResolvedValue({
      ...tagRow(),
      usage: { ...emptyUsage, scenarioTriggers: 2 },
    });
    const res = await appAs('owner').request('/api/tags/t1', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(dbMocks.deleteTag).not.toHaveBeenCalled();
    const body = (await res.json()) as {
      data: { usage: { scenarioTriggers: number }; automationRefs: number };
    };
    expect(body.data.usage.scenarioTriggers).toBe(2);
    expect(body.data.automationRefs).toBe(2);
  });

  test('force=1 なら参照があっても消せる', async () => {
    dbMocks.getTagWithUsage.mockResolvedValue({
      ...tagRow(),
      usage: { ...emptyUsage, forms: 1 },
    });
    const res = await appAs('owner').request('/api/tags/t1?force=1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.deleteTag).toHaveBeenCalled();
  });

  test('存在しないタグは 404', async () => {
    dbMocks.getTagWithUsage.mockResolvedValue(null);
    const res = await appAs('owner').request('/api/tags/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('staff は削除できない', async () => {
    const res = await appAs('staff').request('/api/tags/t1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(dbMocks.getTagWithUsage).not.toHaveBeenCalled();
  });
});
