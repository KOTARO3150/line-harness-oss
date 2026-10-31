import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLineSendPause, setLineSendPause } from '../src/send-pause.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '064_line_send_pause.sql'), 'utf8');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const build = (params: unknown[]) => {
        const stmt = sqlite.prepare(query);
        return {
          async run() {
            const result = stmt.run(...params);
            return { results: [], success: true, meta: { changes: result.changes } };
          },
          async first<T>() {
            return (stmt.get(...params) as T) ?? null;
          },
        };
      };
      return { ...build([]), bind: (...params: unknown[]) => build(params) };
    },
  } as unknown as D1Database;
}

describe('LINE送信の緊急停止スイッチ', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(MIGRATION);
    db = asD1(sqlite);
  });

  it('migration 直後は「送信する」状態', async () => {
    expect((await getLineSendPause(db)).paused).toBe(false);
  });

  it('停止と再開を記録できる', async () => {
    const paused = await setLineSendPause(db, { paused: true, reason: '誤配信', staffId: 's1', now: 't1' });
    expect(paused).toEqual({ paused: true, reason: '誤配信', updatedByStaffId: 's1', updatedAt: 't1' });
    const resumed = await setLineSendPause(db, { paused: false, reason: null, staffId: 's2', now: 't2' });
    expect(resumed.paused).toBe(false);
    expect(resumed.updatedByStaffId).toBe('s2');
  });

  it('行が消えていても「送信する」として読み、書けば作り直す', async () => {
    sqlite.exec('DELETE FROM line_send_pause');
    expect((await getLineSendPause(db)).paused).toBe(false);
    await setLineSendPause(db, { paused: true, reason: null, staffId: 's1', now: 't1' });
    expect((await getLineSendPause(db)).paused).toBe(true);
  });

  it('2行目は作れない（スイッチは1つだけ）', () => {
    expect(() => sqlite.exec('INSERT INTO line_send_pause (id, paused) VALUES (2, 1)')).toThrow();
  });

  it('migration は2回流しても壊れない', () => {
    expect(() => sqlite.exec(MIGRATION)).not.toThrow();
  });
});
