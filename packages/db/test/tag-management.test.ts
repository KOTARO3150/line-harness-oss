import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTag,
  updateTag,
  deleteTag,
  getTagWithUsage,
  getTagsWithUsage,
  countAutomationRefs,
} from '../src/tags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const run = (params: unknown[]) => {
        const stmt = sqlite.prepare(query);
        return {
          async run() {
            const result = stmt.run(...params);
            return { results: [], success: true, meta: { changes: result.changes } };
          },
          async first<T>() {
            return (stmt.get(...params) as T) ?? null;
          },
          async all<T>() {
            return { results: stmt.all(...params) as T[], success: true, meta: {} };
          },
        };
      };
      return {
        bind: (...params: unknown[]) => run(params),
        ...run([]),
      };
    },
  } as unknown as D1Database;
}

describe('タグ管理', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('作成すると既定色が入る', async () => {
    const tag = await createTag(db, { name: '体質:冷え' });
    expect(tag.name).toBe('体質:冷え');
    expect(tag.color).toBe('#3B82F6');
  });

  it('名前を変えても id は変わらない（紐づけが切れない）', async () => {
    const tag = await createTag(db, { name: '旧名' });
    const renamed = await updateTag(db, tag.id, { name: '新名' });
    expect(renamed?.id).toBe(tag.id);
    expect(renamed?.name).toBe('新名');
    expect(renamed?.color).toBe(tag.color);
  });

  it('色だけ変えても名前は残る', async () => {
    const tag = await createTag(db, { name: '要フォロー' });
    const updated = await updateTag(db, tag.id, { color: '#EF4444' });
    expect(updated?.name).toBe('要フォロー');
    expect(updated?.color).toBe('#EF4444');
  });

  it('存在しない id は null', async () => {
    expect(await updateTag(db, 'missing', { name: 'x' })).toBeNull();
    expect(await getTagWithUsage(db, 'missing')).toBeNull();
  });

  it('同じ名前は作れない（UNIQUE 制約）', async () => {
    await createTag(db, { name: '重複' });
    await expect(createTag(db, { name: '重複' })).rejects.toThrow(/UNIQUE/i);
  });

  it('参照されていないタグは automationRefs = 0', async () => {
    const tag = await createTag(db, { name: '未使用' });
    const withUsage = await getTagWithUsage(db, tag.id);
    expect(withUsage).not.toBeNull();
    expect(countAutomationRefs(withUsage!.usage)).toBe(0);
    expect(withUsage!.usage.friends).toBe(0);
  });

  it('友だちへの付与は数えるが automationRefs には含めない', async () => {
    const tag = await createTag(db, { name: '来店済み' });
    sqlite
      .prepare(
        `INSERT INTO friends (id, line_user_id, display_name) VALUES ('f1','U1','山田')`,
      )
      .run();
    sqlite
      .prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('f1', ?)`)
      .run(tag.id);

    const withUsage = await getTagWithUsage(db, tag.id);
    expect(withUsage!.usage.friends).toBe(1);
    // 友だちに付いているだけなら消しても自動化は壊れない。
    expect(countAutomationRefs(withUsage!.usage)).toBe(0);
  });

  it('シナリオの起動タグに使われていれば automationRefs に出る', async () => {
    const tag = await createTag(db, { name: '初回相談' });
    sqlite
      .prepare(
        `INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id)
         VALUES ('s1', '初回フォロー', 'tag_added', ?)`,
      )
      .run(tag.id);

    const withUsage = await getTagWithUsage(db, tag.id);
    expect(withUsage!.usage.scenarioTriggers).toBe(1);
    expect(countAutomationRefs(withUsage!.usage)).toBe(1);
  });

  it('削除するとシナリオの起動タグが黙って NULL になる（409 で止める根拠）', async () => {
    const tag = await createTag(db, { name: '消される' });
    sqlite
      .prepare(
        `INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id)
         VALUES ('s1', 'フォロー', 'tag_added', ?)`,
      )
      .run(tag.id);

    await deleteTag(db, tag.id);

    const scenario = sqlite
      .prepare(`SELECT trigger_tag_id FROM scenarios WHERE id = 's1'`)
      .get() as { trigger_tag_id: string | null };
    // シナリオ自体は残るのに起動条件だけ消える。これが一番危ない壊れ方。
    expect(scenario.trigger_tag_id).toBeNull();
  });

  it('一覧は名前順で、参照数がタグごとに分かれている', async () => {
    const b = await createTag(db, { name: 'b-tag' });
    await createTag(db, { name: 'a-tag' });
    sqlite
      .prepare(
        `INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id)
         VALUES ('s1', 'x', 'tag_added', ?)`,
      )
      .run(b.id);

    const list = await getTagsWithUsage(db);
    expect(list.map((t) => t.name)).toEqual(['a-tag', 'b-tag']);
    expect(list[0].usage.scenarioTriggers).toBe(0);
    expect(list[1].usage.scenarioTriggers).toBe(1);
  });
});
