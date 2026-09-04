import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * 書き込み権限のガード。
 *
 * これまで一斉配信・タグ・流入経路・計測リンク・プール・スコアは、
 * ログインさえ通れば一番低い `staff` 権限でも変更できた。一斉配信に至っては
 * お客様全員に届いてしまい取り消せない。ここでは「読めるが書けない」ことを
 * 経路ごとに固定する。
 *
 * 実装は各 route ファイル冒頭の `.on(['POST','PUT','PATCH','DELETE'], …)` 一括ガード。
 * ハンドラまで到達すると DB スタブが呼ばれてしまうので、
 * 「403 が返り、かつ DB に触れていない」ことで確認する。
 */

const dbTouched = { count: 0 };
function countingDb(): D1Database {
  return {
    prepare() {
      dbTouched.count++;
      throw new Error('DB should not be reached for a forbidden request');
    },
    batch() {
      dbTouched.count++;
      throw new Error('DB should not be reached for a forbidden request');
    },
  } as unknown as D1Database;
}

// 各 route が import する DB 関数は、呼ばれた時点でテストの前提が崩れている。
// 「呼ばれない」ことを見たいので、呼ばれたら投げるスタブにしておく。
// vi.mock のファクトリは巻き上げられるので、Proxy はこの中で組み立てる。
// `then` を返してしまうと vitest がモジュールを Promise とみなすので必ず除く。
vi.mock('@line-crm/db', () =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop === 'symbol' || prop === 'then' || prop === '__esModule') {
          return undefined;
        }
        return () => {
          throw new Error(`@line-crm/db.${String(prop)} should not be reached`);
        };
      },
    },
  ),
);

const { broadcasts } = await import('./broadcasts.js');
const { scoring } = await import('./scoring.js');
const { trackedLinks } = await import('./tracked-links.js');
const { entryRoutes } = await import('./entry-routes.js');
const { trafficPools } = await import('./traffic-pools.js');
const { tags } = await import('./tags.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function appAs(router: any, role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role });
    c.env = { DB: countingDb(), IMAGES: {} } as never;
    await next();
  });
  app.route('/', router);
  return app;
}

const forbidden: { label: string; router: unknown; method: string; path: string }[] = [
  { label: '一斉配信の作成', router: broadcasts, method: 'POST', path: '/api/broadcasts' },
  { label: '一斉配信の編集', router: broadcasts, method: 'PUT', path: '/api/broadcasts/b1' },
  { label: '一斉配信の削除', router: broadcasts, method: 'DELETE', path: '/api/broadcasts/b1' },
  { label: '一斉配信の送信', router: broadcasts, method: 'POST', path: '/api/broadcasts/b1/send' },
  { label: 'セグメント配信の送信', router: broadcasts, method: 'POST', path: '/api/broadcasts/b1/send-segment' },
  { label: 'テスト送信', router: broadcasts, method: 'POST', path: '/api/broadcasts/b1/test-send' },
  { label: 'スコアルールの作成', router: scoring, method: 'POST', path: '/api/scoring-rules' },
  { label: 'スコアルールの削除', router: scoring, method: 'DELETE', path: '/api/scoring-rules/r1' },
  { label: '手動での加点', router: scoring, method: 'POST', path: '/api/friends/f1/score' },
  { label: '計測リンクの作成', router: trackedLinks, method: 'POST', path: '/api/tracked-links' },
  { label: '計測リンクの削除', router: trackedLinks, method: 'DELETE', path: '/api/tracked-links/l1' },
  { label: '流入経路の作成', router: entryRoutes, method: 'POST', path: '/api/entry-routes' },
  { label: '流入経路の削除', router: entryRoutes, method: 'DELETE', path: '/api/entry-routes/e1' },
  { label: 'プールの作成', router: trafficPools, method: 'POST', path: '/api/traffic-pools' },
  { label: 'プールへのアカウント追加', router: trafficPools, method: 'POST', path: '/api/traffic-pools/p1/accounts' },
  { label: 'タグの作成', router: tags, method: 'POST', path: '/api/tags' },
  { label: 'タグの削除', router: tags, method: 'DELETE', path: '/api/tags/t1' },
];

describe('staff は設定を書き換えられない', () => {
  for (const c of forbidden) {
    test(`${c.label} は 403`, async () => {
      dbTouched.count = 0;
      const res = await appAs(c.router, 'staff').request(c.path, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        body: c.method === 'DELETE' ? undefined : '{}',
      });
      expect(res.status).toBe(403);
      // ガードがハンドラより前で止まっていること。
      expect(dbTouched.count).toBe(0);
    });
  }
});

describe('ガードは書き込みだけを止める（読み取りは素通り）', () => {
  test('GET はガードに掛からない（ハンドラまで進む）', async () => {
    dbTouched.count = 0;
    // ハンドラに入れば DB スタブが投げるので 500。403 で止まっていないことが要点。
    const res = await appAs(tags, 'staff').request('/api/tags');
    // ハンドラに入れば DB スタブが投げて 500 になる。403 で止まっていないことが要点。
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(500);
  });

  test('owner なら書き込みもガードを抜ける', async () => {
    dbTouched.count = 0;
    const res = await appAs(tags, 'owner').request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(500);
  });
});
