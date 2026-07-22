import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { consultationCharts } from './consultation-charts.js';

function previewDb() {
  const state = { prepared: [] as string[], writes: 0 };
  const db = {
    prepare(sql: string) {
      state.prepared.push(sql);
      return {
        bind() {
          return {
            first: async () => ({ id: 'friend-1', display_name: 'SYK', picture_url: null }),
            run: async () => {
              state.writes += 1;
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, state };
}

function app() {
  const instance = new Hono<Env>();
  instance.route('/', consultationCharts);
  return instance;
}

describe('POST /api/consultation-charts/:friendId/external-bookings/preview', () => {
  test('通知を解析するだけで予約データを書き込まない', async () => {
    const { db, state } = previewDb();
    const response = await app().request(
      '/api/consultation-charts/friend-1/external-bookings/preview?account_id=account-1',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notice_text: [
            'スケジュール/イベント予約機能で、予約を受け付けました。',
            '予約カレンダー：2:（購入のお客様）オンライン個別カウンセリング',
            '予約日時：2026年07月28日（火）10:00 ～ 11:00',
          ].join('\n'),
        }),
      },
      { DB: db } as Env['Bindings'],
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preview: {
        starts_at: '2026-07-28T01:00:00.000Z',
        ends_at: '2026-07-28T02:00:00.000Z',
        status: 'scheduled',
        menu_name: '（購入のお客様）オンライン個別カウンセリング',
        source: 'proline',
      },
    });
    expect(state.prepared).toHaveLength(1);
    expect(state.writes).toBe(0);
  });

  test('予約日時を読めない通知は保存せず422を返す', async () => {
    const { db, state } = previewDb();
    const response = await app().request(
      '/api/consultation-charts/friend-1/external-bookings/preview?account_id=account-1',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notice_text: '予約のお知らせ' }),
      },
      { DB: db } as Env['Bindings'],
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'unrecognized_proline_booking_notice' });
    expect(state.writes).toBe(0);
  });
});
