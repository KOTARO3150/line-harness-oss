import { describe, expect, it } from 'vitest'
import { isJapaneseHoliday, isSeasonalClosure, japaneseHolidayKeys } from './japanese-business-calendar'

describe('Japanese business calendar', () => {
  it('includes fixed, Monday, equinox and substitute holidays', () => {
    const holidays = japaneseHolidayKeys(2026)
    expect(holidays.has('2026-01-01')).toBe(true)
    expect(holidays.has('2026-01-12')).toBe(true)
    expect(holidays.has('2026-03-20')).toBe(true)
    expect(holidays.has('2026-05-06')).toBe(true)
    expect(holidays.has('2026-09-22')).toBe(true)
  })

  it('does not mark an ordinary weekday as a holiday', () => {
    expect(isJapaneseHoliday('2026-07-23')).toBe(false)
  })

  it('recognizes Obon and New Year closures', () => {
    expect(isSeasonalClosure('2026-08-13')).toBe(true)
    expect(isSeasonalClosure('2026-08-16')).toBe(true)
    expect(isSeasonalClosure('2026-12-29')).toBe(true)
    expect(isSeasonalClosure('2027-01-03')).toBe(true)
    expect(isSeasonalClosure('2026-08-12')).toBe(false)
  })
})
