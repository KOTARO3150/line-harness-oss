import { describe, expect, test } from 'vitest';
import { parseProlineBookingNotice } from './proline-booking-import.js';

describe('parseProlineBookingNotice', () => {
  test('extracts a scheduled booking without retaining unrelated personal data', () => {
    const result = parseProlineBookingNotice(`
スケジュール/イベント予約機能で、予約を受け付けました。
予約カレンダー：2:（購入のお客様）オンライン個別カウンセリング
予約日時：2026年07月28日（火）10:00 ～ 11:00
予約の詳細確認・日程変更・キャンセル：予約管理ページ

【予約者】
LINEアカウント名（姓名）：テスト予約
ユーザーID：sample-id
`);

    expect(result).toEqual({
      startsAt: '2026-07-28T01:00:00.000Z',
      endsAt: '2026-07-28T02:00:00.000Z',
      status: 'scheduled',
      menuName: '（購入のお客様）オンライン個別カウンセリング',
    });
    expect(JSON.stringify(result)).not.toContain('sample-id');
  });

  test('extracts a short cancellation and leaves the menu unset for an upsert', () => {
    expect(parseProlineBookingNotice(`
2026年7月28日（火）10:00 のご予約がキャンセルされました。
別の日程で再度ご予約いただけます。
`)).toEqual({
      startsAt: '2026-07-28T01:00:00.000Z',
      endsAt: null,
      status: 'cancelled',
      menuName: null,
    });
  });

  test.each([
    ['unrelated message', 'お問い合わせありがとうございます。'],
    ['invalid date', '予約日時：2026年02月30日（月）10:00 ～ 11:00'],
    ['invalid range', '予約日時：2026年07月28日（火）11:00 ～ 10:00'],
  ])('rejects %s', (_label, value) => {
    expect(parseProlineBookingNotice(value)).toBeNull();
  });
});
