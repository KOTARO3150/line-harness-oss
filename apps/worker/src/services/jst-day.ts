export function jstDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const start = new Date(`${date}T00:00:00+09:00`);
  return { date, start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}
