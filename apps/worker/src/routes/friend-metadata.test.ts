import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// 友だち情報欄（friends.metadata）の編集。プロラインの「友だち情報欄」の受け皿。
const dbMocks = {
  getFriends: vi.fn(),
  getFriendById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  createFriend: vi.fn(),
  updateFriend: vi.fn(),
  deleteFriend: vi.fn(),
  getFriendTags: vi.fn(),
  addTagToFriend: vi.fn(),
  removeTagFromFriend: vi.fn(),
  getTags: vi.fn(),
  getMessagesByFriend: vi.fn(),
  getScenariosByTrigger: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-09-04T00:00:00.000Z'),
};
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn() }));

const { friends } = await import('./friends.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

/** UPDATE で渡された metadata JSON を捕まえる D1 スタブ。 */
function makeDb() {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        run: async () => {
          writes.push({ sql, params });
          return { meta: { changes: 1 } };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;
  return { db, writes };
}

function appAs(role: 'owner' | 'admin' | 'staff', db: D1Database) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role });
    c.env = { DB: db };
    await next();
  });
  app.route('/', friends);
  return app;
}

function put(app: ReturnType<typeof appAs>, body: unknown) {
  return app.request('/api/friends/f1/metadata', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 直近の UPDATE friends ... metadata に渡された JSON を取り出す。 */
function writtenMetadata(writes: { sql: string; params: unknown[] }[]) {
  const w = [...writes].reverse().find((x) => x.sql.includes('metadata'));
  return w ? (JSON.parse(String(w.params[0])) as Record<string, unknown>) : null;
}

function friendWith(metadata: string) {
  return {
    id: 'f1',
    line_user_id: 'U1',
    display_name: '山田',
    metadata,
    created_at: '',
    updated_at: '',
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) {
    if (typeof fn.mockReset === 'function') fn.mockReset();
  }
  dbMocks.jstNow.mockReturnValue('2026-09-04T00:00:00.000Z');
  dbMocks.getFriendTags.mockResolvedValue([]);
});

describe('PUT /api/friends/:id/metadata', () => {
  test('送った項目だけを足し、既存の項目は残す', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{"体質":"冷え"}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { 服薬: '当帰芍薬散' });

    expect(res.status).toBe(200);
    expect(writtenMetadata(writes)).toEqual({ 体質: '冷え', 服薬: '当帰芍薬散' });
  });

  test('null を送るとその項目を消す（打ち間違いを直せる）', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{"体質":"冷え","誤字":"x"}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { 誤字: null });

    expect(res.status).toBe(200);
    expect(writtenMetadata(writes)).toEqual({ 体質: '冷え' });
  });

  test('項目名の前後の空白は落とす', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    await put(appAs('owner', db), { '  来店きっかけ  ': '紹介' });

    expect(writtenMetadata(writes)).toEqual({ 来店きっかけ: '紹介' });
  });

  test('壊れた JSON が入っていても編集できる（作り直す）', async () => {
    // 1回目 = 保存前（壊れている）、2回目 = 保存後の読み直し。
    dbMocks.getFriendById
      .mockResolvedValueOnce(friendWith('{壊れている'))
      .mockResolvedValue(friendWith('{"体質":"冷え"}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { 体質: '冷え' });

    expect(res.status).toBe(200);
    expect(writtenMetadata(writes)).toEqual({ 体質: '冷え' });
  });

  test('空の項目名は 400', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { '   ': 'x' });

    expect(res.status).toBe(400);
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('長すぎる値は 400（長文はカルテへ）', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { メモ: 'あ'.repeat(1001) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('相談カルテ');
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('入れ子のオブジェクトは 400（画面で編集できない形を作らせない）', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), { 体質: { 型: '冷え' } });

    expect(res.status).toBe(400);
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('項目が多すぎれば 400', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 101; i++) many[`k${i}`] = 'v';
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    const res = await put(appAs('owner', db), many);

    expect(res.status).toBe(400);
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('__proto__ のような項目名は 400（保存したつもりで消えるのを防ぐ）', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db, writes } = makeDb();
    // オブジェクトリテラルで書くと prototype 設定になってしまうので、生の JSON を送る。
    const res = await appAs('owner', db).request('/api/friends/f1/metadata', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"__proto__":"x"}',
    });

    expect(res.status).toBe(400);
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('居ない友だちは 404', async () => {
    dbMocks.getFriendById.mockResolvedValue(null);
    const { db } = makeDb();
    const res = await put(appAs('owner', db), { 体質: '冷え' });
    expect(res.status).toBe(404);
  });

  test('staff は書き換えられない（健康情報が入りうるため）', async () => {
    const { db, writes } = makeDb();
    const res = await put(appAs('staff', db), { 体質: '冷え' });

    expect(res.status).toBe(403);
    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    expect(writtenMetadata(writes)).toBeNull();
  });

  test('admin は書き換えられる', async () => {
    dbMocks.getFriendById.mockResolvedValue(friendWith('{}'));
    const { db } = makeDb();
    const res = await put(appAs('admin', db), { 体質: '冷え' });
    expect(res.status).toBe(200);
  });
});
