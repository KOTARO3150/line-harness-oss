import { describe, expect, test, vi } from 'vitest';
import { ensureConsultationChartForConfirmedBooking } from './consultation-chart-bootstrap.js';

describe('ensureConsultationChartForConfirmedBooking', () => {
  test('creates only an empty chart link for a confirmed booking', async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const now = new Date('2026-07-22T03:00:00.000Z');

    const result = await ensureConsultationChartForConfirmedBooking(
      { prepare } as unknown as D1Database,
      'booking-1',
      now,
    );

    expect(result).toEqual({ created: true });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("b.status = 'confirmed'"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(friend_id) DO NOTHING'));
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      now.toISOString(),
      now.toISOString(),
      'booking-1',
    );
  });

  test('is idempotent when the chart already exists', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }),
      }),
    };

    await expect(
      ensureConsultationChartForConfirmedBooking(db as unknown as D1Database, 'booking-1'),
    ).resolves.toEqual({ created: false });
  });
});
