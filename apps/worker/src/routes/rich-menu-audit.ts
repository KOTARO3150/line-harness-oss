import { Hono } from 'hono';
import {
  getLineAccountById,
  getTags,
  createTag,
  addTagToFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditRichMenuLinks } from '../services/rich-menu-audit.js';

export const richMenuAudit = new Hono<Env>();

// 全お客様の名簿を作る操作なので owner 限定。個別のハンドラでも指定しているが、
// 将来ここに別の口を足したときに素通りしないよう、網も張っておく。
richMenuAudit.on(
  ['POST', 'PUT', 'PATCH', 'DELETE'],
  ['/api/rich-menu-groups/audit-links', '/api/rich-menu-groups/audit-links/*'],
  requireRole('owner'),
);

// ----- 割り当ての実測とタグ付け (新規/既存の名簿づくり) -----
//
// プロラインは友だち一人ひとりにリッチメニューを個別リンクしている。
// 「誰が既存のお客様か」は LINE 側の現状にしか無い情報で、
// LINE には「このメニューが付いている人を列挙する」API が無いため、
// 1 人ずつ問い合わせるしかない。この API はそれをページ単位で行う。
//
// body:
//   { accountId, offset?, limit?, assign? }
//   assign を省略すると数えるだけ（下見）。渡したときだけタグを付ける。
//   assign は { "<richMenuId>": "タグ名" }。個別リンクの無い人は "none" をキーにする。
//
// 何をしないか:
//   - リッチメニューの割り当てを変えない・消さない
//   - タグを外さない（付けるだけ）
// 全員ぶんの名簿を作る操作なので owner 限定。
richMenuAudit.post(
  '/api/rich-menu-groups/audit-links',
  requireRole('owner'),
  async (c) => {
    let body: unknown = {};
    try {
      const raw = await c.req.text();
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      return c.json({ success: false, error: 'invalid JSON body' }, 400);
    }
    const r = (body as Record<string, unknown>) ?? {};

    if (typeof r.accountId !== 'string' || !r.accountId) {
      return c.json({ success: false, error: 'accountId required' }, 400);
    }
    if (r.offset !== undefined && (typeof r.offset !== 'number' || !Number.isInteger(r.offset) || r.offset < 0)) {
      return c.json({ success: false, error: 'offset must be a non-negative integer' }, 400);
    }
    if (r.limit !== undefined && (typeof r.limit !== 'number' || !Number.isInteger(r.limit) || r.limit < 1)) {
      return c.json({ success: false, error: 'limit must be a positive integer' }, 400);
    }

    let assign: Record<string, string> | undefined;
    if (r.assign !== undefined) {
      if (typeof r.assign !== 'object' || r.assign === null || Array.isArray(r.assign)) {
        return c.json({ success: false, error: 'assign must be an object' }, 400);
      }
      assign = Object.create(null) as Record<string, string>;
      // Object.entries は prototype を辿らないので __proto__ などは入ってこないが、
      // 念のためタグ名の側を検証する（空文字のタグを作らせない）。
      for (const [menuId, tagName] of Object.entries(r.assign as Record<string, unknown>)) {
        if (typeof tagName !== 'string' || tagName.trim() === '') {
          return c.json(
            { success: false, error: `assign["${menuId}"] must be a non-empty tag name` },
            400,
          );
        }
        if (tagName.length > 60) {
          return c.json({ success: false, error: 'tag name too long (max 60)' }, 400);
        }
        assign[menuId] = tagName.trim();
      }
      if (Object.keys(assign).length === 0) {
        return c.json({ success: false, error: 'assign must not be empty' }, 400);
      }
    }

    const account = await getLineAccountById(c.env.DB, r.accountId);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 404);

    // タグは名前で引き、無ければ作る。既存のタグを勝手に作り替えたりはしない。
    const resolveTagId = async (name: string): Promise<string> => {
      const existing = (await getTags(c.env.DB)).find((t) => t.name === name);
      if (existing) return existing.id;
      const created = await createTag(c.env.DB, { name, color: '#1B5E42' });
      return created.id;
    };

    try {
      const result = await auditRichMenuLinks(c.env.DB, account.channel_access_token, {
        accountId: r.accountId,
        offset: r.offset as number | undefined,
        limit: r.limit as number | undefined,
        assign,
        resolveTagId,
        attachTag: (friendId, tagId) => addTagToFriend(c.env.DB, friendId, tagId),
      });
      return c.json({
        success: true,
        data: {
          ...result,
          dryRun: assign === undefined,
          message:
            result.nextOffset === null
              ? '全員ぶん見終えました'
              : `続きがあります。offset=${result.nextOffset} でもう一度呼んでください`,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ success: false, error: message }, 500);
    }
  },
);
