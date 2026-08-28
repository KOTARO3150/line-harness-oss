import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * 相談カルテは登録制。
 *
 * オーナーは常に閲覧できる。それ以外の担当者は、オーナーが
 * staff_members.can_view_charts を 1 にして登録した場合だけ通す。
 *
 * カルテには氏名・生年月日・電話番号・アレルギー・服薬情報が入るため、
 * 管理画面のメニューを隠すだけでは足りない。API 側で必ず止める。
 */
export async function requireChartAccess(
  c: Context<Env>,
  next: Next,
): Promise<Response | void> {
  const staff = c.get('staff');

  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (staff.role === 'owner' || staff.canViewCharts) {
    return next();
  }

  return c.json(
    {
      success: false,
      error: '相談カルテを見るには、オーナーによる登録が必要です',
    },
    403,
  );
}
