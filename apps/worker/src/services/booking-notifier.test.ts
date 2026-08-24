import { describe, expect, test } from 'vitest';
import { renderNotificationText } from './booking-notifier.js';

const ctx = {
  menuName: 'カット',
  staffName: '山田',
  startsAtJst: '2026-05-10 14:00',
  hoursBefore: 2,
};

describe('renderNotificationText', () => {
  test('受付', () => {
    const text = renderNotificationText('requested', ctx);
    expect(text).toContain('ご予約のお申し込みをありがとうございます');
    expect(text).toContain('カット');
    expect(text).toContain('山田');
    expect(text).toContain('2026-05-10 14:00');
    expect(text).toContain('内容を確認後、このLINEへあらためてご案内');
  });
  test('承認', () => {
    const text = renderNotificationText('approved', ctx);
    expect(text).toContain('ご予約が確定しました');
    expect(text).toContain('無理をなさらず、このLINEへご連絡ください');
  });
  test('次回予約は短い定型文だけを送る', () => {
    const text = renderNotificationText('next_appointment', ctx);
    expect(text).toBe('次回のご予約日\n5月10日（日）14:00から\nお待ちしております。');
    expect(text).not.toContain('担当');
    expect(text).not.toContain('Zoom');
  });
  test('Zoom参加URLは承認通知とリマインダに入り、受付通知には入らない', () => {
    const online = { ...ctx, joinUrl: 'https://zoom.us/j/123456789' };
    expect(renderNotificationText('approved', online)).toContain(online.joinUrl);
    expect(renderNotificationText('day_before', online)).toContain(online.joinUrl);
    expect(renderNotificationText('hours_before', online)).toContain(online.joinUrl);
    expect(renderNotificationText('requested', online)).not.toContain(online.joinUrl);
  });
  test('拒否', () => {
    const text = renderNotificationText('rejected', ctx);
    expect(text).toContain('お取りすることができませんでした');
    expect(text).toContain('このLINEへそのままご相談ください');
  });
  test('キャンセル', () => {
    const text = renderNotificationText('cancelled', ctx);
    expect(text).toContain('ご予約はキャンセルとなりました');
    expect(text).toContain('ご都合のよい時にあらためてお申し込みください');
  });
  test('期限切れ', () => {
    expect(renderNotificationText('expired', ctx)).toContain('いったん終了しました');
  });
  test('前日リマインダ', () => {
    expect(renderNotificationText('day_before', ctx)).toContain('明日のご予約');
  });
  test('当日 N 時間前', () => {
    const t = renderNotificationText('hours_before', ctx);
    expect(t).toContain('本日のご予約時間が近づいてまいりました');
    expect(t).toContain('どうぞ慌てずにご準備ください');
  });
});
