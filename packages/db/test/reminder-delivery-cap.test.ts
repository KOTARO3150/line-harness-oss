import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDueReminderDeliveries } from '../src/reminders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

/**
 * リマインダ配信の取得は、以前は上限なしで全 active 登録を舐めていた。
 * 登録者が増えると 1 回の cron で Workers の時間を使い切るので、
 * 上限つき・古い順・ステップ定義の使い回し、を固定する。
 */
function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => {
    const stmt = sqlite.prepare(query);
    return {
      async run() {
        const r = stmt.run(...params);
        return { results: [], success: true, meta: { changes: r.changes } };
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
    prepare(query: string) {
      queryLog.push(query.replace(/\s+/g, ' ').trim());
      return { bind: (...p: unknown[]) => wrap(query, p), ...wrap(query, []) };
    },
  } as unknown as D1Database;
}

let queryLog: string[] = [];

describe('リマインダ配信の取得', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  /** reminder 1件に、target_date 違いの friend_reminders を n 件ぶら下げる。 */
  function seed(n: number, reminderId = 'r1') {
    sqlite
      .prepare(
        `INSERT INTO reminders (id, name, is_active) VALUES (?, '定期フォロー', 1)`,
      )
      .run(reminderId);
    sqlite
      .prepare(
        `INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
         VALUES (?, ?, 0, 'text', 'お加減いかがですか')`,
      )
      .run(`${reminderId}-s1`, reminderId);

    for (let i = 0; i < n; i++) {
      sqlite
        .prepare(
          `INSERT INTO friends (id, line_user_id, display_name) VALUES (?, ?, ?)`,
        )
        .run(`f${i}`, `U${i}`, `お客様${i}`);
      // i が小さいほど古い期日にして、順序を確かめられるようにする。
      const day = String(i + 1).padStart(2, '0');
      sqlite
        .prepare(
          `INSERT INTO friend_reminders (id, reminder_id, friend_id, target_date, status)
           VALUES (?, ?, ?, ?, 'active')`,
        )
        .run(`fr${i}`, reminderId, `f${i}`, `2026-01-${day}T00:00:00.000Z`);
    }
  }

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    queryLog = [];
    db = asD1(sqlite);
  });

  it('limit を渡すとその件数で打ち切る', async () => {
    seed(10);
    const due = await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z', 3);
    expect(due).toHaveLength(3);
  });

  it('limit なしなら全件返る（既存の呼び方を壊さない）', async () => {
    seed(10);
    const due = await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z');
    expect(due).toHaveLength(10);
  });

  it('期日の古い順に拾う（打ち切っても後回しにされ続ける人が出ない）', async () => {
    seed(10);
    const due = await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z', 3);
    expect(due.map((d) => d.id)).toEqual(['fr0', 'fr1', 'fr2']);
  });

  it('同じリマインダのステップ定義は 1 回しか引かない', async () => {
    seed(10);
    queryLog = [];
    await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z', 10);
    const stepQueries = queryLog.filter((q) => q.includes('FROM reminder_steps'));
    expect(stepQueries).toHaveLength(1);
  });

  it('打ち切ったぶんの登録には触れない', async () => {
    seed(10);
    queryLog = [];
    await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z', 2);
    const deliveredQueries = queryLog.filter((q) =>
      q.includes('FROM friend_reminder_deliveries'),
    );
    expect(deliveredQueries).toHaveLength(2);
  });

  it('期日が来ていない登録は返さない', async () => {
    seed(3);
    const due = await getDueReminderDeliveries(db, '2025-01-01T00:00:00.000Z', 10);
    expect(due).toHaveLength(0);
  });

  it('停止中のリマインダは返さない', async () => {
    seed(3);
    sqlite.prepare(`UPDATE reminders SET is_active = 0 WHERE id = 'r1'`).run();
    const due = await getDueReminderDeliveries(db, '2026-06-01T00:00:00.000Z', 10);
    expect(due).toHaveLength(0);
  });
});
