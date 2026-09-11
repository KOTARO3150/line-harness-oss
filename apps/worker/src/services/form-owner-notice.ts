// フォームに回答が入ったことを、店側（オーナー）の LINE に知らせる文を作る。
//
// なぜ必要か:
//   フォームの回答は「未対応」に入らない。未対応はお客様から届いた
//   メッセージだけを数えているため、注文だけでは何も鳴らない。
//   実際に、注文が4件入って気づけたのは1件だけだった（その方が別に
//   メッセージをくれたから）。残りは誰も気づかないまま残っていた。
//
// 方針:
//   - 中身は buildAnswerSummary をそのまま使う。お客様へ返す控えと
//     同じ並び・同じ書き方にして、店とお客様で食い違わないようにする
//   - 送り先が設定されていなければ何もしない（既定は無効）。
//     知らないうちに誰かへ通知が飛ぶ状態は作らない
//   - 送信に失敗しても、お客様への返信やタグ付けは止めない

import { buildAnswerSummary, type SummaryField } from './form-answer-summary.js';

/** 送り先を入れておく account_settings のキー。値は friends.id（社内の id）。 */
export const OWNER_NOTIFY_KEY = 'form_notify_friend_id';

export interface OwnerNoticeInput {
  /** フォーム名。どのフォームに入ったのか一目で分かるように出す */
  formName: string;
  fields: SummaryField[];
  data: Record<string, unknown>;
  /** LINE の表示名。フォームのお名前欄と違うことがあるので併記する */
  friendDisplayName?: string | null;
  /** 受付時刻（JST の文字列）。無ければ行を出さない */
  receivedAt?: string | null;
}

/**
 * 店側に送る通知文を組む。
 * 回答が空（全部未入力・個数0）のときは null を返し、呼び出し側が送信を見送る。
 */
export function buildOwnerNotice(input: OwnerNoticeInput): string | null {
  const summary = buildAnswerSummary(input.fields, input.data).trim();
  if (!summary) return null;

  const lines: string[] = ['【フォーム回答が届きました】', input.formName, '', summary];

  // LINE の表示名は、フォームに書かれたお名前と一致しないことが多い
  // （「サカイサチコ」と「酒井幸子」など）。照合できるよう必ず添える。
  const display = (input.friendDisplayName ?? '').trim();
  if (display) lines.push('', `LINEの表示名：${display}`);

  const at = (input.receivedAt ?? '').trim();
  if (at) lines.push(`受付：${at}`);

  return lines.join('\n');
}
