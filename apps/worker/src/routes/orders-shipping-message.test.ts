import { describe, expect, it } from 'vitest';
import { buildShippingNotificationText } from './orders.js';

describe('buildShippingNotificationText', () => {
  it('入力済みの配送情報を定型文へ並べる', () => {
    expect(buildShippingNotificationText({
      customerName: '鈴木 花子',
      expectedDeliveryDate: '2026-08-18',
      deliveryTimeSlot: '14時〜16時',
      deliveryInstruction: '宅配ボックス',
      carrier: '佐川急便',
      trackingNumber: '1234567890',
    })).toBe([
      '鈴木 花子様',
      '',
      'ご注文いただいたお品物を、本日発送いたしました。',
      '',
      '到着予定日：8月18日(火)頃',
      '時間指定：14時〜16時',
      'お受取方法：宅配ボックス',
      '配送会社：佐川急便',
      'お問い合わせ番号：1234567890',
      '',
      'お届けまで、もう少しお待ちください。',
      '届きましたら、内容をご確認ください。',
      '届いた際に何か不都合があれば、早めにご連絡くださいね。',
      '',
      '鈴木薬舗',
    ].join('\n'));
  });

  it('未入力の配送情報は文面へ表示しない', () => {
    const message = buildShippingNotificationText({
      customerName: '鈴木 太郎',
      expectedDeliveryDate: null,
      deliveryTimeSlot: ' ',
      deliveryInstruction: null,
      carrier: 'ヤマト運輸',
      trackingNumber: '',
    });

    expect(message).toContain('鈴木 太郎様');
    expect(message).toContain('配送会社：ヤマト運輸');
    expect(message).not.toContain('到着予定日：');
    expect(message).not.toContain('時間指定：');
    expect(message).not.toContain('お受取方法：');
    expect(message).not.toContain('お問い合わせ番号：');
  });
});
