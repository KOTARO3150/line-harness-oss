import { extractFlexAltText } from '../utils/flex-alt-text.js';

/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * target_date + offset_minutes の時刻が現在時刻以前で
 * まだ配信されていないステップを配信する
 */

import {
  getDueReminderDeliveries,
  completeReminderIfDone,
  cancelFriendReminder,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';

/**
 * 1 回の cron で扱う友だちリマインダの上限。
 *
 * 予約リマインダ側は 2026-06 の取りこぼし事故のあと 100 件/回に制限された。
 * こちらは長らく無制限で、登録者が増えると 1 tick で全員を舐めて
 * Workers の実行時間を使い切る形になっていた。同じ理由で上限を設ける。
 * あふれた分は 5 分後の tick が拾う（target_date の古い順なので放置されない）。
 */
const MAX_REMINDER_FRIENDS_PER_CRON = 40;

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = jstNow();
  const dueReminders = await getDueReminderDeliveries(
    db,
    now,
    MAX_REMINDER_FRIENDS_PER_CRON,
  );

  for (let i = 0; i < dueReminders.length; i++) {
    const fr = dueReminders[i];
    try {
      // ステルス: バースト回避のためランダム遅延
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }

      const friend = await getFriendById(db, fr.friend_id);
      if (!friend || !friend.is_following) {
        // 送れない相手（退会・ブロック）は、その登録を止めてから次へ。
        //
        // 以前は continue するだけだった。1 回あたりの件数に上限が無かったころは
        // 最後まで走り切るので実害が出なかったが、上限を入れた今は期日の古い順に
        // 40 件を占め続け、後ろに並んだ生きているリマインダが永久に届かなくなる。
        await cancelFriendReminder(db, fr.id);
        continue;
      }

      // Resolve correct lineClient for this friend's account
      let deliveryClient = lineClient;
      const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
      if (friendAccountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, friendAccountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      for (const step of fr.steps) {
        const message = buildMessage(step.message_type, step.message_content);
        await deliveryClient.pushMessage(friend.line_user_id, [message]);

        // Mark as delivered AFTER successful send.
        // INSERT OR IGNORE prevents duplicate records if parallel workers both sent.
        // Prefer possible duplicate send over silent message loss on crash.
        const lockId = crypto.randomUUID();
        await db
          .prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
          .bind(lockId, fr.id, step.id)
          .run();

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, 'reminder', ?)`,
          )
          .bind(logId, friend.id, step.message_type, step.message_content, jstNow())
          .run();
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }
  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as { originalContentUrl: string; previewImageUrl: string };
      return { type: 'image', originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }
  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }
  return { type: 'text', text: messageContent };
}
