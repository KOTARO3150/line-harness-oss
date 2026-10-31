export interface LineSendPause {
  paused: boolean;
  reason: string | null;
  updatedByStaffId: string | null;
  updatedAt: string | null;
}

interface Row {
  paused: number;
  reason: string | null;
  updated_by_staff_id: string | null;
  updated_at: string | null;
}

/**
 * 現在の停止状態。行が無い（migration 未適用など）ときは「送信する」として扱う。
 * 停止機能が無いことを理由に全配信が止まるのを防ぐため。
 */
export async function getLineSendPause(db: D1Database): Promise<LineSendPause> {
  const row = await db
    .prepare('SELECT paused, reason, updated_by_staff_id, updated_at FROM line_send_pause WHERE id = 1')
    .first<Row>();
  return {
    paused: row?.paused === 1,
    reason: row?.reason ?? null,
    updatedByStaffId: row?.updated_by_staff_id ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function setLineSendPause(
  db: D1Database,
  input: { paused: boolean; reason: string | null; staffId: string; now: string },
): Promise<LineSendPause> {
  await db
    .prepare(
      `INSERT INTO line_send_pause (id, paused, reason, updated_by_staff_id, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         paused = excluded.paused,
         reason = excluded.reason,
         updated_by_staff_id = excluded.updated_by_staff_id,
         updated_at = excluded.updated_at`,
    )
    .bind(input.paused ? 1 : 0, input.reason, input.staffId, input.now)
    .run();
  return getLineSendPause(db);
}
