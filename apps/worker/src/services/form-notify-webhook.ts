// フォームの回答を、店の外（メール・カレンダー）へ知らせるための受け渡し用データを作る。
//
// なぜ既存の onSubmitWebhookUrl を使わないか:
//   あちらは「審査」用で、送信より前に呼ばれる。相手が 10 秒返事をしないと
//   お客様の注文そのものが却下され、失敗メッセージが届く。
//   Google が一瞬重かっただけで注文を失うのは受け入れられない。
//   こちらは注文を保存し終えたあとに投げる。失敗しても注文は残る。
//
// 受け取る側（Google Apps Script）が組み立てやすいよう、
//   - summary : そのままメール本文に貼れる文（お客様へ返す控えと同じ並び）
//   - answers : ラベルと値と型の一覧。カレンダーの予定を組むのに使う
//   - data    : 生の値。将来なにか足すとき用
// の3通りを同時に渡す。受け取る側を書き替えずに済む余地を残すため。

import { buildAnswerSummary, type SummaryField } from './form-answer-summary.js';

/** 送信先 URL を入れておく account_settings のキー。 */
export const NOTIFY_WEBHOOK_KEY = 'form_notify_webhook_url';

export interface NotifyField extends SummaryField {
  /** その回答に紐づく値。未入力なら空文字 */
  value: string;
}

export interface NotifyPayload {
  formId: string;
  formName: string;
  /** 受付時刻（JST）。カレンダーの記録にも使う */
  submittedAt: string;
  /** LINE の表示名。フォームのお名前欄と一致しないことが多いので別に渡す */
  lineDisplayName: string;
  /** メール本文にそのまま貼れる文 */
  summary: string;
  /** ラベル付きの一覧。カレンダーの予定名や日時の組み立てに使う */
  answers: NotifyField[];
  /** 生の回答。上の2つで足りないときのため */
  data: Record<string, unknown>;
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((v) => v !== '' && v != null).join('、');
  if (value === null || value === undefined) return '';
  return String(value);
}

export interface BuildPayloadInput {
  formId: string;
  formName: string;
  fields: SummaryField[];
  data: Record<string, unknown>;
  submittedAt: string;
  lineDisplayName?: string | null;
}

/**
 * 送信先へ渡すデータを組む。
 * 回答が空（全部未入力・個数0）なら null を返し、呼び出し側は送信を見送る。
 */
export function buildNotifyPayload(input: BuildPayloadInput): NotifyPayload | null {
  const summary = buildAnswerSummary(input.fields, input.data).trim();
  if (!summary) return null;

  // 質問に無いキー（クライアントが足す「ご計金額」など）も落とさず載せる。
  // 先頭が _ のものは内部用なので外へ出さない。
  const known = new Set(input.fields.map((f) => f.name));
  const extras = Object.keys(input.data).filter((k) => !known.has(k) && !k.startsWith('_'));

  const answers: NotifyField[] = [
    ...input.fields.map((f) => ({ ...f, value: asText(input.data[f.name]) })),
    ...extras.map((k) => ({ name: k, label: k, value: asText(input.data[k]) })),
  ];

  return {
    formId: input.formId,
    formName: input.formName,
    submittedAt: input.submittedAt,
    lineDisplayName: (input.lineDisplayName ?? '').trim(),
    summary,
    answers,
    data: input.data,
  };
}
