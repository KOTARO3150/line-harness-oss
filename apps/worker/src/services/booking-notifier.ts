import { LineClient } from '@line-crm/line-sdk';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'day_before'
  | 'hours_before';

export interface NotificationContext {
  menuName: string;
  staffName: string;
  startsAtJst: string; // 例: "2026-05-10 14:00"
  hoursBefore: number;
  joinUrl?: string | null;
}

export function renderNotificationText(
  kind: NotificationKind,
  ctx: NotificationContext,
): string {
  const detail = `\nメニュー: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAtJst}`;
  const online = ctx.joinUrl ? `\n\nオンライン相談URL:\n${ctx.joinUrl}` : '';
  switch (kind) {
    case 'requested':
      return `予約リクエストを受け付けました。${detail}\n\nお店からの返信をお待ちください。`;
    case 'approved':
      return `予約が確定しました。${detail}${online}\n\n変更・キャンセルはお店に直接ご連絡ください。`;
    case 'rejected':
      return `申し訳ありません、ご希望の枠でお取りできませんでした。\n別の日時で再度お試しください。`;
    case 'expired':
      return `予約リクエストが 24 時間返信が無かったため、期限切れになりました。${detail}`;
    case 'day_before':
      return `明日のご予約のお知らせです。${detail}${online}`;
    case 'hours_before':
      return `本日のご予約まであと ${ctx.hoursBefore} 時間です。${detail}${online}`;
  }
}

export interface SendNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: NotificationKind;
  ctx: NotificationContext;
}

export async function sendBookingNotification(params: SendNotificationParams): Promise<void> {
  const text = renderNotificationText(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type BookingNotificationSender = (params: SendNotificationParams) => Promise<void>;
