import { describe, expect, test } from 'vitest';
import {
  buildAnswerSummary,
  injectAnswers,
  escapeForJsonString,
  type SummaryField,
} from './form-answer-summary.js';

const orderFields: SummaryField[] = [
  { name: 'customer_name', label: 'お名前', type: 'text' },
  { name: 'phone', label: 'お電話番号', type: 'tel' },
  { name: 'cha60', label: '板藍茶 60包（5,400円）', type: 'quantity' },
  { name: 'cha120', label: '板藍茶 120包（8,640円）', type: 'quantity' },
  { name: 'ame', label: '板藍のど飴 約80粒（1,944円）', type: 'quantity' },
  { name: 'note', label: '通信欄', type: 'textarea' },
];

describe('回答のまとめ', () => {
  test('注文したものだけを、画面と同じ順で並べる', () => {
    const out = buildAnswerSummary(orderFields, {
      customer_name: '鈴木賢太郎',
      phone: '08048559599',
      cha60: '0',
      cha120: '1',
      ame: '3',
      note: '取り置きよろしくお願いします。',
      ご計金額: '14,472円',
    });

    expect(out).toBe(
      [
        'お名前：鈴木賢太郎',
        'お電話番号：08048559599',
        '板藍茶 120包（8,640円） × 1',
        '板藍のど飴 約80粒（1,944円） × 3',
        '通信欄：取り置きよろしくお願いします。',
        'ご計金額：14,472円',
      ].join('\n'),
    );
  });

  test('個数 0 は載せない（頼んでいないものを注文票に出さない）', () => {
    const out = buildAnswerSummary(orderFields, { cha60: '0', cha120: '2' });
    expect(out).not.toContain('60包');
    expect(out).toContain('板藍茶 120包（8,640円） × 2');
  });

  test('空欄は載せない', () => {
    const out = buildAnswerSummary(orderFields, { customer_name: '山田', note: '' });
    expect(out).toBe('お名前：山田');
  });

  test('質問に無いキーは最後にまわす', () => {
    const out = buildAnswerSummary(orderFields, { ご計金額: '1,000円', customer_name: '山田' });
    expect(out).toBe('お名前：山田\nご計金額：1,000円');
  });

  test('アンダースコアで始まる内部用の値は出さない', () => {
    const out = buildAnswerSummary(orderFields, { customer_name: '山田', _skipWebhook: 'true' });
    expect(out).toBe('お名前：山田');
  });

  test('複数選択は読点でつなぐ', () => {
    const fields: SummaryField[] = [{ name: 'x', label: 'ご希望', type: 'checkbox' }];
    expect(buildAnswerSummary(fields, { x: ['店頭', '配送'] })).toBe('ご希望：店頭、配送');
  });

  test('回答が空なら空文字（差し込んでも余計な行が出ない）', () => {
    expect(buildAnswerSummary(orderFields, {})).toBe('');
  });
});

describe('自動返信への差し込み', () => {
  const data = { customer_name: '山田', cha120: '1', ご計金額: '8,640円' };

  test('{{answers}} が回答一覧に置き換わる', () => {
    const out = injectAnswers(
      'ご予約ありがとうございます。\n\n{{answers}}\n\n入荷しましたらご連絡します。',
      orderFields,
      data,
      'text',
    );
    expect(out).toContain('板藍茶 120包（8,640円） × 1');
    expect(out).toContain('ご計金額：8,640円');
    expect(out).toContain('入荷しましたらご連絡します。');
    expect(out).not.toContain('{{answers}}');
  });

  test('{{answers}} が無ければ本文はそのまま', () => {
    const src = 'ご予約ありがとうございます。';
    expect(injectAnswers(src, orderFields, data, 'text')).toBe(src);
  });

  test('flex では JSON を壊さないようにエスケープする', () => {
    const out = injectAnswers('{"type":"text","text":"{{answers}}"}', orderFields, data, 'flex');
    // 改行がそのまま入ると JSON が壊れる。\n の 2 文字になっていること。
    expect(out).not.toMatch(/\n/);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).text).toContain('板藍茶 120包（8,640円） × 1');
  });

  test('引用符を含む回答でも flex が壊れない', () => {
    const out = injectAnswers(
      '{"type":"text","text":"{{answers}}"}',
      [{ name: 'note', label: '通信欄', type: 'textarea' }],
      { note: 'これは"引用符"入りです' },
      'flex',
    );
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).text).toContain('"引用符"');
  });

  test('{{answers}} が 2 か所あっても両方置き換わる', () => {
    const out = injectAnswers('{{answers}}---{{answers}}', orderFields, data, 'text');
    expect(out.split('お名前：山田').length - 1).toBe(2);
  });
});

describe('JSON エスケープ', () => {
  test('改行・引用符・バックスラッシュを安全にする', () => {
    expect(escapeForJsonString('a\nb"c\\d')).toBe('a\\nb\\"c\\\\d');
  });
});
