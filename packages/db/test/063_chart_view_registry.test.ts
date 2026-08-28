import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStaffMember, updateStaffMember } from '../src/staff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
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
        },
      };
    },
  } as unknown as D1Database;
}

describe('相談カルテの閲覧登録', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('新しい担当者は既定で未登録', async () => {
    const created = await createStaffMember(db, { name: '新人', role: 'staff' });
    expect(created.can_view_charts).toBe(0);
  });

  it('登録して作成すれば閲覧できる', async () => {
    const created = await createStaffMember(db, {
      name: '相談担当',
      role: 'staff',
      can_view_charts: 1,
    });
    expect(created.can_view_charts).toBe(1);
  });

  it('あとから登録と解除ができる', async () => {
    const created = await createStaffMember(db, { name: '新人', role: 'staff' });

    const registered = await updateStaffMember(db, created.id, { can_view_charts: 1 });
    expect(registered?.can_view_charts).toBe(1);

    const revoked = await updateStaffMember(db, created.id, { can_view_charts: 0 });
    expect(revoked?.can_view_charts).toBe(0);
  });

  it('他の項目を更新しても登録状態は変わらない', async () => {
    const created = await createStaffMember(db, {
      name: '相談担当',
      role: 'staff',
      can_view_charts: 1,
    });

    const renamed = await updateStaffMember(db, created.id, { name: '相談担当（改姓）' });
    expect(renamed?.name).toBe('相談担当（改姓）');
    expect(renamed?.can_view_charts).toBe(1);
  });

  it('移行前から居る担当者は登録済みとして引き継がれる', () => {
    // 063 は既存行を can_view_charts = 1 にする。移行の前後で見え方が変わらないこと。
    const migration = readFileSync(
      join(PKG_ROOT, 'migrations', '063_chart_view_registry.sql'),
      'utf8',
    );
    expect(migration).toContain('UPDATE staff_members SET can_view_charts = 1');

    const fresh = new Database(':memory:');
    fresh.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    fresh
      .prepare(
        `INSERT INTO staff_members (id, name, role, api_key, is_active, can_view_charts, created_at, updated_at)
         VALUES ('existing', '前からいる担当者', 'staff', 'lh_existing', 1, 1, '2026-01-01', '2026-01-01')`,
      )
      .run();
    const row = fresh
      .prepare('SELECT can_view_charts FROM staff_members WHERE id = ?')
      .get('existing') as { can_view_charts: number };
    expect(row.can_view_charts).toBe(1);
    fresh.close();
  });
});
