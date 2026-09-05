/**
 * 一斉配信の差し込み（{{name}} など）。
 *
 * これまで差し込みはステップ配信にしか無く、一斉配信で使えるのは {{liff_id}} だけだった。
 * 一斉配信は LINE の multicast API を使う — 1 リクエストで最大 500 人に
 * **同じ本文** を送る仕組みなので、原理的に 1 人ずつ差し替えられない。
 *
 * そこで、本文に差し込みが含まれるときだけ 1 人ずつ push に切り替える。
 * 送信回数は人数ぶんに増えるので、差し込みが無い配信は今まで通り multicast のまま。
 *
 * 「全員」宛ての配信は LINE の broadcast API（宛先を列挙しない）なので、
 * 差し込みは原理的に不可能。呼出側で断ること。
 */

import type { LineClient, Message } from '@line-crm/line-sdk';
import { expandVariables } from './step-delivery.js';
import { sleep, addJitter } from './stealth.js';

/**
 * 差し込みを含むか。
 *
 * {{liff_id}} は宛先によらず同じ値に置き換わるので、ここでは差し込みとみなさない
 * （multicast のままで正しく送れる）。
 */
const PERSONALIZATION_PATTERNS = [
  /\{\{name\}\}/,
  /\{\{uid\}\}/,
  /\{\{friend_id\}\}/,
  /\{\{ref\}\}/,
  /\{\{#if_ref\}\}/,
  /\{\{metadata\.[^}]+\}\}/,
  /\{\{#if_metadata\.[^}]+\}\}/,
];

export function hasPersonalization(content: string): boolean {
  return PERSONALIZATION_PATTERNS.some((re) => re.test(content));
}

/** 差し込みに必要な列。id と line_user_id だけでは {{name}} を埋められない。 */
export interface PersonalizableFriend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  user_id: string | null;
  ref_code: string | null;
  metadata: string | null;
}

/**
 * 差し込みに要る列をまとめて引く。
 * 呼出側が持っているのが id だけでも、ここで補える。
 */
/**
 * D1 の prepared statement は bind 変数が 100 個までなので、IN 句はこの単位で割る。
 * （同じ制限で 500 件の IN を投げて落ちた事例が unanswered-inbox.ts に残っている）
 */
const ID_CHUNK = 90;

export async function loadPersonalizableFriends(
  db: D1Database,
  friendIds: string[],
): Promise<PersonalizableFriend[]> {
  if (friendIds.length === 0) return [];

  const byId = new Map<string, PersonalizableFriend>();
  for (let i = 0; i < friendIds.length; i += ID_CHUNK) {
    const chunk = friendIds.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(
        `SELECT id, line_user_id, display_name, user_id, ref_code, metadata
           FROM friends WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<PersonalizableFriend>();
    for (const row of result.results ?? []) byId.set(row.id, row);
  }

  // 元の並び順を保つ（送信順が入れ替わると再開時の offset とずれる）
  return friendIds.map((id) => byId.get(id)).filter((f): f is PersonalizableFriend => !!f);
}

/**
 * 1 回の実行で送る上限。
 *
 * Cloudflare Workers は 1 実行あたりのサブリクエスト数に上限がある（無料枠 50）。
 * 上限に当たると push は「時間を使わずに」即座に失敗し続けるので、時間だけを見ていると
 * 残り全員を「送信失敗」として数えたまま最後まで走り抜け、配信を完了扱いにしてしまう。
 * ステップ配信も同じ理由で 40 件に制限している (step-delivery.ts)。
 */
const MAX_SENDS_PER_RUN = 40;

export interface PersonalizedSendResult {
  sentFriendIds: string[];
  /** 送れなかった人。ブロック済みなどで push が弾かれた場合。 */
  failed: { friendId: string; error: string }[];
  /** 途中で打ち切ったか。true なら残りは次の tick に回す。 */
  ranOutOfTime: boolean;
}

/**
 * 1 人ずつ差し込んで push する。
 *
 * Worker の実行時間には上限があるので、budgetMs を超えたらそこで止めて
 * 「どこまで送ったか」を返す。呼出側はその件数だけ offset を進めて、
 * 続きを次の cron tick に任せる。
 */
export async function sendPersonalized(
  lineClient: LineClient,
  friends: PersonalizableFriend[],
  buildMessageFor: (expandedContent: string) => Message,
  content: string,
  options: {
    workerUrl?: string;
    messageType?: string;
    budgetMs?: number;
    maxSends?: number;
  } = {},
): Promise<PersonalizedSendResult> {
  const budgetMs = options.budgetMs ?? 15_000;
  const maxSends = options.maxSends ?? MAX_SENDS_PER_RUN;
  const startedAt = Date.now();
  const sentFriendIds: string[] = [];
  const failed: { friendId: string; error: string }[] = [];

  for (let i = 0; i < friends.length; i++) {
    // 件数と時間の両方で打ち切る。件数の方が大事 — サブリクエスト上限に当たると
    // 失敗が一瞬で返るため、時間だけでは歯止めにならない。
    if (i > 0 && (i >= maxSends || Date.now() - startedAt > budgetMs)) {
      return { sentFriendIds, failed, ranOutOfTime: true };
    }
    const friend = friends[i];
    try {
      const expanded = expandVariables(
        content,
        friend,
        options.workerUrl,
        options.messageType,
      );
      await lineClient.pushMessage(friend.line_user_id, [buildMessageFor(expanded)]);
      sentFriendIds.push(friend.id);
    } catch (err) {
      // 1 人の失敗（ブロック済み等）で配信全体を止めない。
      failed.push({ friendId: friend.id, error: err instanceof Error ? err.message : String(err) });
    }
    // まとめ打ちに見えないよう、わずかに間隔を空ける。
    if (i < friends.length - 1) await sleep(addJitter(20, 60));
  }

  return { sentFriendIds, failed, ranOutOfTime: false };
}
