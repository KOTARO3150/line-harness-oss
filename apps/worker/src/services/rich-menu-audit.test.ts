import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { auditRichMenuLinks, MAX_SCAN_PER_RUN } from './rich-menu-audit.js';

/** friends を id 順に返すだけの D1 スタブ。LIMIT/OFFSET を実際に効かせる。 */
function dbWith(rows: { id: string; line_user_id: string }[]): D1Database {
  return {
    prepare: () => ({
      bind: (_account: string, limit: number, offset: number) => ({
        all: async () => ({ results: rows.slice(offset, offset + limit) }),
      }),
    }),
  } as unknown as D1Database;
}

function people(n: number, from = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${String(from + i).padStart(3, '0')}`,
    line_user_id: `U${from + i}`,
  }));
}

/** userId → 返す richMenuId (null なら 404 相当)、'ERR' なら 500 */
function stubLine(map: Record<string, string | null | 'ERR'>) {
  return vi.fn(async (url: string) => {
    const uid = decodeURIComponent(String(url).split('/user/')[1].split('/')[0]);
    const v = map[uid];
    if (v === 'ERR') return { ok: false, status: 500 } as Response;
    if (v == null) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, json: async () => ({ richMenuId: v }) } as unknown as Response;
  });
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('リッチメニュー割り当ての実測', () => {
  test('richMenuId ごとに人数を数える。個別リンクが無い人は none', async () => {
    vi.stubGlobal(
      'fetch',
      stubLine({ U0: 'rm-existing', U1: 'rm-existing', U2: 'rm-first', U3: null }),
    );
    const r = await auditRichMenuLinks(dbWith(people(4)), 'tok', { accountId: 'a' });

    expect(r.scanned).toBe(4);
    expect(r.counts).toEqual({ 'rm-existing': 2, 'rm-first': 1, none: 1 });
    expect(r.failed).toBe(0);
    expect(r.nextOffset).toBeNull();
  });

  test('1人が失敗しても残りは数える（数えられなかった人は failed に出す）', async () => {
    vi.stubGlobal('fetch', stubLine({ U0: 'rm-a', U1: 'ERR', U2: 'rm-a' }));
    const r = await auditRichMenuLinks(dbWith(people(3)), 'tok', { accountId: 'a' });

    expect(r.counts).toEqual({ 'rm-a': 2 });
    expect(r.failed).toBe(1);
    // 失敗した人も「見た」に数える。数えないと offset がずれて同じ人を無限に引く。
    expect(r.scanned).toBe(3);
  });

  test('assign を渡した時だけタグが付く', async () => {
    vi.stubGlobal('fetch', stubLine({ U0: 'rm-existing', U1: 'rm-first', U2: null }));
    const attachTag = vi.fn(async () => {});
    const resolveTagId = vi.fn(async (name: string) => 'tag-' + name);

    const r = await auditRichMenuLinks(dbWith(people(3)), 'tok', {
      accountId: 'a',
      assign: { 'rm-existing': '既存のお客様' },
      resolveTagId,
      attachTag,
    });

    expect(attachTag).toHaveBeenCalledTimes(1);
    expect(attachTag).toHaveBeenCalledWith('f000', 'tag-既存のお客様');
    expect(r.tagged).toEqual({ 既存のお客様: 1 });
  });

  test('assign が無ければ数えるだけで何も書かない', async () => {
    vi.stubGlobal('fetch', stubLine({ U0: 'rm-existing' }));
    const attachTag = vi.fn(async () => {});
    const r = await auditRichMenuLinks(dbWith(people(1)), 'tok', {
      accountId: 'a',
      attachTag,
      resolveTagId: async () => 't',
    });

    expect(attachTag).not.toHaveBeenCalled();
    expect(r.tagged).toEqual({});
  });

  test('同じタグ名は 1 回しか解決しない（毎回 DB を叩かない）', async () => {
    vi.stubGlobal('fetch', stubLine({ U0: 'rm-a', U1: 'rm-a', U2: 'rm-a' }));
    const resolveTagId = vi.fn(async () => 'tag-1');
    await auditRichMenuLinks(dbWith(people(3)), 'tok', {
      accountId: 'a',
      assign: { 'rm-a': '既存のお客様' },
      resolveTagId,
      attachTag: async () => {},
    });
    expect(resolveTagId).toHaveBeenCalledTimes(1);
  });

  test('1ページ使い切ったら nextOffset が出る', async () => {
    vi.stubGlobal('fetch', stubLine(Object.fromEntries(people(10).map((p) => [p.line_user_id, 'rm-a']))));
    const r = await auditRichMenuLinks(dbWith(people(10)), 'tok', {
      accountId: 'a',
      limit: 4,
    });
    expect(r.scanned).toBe(4);
    expect(r.nextOffset).toBe(4);
  });

  test('最後のページは nextOffset が null（取れた数が limit 未満）', async () => {
    vi.stubGlobal('fetch', stubLine(Object.fromEntries(people(6).map((p) => [p.line_user_id, 'rm-a']))));
    const r = await auditRichMenuLinks(dbWith(people(6)), 'tok', {
      accountId: 'a',
      offset: 4,
      limit: 4,
    });
    expect(r.scanned).toBe(2);
    expect(r.nextOffset).toBeNull();
  });

  test('時間切れなら見た人数ぶんだけ進めて再開できるようにする', async () => {
    vi.stubGlobal('fetch', stubLine(Object.fromEntries(people(50).map((p) => [p.line_user_id, 'rm-a']))));
    const r = await auditRichMenuLinks(dbWith(people(50)), 'tok', {
      accountId: 'a',
      offset: 10,
      budgetMs: 0,
    });
    expect(r.ranOutOfTime).toBe(true);
    // budget 0 でも 1 人は必ず見る（0 人だと offset が進まず永久に終わらない）
    expect(r.scanned).toBe(1);
    expect(r.nextOffset).toBe(11);
  });

  test('1回の上限を超える limit は切り詰める', async () => {
    const all = people(MAX_SCAN_PER_RUN + 50);
    vi.stubGlobal('fetch', stubLine(Object.fromEntries(all.map((p) => [p.line_user_id, 'rm-a']))));
    const r = await auditRichMenuLinks(dbWith(all), 'tok', {
      accountId: 'a',
      limit: 10_000,
    });
    expect(r.scanned).toBe(MAX_SCAN_PER_RUN);
    expect(r.nextOffset).toBe(MAX_SCAN_PER_RUN);
  });

  test('対象が 0 人なら何もしない', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await auditRichMenuLinks(dbWith([]), 'tok', { accountId: 'a' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.scanned).toBe(0);
    expect(r.nextOffset).toBeNull();
  });
});
