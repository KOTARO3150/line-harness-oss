/**
 * プロラインなど外部予約サービスから取り込んだ予約（external_bookings）との
 * 二重予約を防ぐための共通部品。
 *
 * 移行の並行期間中は、同じ時間帯がプロライン側で埋まっていることがある。
 * external_bookings は担当者を持たないため、取り込んだ予約は
 * その時間帯の全担当者を塞ぐものとして扱う（実店舗は相談薬剤師が対応するので、
 * 誰か一人が埋まっていれば受けられない）。
 *
 * ends_at は取り込み元の通知に終了時刻が無いと NULL になる。その場合は
 * 今回予約しようとしているメニューの所要時間（バッファ込み）を仮の長さとして扱う。
 */

/** ends_at が無い外部予約に当てる最短の想定時間（分）。 */
export const MIN_EXTERNAL_BLOCK_MINUTES = 30;

/**
 * external_bookings と重ならないことを確かめる NOT EXISTS 句。
 *
 * バインドする値の順序（externalBookingConflictParams が同じ順で返す）:
 *   1. lineAccountId
 *   2. blockEndsAt (ISO)  — 予約したい枠の終わり
 *   3. fallbackMinutes    — ends_at が NULL のときに starts_at へ足す分数
 *   4. startsAt (ISO)     — 予約したい枠の始まり
 *
 * 時刻はどちらのテーブルも `Date#toISOString()` の形式で保存されているため、
 * strftime で同じ形式に揃えてから文字列比較する。
 */
export const EXTERNAL_BOOKING_CONFLICT_SQL = `
  NOT EXISTS (
    SELECT 1 FROM external_bookings
     WHERE line_account_id = ?
       AND status = 'scheduled'
       AND starts_at < ?
       AND COALESCE(
             ends_at,
             strftime('%Y-%m-%dT%H:%M:%fZ', starts_at, '+' || ? || ' minutes')
           ) > ?
  )`;

/** EXTERNAL_BOOKING_CONFLICT_SQL へ渡すバインド値を組み立てる。 */
export function externalBookingConflictParams(input: {
  lineAccountId: string;
  startsAt: Date;
  blockEndsAt: Date;
  fallbackMinutes: number;
}): [string, string, number, string] {
  return [
    input.lineAccountId,
    input.blockEndsAt.toISOString(),
    Math.max(MIN_EXTERNAL_BLOCK_MINUTES, Math.round(input.fallbackMinutes)),
    input.startsAt.toISOString(),
  ];
}

/**
 * 外部予約の終了時刻を決める。ends_at があればそれを、無ければ
 * starts_at + fallbackMinutes を返す。空き時間の計算側で使う。
 */
export function externalBookingEnd(
  row: { starts_at: string; ends_at: string | null },
  fallbackMinutes: number,
): Date {
  if (row.ends_at) return new Date(row.ends_at);
  const minutes = Math.max(MIN_EXTERNAL_BLOCK_MINUTES, Math.round(fallbackMinutes));
  return new Date(new Date(row.starts_at).getTime() + minutes * 60_000);
}
