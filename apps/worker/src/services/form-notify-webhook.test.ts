import { describe, expect, test } from 'vitest';
import { buildNotifyPayload, NOTIFY_WEBHOOK_KEY } from './form-notify-webhook.js';

const orderFields = [
  { name: 'customer_name', label: 'お名前', type: 'text' },
  { name: 'phone', label: 'お電話番号', type: 'tel' },
  { name: 'itaran_cha_120', label: '板藍茶 120包（8,640円）', type: 'quantity' },
  { name: 'itaran_ame', label: '板藍のど飴 約80粒（1,944円）', type: 'quantity' },
  { name: 'note', label: '通信欄', type: 'textarea' },
];

const soudanFields = [
  { name: 'customer_name', label: 'お名前', type: 'text' },
  { name: 'phone', label: 'お電話番号', type: 'tel' },
  { name: 'method', label: 'ご希望の相談方法', type: 'radio' },
  { name: 'date1', label: '第1希望の日にち', type: 'date' },
  { name: 'time1', label: '第1希望の時間帯', type: 'radio' },
  { name: 'date2', label: '第2希望の日にち', type: 'date' },
  { name: 'time2', label: '第2希望の時間帯', type: 'radio' },
];

describe('外部通知（メール・カレンダー）へ渡すデータ', () => {
  test('注文：メールに貼れる文と、ラベル付きの一覧が両方入る', () => {
    const p = buildNotifyPayload({
      formId: 'f1',
      formName: '板藍茶・板藍のど飴 ご予約',
      fields: orderFields,
      data: {
        customer_name: '酒井幸子',
        phone: '09052357396',
        itaran_cha_120: '2',
        itaran_ame: '1',
        note: '',
        ご計金額: '19,224円',
      },
      submittedAt: '2026-09-10T06:04:00+09:00',
      lineDisplayName: 'サカイサチコ',
    })!;

    expect(p.summary).toContain('板藍茶 120包（8,640円） × 2');
    expect(p.summary).toContain('ご計金額：19,224円');
    expect(p.lineDisplayName).toBe('サカイサチコ');
    // 質問に無い「ご計金額」も一覧に載る（メール側で金額を扱えるように）
    expect(p.answers.find((a) => a.name === 'ご計金額')?.value).toBe('19,224円');
    // 未入力の項目もキーは残す（受け取る側で分岐しやすい）
    expect(p.answers.find((a) => a.name === 'note')?.value).toBe('');
  });

  test('相談：カレンダーを組むのに必要な項目が型付きで取れる', () => {
    const p = buildNotifyPayload({
      formId: 'f2',
      formName: '個別相談のお申し込み',
      fields: soudanFields,
      data: {
        customer_name: '佐藤咲',
        phone: '09000000000',
        method: '店頭で相談',
        date1: '2026-09-13',
        time1: '午前',
        date2: '2026-09-14',
        time2: '夕方以降',
      },
      submittedAt: '2026-09-11T22:50:00+09:00',
    });

    const get = (n: string) => p!.answers.find((a) => a.name === n);
    expect(get('method')?.value).toBe('店頭で相談');
    expect(get('date1')?.value).toBe('2026-09-13');
    expect(get('time1')?.value).toBe('午前');
    expect(get('date1')?.type).toBe('date');
    expect(p!.lineDisplayName).toBe('');
  });

  test('複数選択は読める形にまとめる', () => {
    const p = buildNotifyPayload({
      formId: 'f3',
      formName: 'テスト',
      fields: [{ name: 'sym', label: '症状', type: 'checkbox' }],
      data: { sym: ['冷え', '眠り'] },
      submittedAt: '2026-09-11T00:00:00+09:00',
    })!;
    expect(p.answers[0].value).toBe('冷え、眠り');
  });

  test('内部用のキー（先頭が _）は外へ出さない', () => {
    const p = buildNotifyPayload({
      formId: 'f4',
      formName: 'テスト',
      fields: [{ name: 'a', label: 'あ', type: 'text' }],
      data: { a: 'x', _secret: 'y' },
    	submittedAt: '2026-09-11T00:00:00+09:00',
    })!;
    expect(p.answers.some((x) => x.name === '_secret')).toBe(false);
  });

  test('回答が空なら null（空の通知を投げない）', () => {
    expect(
      buildNotifyPayload({
        formId: 'f5',
        formName: 'ご予約',
        fields: orderFields,
        data: { itaran_cha_120: '0', itaran_ame: '0', note: '' },
        submittedAt: '2026-09-11T00:00:00+09:00',
      }),
    ).toBeNull();
  });

  test('設定キーは固定', () => {
    expect(NOTIFY_WEBHOOK_KEY).toBe('form_notify_webhook_url');
  });
});
