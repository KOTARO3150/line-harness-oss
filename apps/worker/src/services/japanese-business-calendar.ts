const DAY_MS = 86_400_000

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nthMonday(year: number, month: number, nth: number): number {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return 1 + ((8 - firstDay) % 7) + (nth - 1) * 7
}

function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

/** Japanese national holidays under the current (2020+) holiday rules. */
export function japaneseHolidayKeys(year: number): Set<string> {
  const holidays = new Set<string>([
    dateKey(year, 1, 1),
    dateKey(year, 1, nthMonday(year, 1, 2)),
    dateKey(year, 2, 11),
    dateKey(year, 2, 23),
    dateKey(year, 3, vernalEquinoxDay(year)),
    dateKey(year, 4, 29),
    dateKey(year, 5, 3),
    dateKey(year, 5, 4),
    dateKey(year, 5, 5),
    dateKey(year, 7, nthMonday(year, 7, 3)),
    dateKey(year, 8, 11),
    dateKey(year, 9, nthMonday(year, 9, 3)),
    dateKey(year, 9, autumnalEquinoxDay(year)),
    dateKey(year, 10, nthMonday(year, 10, 2)),
    dateKey(year, 11, 3),
    dateKey(year, 11, 23),
  ])

  // A weekday between two national holidays becomes a Citizen's Holiday.
  for (let day = 2; day <= 366; day++) {
    const current = new Date(Date.UTC(year, 0, day))
    if (current.getUTCFullYear() !== year) break
    const key = current.toISOString().slice(0, 10)
    if (holidays.has(key) || current.getUTCDay() === 0) continue
    const previous = new Date(current.getTime() - DAY_MS).toISOString().slice(0, 10)
    const next = new Date(current.getTime() + DAY_MS).toISOString().slice(0, 10)
    if (holidays.has(previous) && holidays.has(next)) holidays.add(key)
  }

  // A Sunday holiday moves to the next day that is not already a holiday.
  for (const key of [...holidays]) {
    const holiday = new Date(`${key}T00:00:00Z`)
    if (holiday.getUTCDay() !== 0) continue
    let substitute = new Date(holiday.getTime() + DAY_MS)
    while (holidays.has(substitute.toISOString().slice(0, 10))) {
      substitute = new Date(substitute.getTime() + DAY_MS)
    }
    holidays.add(substitute.toISOString().slice(0, 10))
  }

  return holidays
}

export function isJapaneseHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4))
  return Number.isInteger(year) && japaneseHolidayKeys(year).has(date)
}

/** Suzuki Yakuho defaults: Obon and New Year closure. */
export function isSeasonalClosure(date: string): boolean {
  const monthDay = date.slice(5)
  return (monthDay >= '08-13' && monthDay <= '08-16')
    || monthDay >= '12-29'
    || monthDay <= '01-03'
}
