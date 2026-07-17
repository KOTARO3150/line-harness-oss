import { describe, expect, it } from 'vitest';
import { jstDayBounds } from './jst-day.js';

describe('jstDayBounds', () => {
  it('JSTの日付とUTC境界を別々に正しく返す', () => {
    expect(jstDayBounds(new Date('2026-07-17T12:00:00+09:00'))).toEqual({
      date: '2026-07-17',
      start: '2026-07-16T15:00:00.000Z',
      end: '2026-07-17T15:00:00.000Z',
    });
  });

  it('UTCでは前日でもJSTの日付を採用する', () => {
    expect(jstDayBounds(new Date('2026-07-16T16:00:00.000Z')).date).toBe('2026-07-17');
  });
});
