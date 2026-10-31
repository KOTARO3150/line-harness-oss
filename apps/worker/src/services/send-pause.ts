import { setLineSendGuard } from '@line-crm/line-sdk';
import { getLineSendPause } from '@line-crm/db';

/**
 * LINE送信の直前に、緊急停止スイッチを確認するよう LineClient に登録する。
 * fetch（API・webhook）と scheduled（cron）の入口で毎回呼ぶ。
 *
 * 毎回 D1 を1行読む。キャッシュしないのは、押した瞬間から確実に止めたいから。
 */
export function installLineSendGuard(db: D1Database): void {
  setLineSendGuard(async () => (await getLineSendPause(db)).paused);
}

/**
 * cron の送信ジョブを始める前の確認。停止中なら送信ジョブ自体を走らせない。
 *
 * LineClient 側でも止まるが、一斉配信は「失敗したバッチは飛ばして次へ進む」作りのため、
 * そこで止めるとその分のお客様に二度と届かなくなる。ジョブごと止めれば
 * 予約配信・シナリオ・リマインドは未送信のまま残り、再開後に送られる。
 * 確認自体に失敗したときは送信を止めない（停止機能の故障で全配信が止まるのを防ぐ）。
 */
export async function isLineSendPausedSafe(db: D1Database): Promise<boolean> {
  try {
    return (await getLineSendPause(db)).paused;
  } catch (err) {
    console.error('[line-send-pause] 停止状態を確認できなかったため送信を続けます:', err);
    return false;
  }
}
