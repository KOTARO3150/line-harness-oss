import { Hono } from 'hono';
import { getLineSendPause, jstNow, setLineSendPause } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * LINE送信の緊急停止スイッチ。
 *
 * - 止める: ログインしている担当者なら誰でもできる。気づいた人がすぐ押せることを優先する。
 * - 再開する: owner / admin だけ。原因を直したことを責任者が確認してから再開する。
 */
export const sendPause = new Hono<Env>();

function serialize(state: Awaited<ReturnType<typeof getLineSendPause>>) {
  return {
    paused: state.paused,
    reason: state.reason,
    updatedByStaffId: state.updatedByStaffId,
    updatedAt: state.updatedAt,
  };
}

sendPause.get('/api/line-send-pause', async (c) => {
  return c.json({ success: true, data: serialize(await getLineSendPause(c.env.DB)) });
});

sendPause.post('/api/line-send-pause', async (c) => {
  const body = await c.req.json<{ paused?: unknown; reason?: unknown }>().catch(() => ({}) as { paused?: unknown; reason?: unknown });
  if (typeof body.paused !== 'boolean') {
    return c.json({ success: false, error: 'paused は true / false で指定してください' }, 400);
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 500) {
    return c.json({ success: false, error: '理由は500文字以内で入力してください' }, 400);
  }
  const staff = c.get('staff');
  if (!body.paused && staff.role === 'staff') {
    return c.json({ success: false, error: '送信の再開には管理者権限が必要です' }, 403);
  }
  const state = await setLineSendPause(c.env.DB, {
    paused: body.paused,
    reason: reason || null,
    staffId: staff.id,
    now: jstNow(),
  });
  console.warn(`[line-send-pause] ${body.paused ? '停止' : '再開'} by staff=${staff.id} reason=${reason || '-'}`);
  return c.json({ success: true, data: serialize(state) });
});
