import { Hono } from 'hono';
import {
  getTags,
  getTagsWithUsage,
  getTagWithUsage,
  createTag,
  updateTag,
  deleteTag,
  countAutomationRefs,
  type TagWithUsage,
} from '@line-crm/db';
import type { Tag as DbTag } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

function serializeTagWithUsage(row: TagWithUsage) {
  return {
    ...serializeTag(row),
    usage: row.usage,
    // 友だちへの付与を除いた参照数。0 でなければ、消すと設定が黙って無効になる。
    automationRefs: countAutomationRefs(row.usage),
  };
}

/** UNIQUE(name) 違反かどうか。D1 のメッセージ文言に依存するので広めに見る。 */
function isDuplicateNameError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed:\s*tags\.name/i.test(message);
}

// GET /api/tags — 一覧。?withUsage=1 で参照数つき（タグ管理画面用）。
// 参照数は 9 本のサブクエリを伴うので、選択用ドロップダウン等は素の一覧のまま使う。
tags.get('/api/tags', async (c) => {
  try {
    if (c.req.query('withUsage') === '1') {
      const items = await getTagsWithUsage(c.env.DB);
      return c.json({ success: true, data: items.map(serializeTagWithUsage) });
    }
    const items = await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; color?: string }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, { name, color: body.color });
    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    if (isDuplicateNameError(err)) {
      return c.json({ success: false, error: '同じ名前のタグがすでにあります' }, 409);
    }
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/tags/:id — 名前・色の変更。
// 名前を変えても id は変わらないので、シナリオやフォームの紐づけは保たれる。
tags.put('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: 'id required' }, 400);
  try {
    const body = await c.req.json<{ name?: string; color?: string }>();

    const patch: { name?: string; color?: string } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return c.json({ success: false, error: 'name cannot be empty' }, 400);
      patch.name = name;
    }
    if (body.color !== undefined) {
      if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        return c.json({ success: false, error: 'color must be like #3B82F6' }, 400);
      }
      patch.color = body.color;
    }

    const updated = await updateTag(c.env.DB, id, patch);
    if (!updated) return c.json({ success: false, error: 'Tag not found' }, 404);
    return c.json({ success: true, data: serializeTag(updated) });
  } catch (err) {
    if (isDuplicateNameError(err)) {
      return c.json({ success: false, error: '同じ名前のタグがすでにあります' }, 409);
    }
    console.error('PUT /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id — 削除。
//
// tags を消すと、参照している列は ON DELETE SET NULL で **黙って NULL になる**
// （シナリオの起動タグ、フォームのタグ付与、流入経路のタグ、予約メニューの自動タグ…）。
// 気づかないうちに自動化が止まるので、参照が残っているうちは 409 で拒否し、
// 何がぶら下がっているかを返す。本当に消すときだけ ?force=1。
tags.delete('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ success: false, error: 'id required' }, 400);
    const existing = await getTagWithUsage(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Tag not found' }, 404);

    if (countAutomationRefs(existing.usage) > 0 && c.req.query('force') !== '1') {
      return c.json(
        {
          success: false,
          error:
            'このタグは設定から参照されています。消すとその設定が黙って無効になります',
          data: serializeTagWithUsage(existing),
        },
        409,
      );
    }

    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
