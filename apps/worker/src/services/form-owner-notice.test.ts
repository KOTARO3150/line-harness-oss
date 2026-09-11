import { describe, expect, test } from 'vitest';
import { buildOwnerNotice, OWNER_NOTIFY_KEY } from './form-owner-notice.js';

const orderFields = [
  { name: 'customer_name', label: 'お名前', type: 'text' },
  { name: 'phone', label: 'お電話番号', type: 'tel' },
  { name: 'itaran_cha_60', label: '板藍茶 60包（5,400円）', type: 'quantity' },
  { name: 'itaran_cha_120', label: '板藍茶 120包（8,640円）', type: 'quantity' },
  { name: 'itaran_ame', label: '板藍のど飴 約80粒（1,944円）', type: 'quantity' },
  { name: 'note', label: '通信欄', type: 'textarea' },
];

describe('店側への通知文', () => {
  test('実際に入った注文が、そのまま読める形になる', () => {
    const text = buildOwnerNotice({
      formName: '板藍茶・板藍のど飴 ご予約',
      fields: orderFields,
      data: {
        customer_name: '酒井幸子',
        phone: '09052357396',
        itaran_cha_60: '0',
        itaran_cha_120: '2',
        itaran_ame: '1',
        note: '',
        ご計金額: '19,224円',
      },
      friendDisplayName: 'サカイサチコ',
      receivedAt: '2026-09-10 06:04',
    });

    expect(text).toBe(
      [
        '【フォーム回答が届きました】',
        '板藍茶・板藍のど飴 ご予約',
        '',
        'お名前：酒井幸子',
        'お電話番号：09052357396',
        '板藍茶 120包（8,640円） × 2',
        '板藍のど飴 約80粒（1,944円） × 1',
        'ご計金額：19,224円',
        '',
        'LINEの表示名：サカイサチコ',
        '受付：2026-09-10 06:04',
      ].join('\n'),
    );
  });

  test('0個の商品と空欄は出さない', () => {
    const text = buildOwnerNotice({
      formName: 'ご予約',
      fields: orderFields,
      data: { customer_name: '佐藤寛子', phone: '', itaran_cha_60: '0', itaran_cha_120: '0', itaran_ame: '1' },
    });
    expect(text).toContain('板藍のど飴');
    expect(text).not.toContain('板藍茶 60包');
    expect(text).not.toContain('板藍茶 120包');
    expect(text).not.toContain('お電話番号');
  });

  test('表示名と受付時刻が無ければ、その行は出さない', () => {
    const text = buildOwnerNotice({
      formName: 'ご予約',
      fields: orderFields,
      data: { customer_name: '田中' },
    });
    expect(text).not.toContain('LINEの表示名');
    expect(text).not.toContain('受付：');
    expect(text?.endsWith('お名前：田中')).toBe(true);
  });

  test('回答が空なら null を返す（空の通知を送らない）', () => {
    expect(
      buildOwnerNotice({
        formName: 'ご予約',
        fields: orderFields,
        data: { itaran_cha_60: '0', itaran_ame: '0', note: '' },
      }),
    ).toBeNull();
  });

  test('相談フォームのような個数の無いフォームでも使える', () => {
    const text = buildOwnerNotice({
      formName: '個別相談のお申し込み',
      fields: [
        { name: 'method', label: 'ご希望の相談方法', type: 'radio' },
        { name: 'date1', label: '第1希望の日にち', type: 'date' },
        { name: 'time1', label: '第1希望の時間帯', type: 'radio' },
      ],
      data: { method: '店頭で相談', date1: '2026-09-13', time1: '午前' },
    });
    expect(text).toContain('ご希望の相談方法：店頭で相談');
    expect(text).toContain('第1希望の日にち：2026-09-13');
  });

  test('設定キーは固定（デプロイ後に値を入れるだけで有効になる）', () => {
    expect(OWNER_NOTIFY_KEY).toBe('form_notify_friend_id');
  });
});
