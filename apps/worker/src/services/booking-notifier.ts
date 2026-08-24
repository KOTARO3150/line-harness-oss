import { LineClient } from '@line-crm/line-sdk';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'next_appointment'
  | 'rejected'
  | 'cancelled'
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
  const detail = `\n\n【ご予約内容】\nご相談: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAtJst}`;
  const online = ctx.joinUrl
    ? `\n\n【オンライン相談】\nお時間になりましたら、こちらからお入りください。\n${ctx.joinUrl}\n\n接続がうまくいかないときは、このLINEへそのままご連絡ください。`
    : '';
  switch (kind) {
    case 'requested':
      return `ご予約のお申し込みをありがとうございます。${detail}\n\n内容を確認後、このLINEへあらためてご案内いたします。\n気になることや、先に伝えておきたいことがありましたら、このままLINEへお送りください。`;
    case 'approved':
      return `ご予約が確定しました。${detail}${online}\n\n当日までに体調やご予定の変化がありましたら、無理をなさらず、このLINEへご連絡ください。\n落ち着いてお話しいただけるよう、こちらでも準備してお待ちしております。`;
    case 'next_appointment': {
      const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(ctx.startsAtJst);
      if (!match) return `次回のご予約日\n${ctx.startsAtJst}から\nお待ちしております。`;
      const [, year, month, day, time] = match;
      const weekday = ['日', '月', '火', '水', '木', '金', '土'][
        new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()
      ];
      return `次回のご予約日\n${Number(month)}月${Number(day)}日（${weekday}）${time}から\nお待ちしております。`;
    }
    case 'rejected':
      return `せっかくお申し込みいただきましたが、ご希望の日時でのご予約をお取りすることができませんでした。\n\nお手数をおかけしますが、ご都合のよい別の日時をお選びください。\n日時選びに迷われる場合は、このLINEへそのままご相談ください。`;
    case 'cancelled':
      return `以下のご予約はキャンセルとなりました。${detail}\n\nまたご相談をご希望の際は、ご都合のよい時にあらためてお申し込みください。\nご不明な点がありましたら、このLINEへそのままご連絡ください。`;
    case 'expired':
      return `確認期限を過ぎたため、今回のご予約申し込みはいったん終了しました。${detail}\n\nご相談をご希望の際は、ご都合のよい時にあらためてお申し込みください。`;
    case 'day_before':
      return `明日のご予約についてのご案内です。${detail}${online}\n\n体調やご予定に変化がありましたら、このLINEへご連絡ください。`;
    case 'hours_before':
      return `本日のご予約時間が近づいてまいりました。${detail}${online}\n\nどうぞ慌てずにご準備ください。`;
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
