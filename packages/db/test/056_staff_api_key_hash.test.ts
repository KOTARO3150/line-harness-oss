import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStaffMember, getStaffByApiKey, regenerateStaffApiKey } from '../src/staff.js';

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

describe('staff API key hashing', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('stores a new key only as a hash and authenticates with the returned key', async () => {
    const created = await createStaffMember(db, { name: '薬剤師', role: 'staff' });
    expect(created.api_key).toMatch(/^lh_[0-9a-f]{32}$/);

    const stored = sqlite
      .prepare('SELECT api_key, api_key_hash, api_key_hint FROM staff_members WHERE id = ?')
      .get(created.id) as { api_key: string; api_key_hash: string; api_key_hint: string };
    expect(stored.api_key).not.toBe(created.api_key);
    expect(stored.api_key).toMatch(/^retired_/);
    expect(stored.api_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.api_key_hint).toBe(created.api_key.slice(-4));
    expect((await getStaffByApiKey(db, created.api_key))?.id).toBe(created.id);
  });

  it('migrates an old plaintext key on its first successful login', async () => {
    const oldKey = 'lh_0123456789abcdef0123456789abcdef';
    sqlite.prepare(
      `INSERT INTO staff_members
        (id, name, role, api_key, is_active, created_at, updated_at)
       VALUES ('legacy', '旧担当者', 'staff', ?, 1, '2026-01-01', '2026-01-01')`,
    ).run(oldKey);

    expect((await getStaffByApiKey(db, oldKey))?.id).toBe('legacy');
    const stored = sqlite
      .prepare('SELECT api_key, api_key_hash, api_key_hint FROM staff_members WHERE id = ?')
      .get('legacy') as { api_key: string; api_key_hash: string; api_key_hint: string };
    expect(stored.api_key).not.toBe(oldKey);
    expect(stored.api_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.api_key_hint).toBe('cdef');
    expect((await getStaffByApiKey(db, oldKey))?.id).toBe('legacy');
  });

  it('invalidates the previous key when regenerated', async () => {
    const created = await createStaffMember(db, { name: '管理者', role: 'admin' });
    const nextKey = await regenerateStaffApiKey(db, created.id);
    expect(await getStaffByApiKey(db, created.api_key)).toBeNull();
    expect((await getStaffByApiKey(db, nextKey))?.id).toBe(created.id);
  });
});
