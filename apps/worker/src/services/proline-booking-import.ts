export type ProlineBookingNotice = {
  startsAt: string;
  endsAt: string | null;
  status: 'scheduled' | 'cancelled';
  menuName: string | null;
};

function jstIso(year: number, month: number, day: number, hour: number, minute: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31
    || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCFullYear() !== year || jst.getUTCMonth() + 1 !== month || jst.getUTCDate() !== day
    || jst.getUTCHours() !== hour || jst.getUTCMinutes() !== minute) return null;
  return utc.toISOString();
}

export function parseProlineBookingNotice(rawText: string): ProlineBookingNotice | null {
  const text = rawText.replace(/\r\n?/g, '\n').trim();
  if (!text || !/(予約|ご予約)/.test(text)) return null;

  const date = text.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?\s*(\d{1,2})\s*[：:]\s*(\d{2})(?:\s*[〜～~\-－ー]\s*(\d{1,2})\s*[：:]\s*(\d{2}))?/,
  );
  if (!date) return null;

  const [year, month, day, hour, minute] = date.slice(1, 6).map(Number);
  const startsAt = jstIso(year, month, day, hour, minute);
  if (!startsAt) return null;

  let endsAt: string | null = null;
  if (date[6] !== undefined && date[7] !== undefined) {
    endsAt = jstIso(year, month, day, Number(date[6]), Number(date[7]));
    if (!endsAt || endsAt <= startsAt) return null;
  }

  const calendarLine = text.match(/予約カレンダー\s*[：:]\s*([^\n]+)/)?.[1]?.trim() ?? null;
  const menuName = calendarLine?.replace(/^\d+\s*[：:]\s*/, '').trim() || null;
  // Scheduled notices can contain a "日程変更・キャンセル" help link, so a
  // bare occurrence of the word is not enough to mark the booking cancelled.
  const status = /(予約|ご予約)(?:が|を)?\s*キャンセル(?:されました|しました)|キャンセル(?:されました|しました)/
    .test(text) ? 'cancelled' : 'scheduled';

  return { startsAt, endsAt, status, menuName };
}
