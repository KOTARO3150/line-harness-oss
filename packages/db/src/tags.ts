import { jstNow } from './utils.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  const result = await db
    .prepare(`SELECT * FROM tags ORDER BY name ASC`)
    .all<Tag>();
  return result.results;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const color = input.color ?? '#3B82F6';

  await db
    .prepare(
      `INSERT INTO tags (id, name, color, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, input.name, color, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
}

/**
 * タグの名前・色を変える。存在しなければ null。
 *
 * 名前は UNIQUE 制約付き。重複したときは D1 が UNIQUE constraint エラーを投げるので、
 * 呼出側（route）で 409 に変換すること。
 */
export async function updateTag(
  db: D1Database,
  id: string,
  input: UpdateTagInput,
): Promise<Tag | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    params.push(input.color);
  }
  if (sets.length > 0) {
    params.push(id);
    await db
      .prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }
  return (
    (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null
  );
}

/**
 * タグを参照している場所の件数。
 *
 * tags を消すと、これらの列は ON DELETE SET NULL で **黙って NULL になる**。
 * つまりシナリオの起動条件やフォームのタグ付与が、警告なしに無効化される。
 * 削除前に必ずこれを見せること。
 */
export interface TagUsage {
  friends: number;
  scenarioTriggers: number;
  scenarioSteps: number;
  forms: number;
  entryRoutes: number;
  trackedLinks: number;
  bookingMenus: number;
  affiliateOffers: number;
  broadcasts: number;
}

export type TagWithUsage = Tag & { usage: TagUsage };

const USAGE_SELECT = `
  (SELECT COUNT(*) FROM friend_tags     WHERE tag_id          = t.id) AS friends,
  (SELECT COUNT(*) FROM scenarios       WHERE trigger_tag_id  = t.id) AS scenarioTriggers,
  (SELECT COUNT(*) FROM scenario_steps  WHERE on_reach_tag_id = t.id) AS scenarioSteps,
  (SELECT COUNT(*) FROM forms           WHERE on_submit_tag_id= t.id) AS forms,
  (SELECT COUNT(*) FROM entry_routes    WHERE tag_id          = t.id) AS entryRoutes,
  (SELECT COUNT(*) FROM tracked_links   WHERE tag_id          = t.id) AS trackedLinks,
  (SELECT COUNT(*) FROM menus           WHERE auto_tag_id     = t.id) AS bookingMenus,
  (SELECT COUNT(*) FROM affiliate_offers WHERE tag_id         = t.id) AS affiliateOffers,
  (SELECT COUNT(*) FROM broadcasts      WHERE target_tag_id   = t.id) AS broadcasts`;

type UsageRow = Tag & Record<keyof TagUsage, number>;

function splitUsage(row: UsageRow): TagWithUsage {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
    usage: {
      friends: row.friends,
      scenarioTriggers: row.scenarioTriggers,
      scenarioSteps: row.scenarioSteps,
      forms: row.forms,
      entryRoutes: row.entryRoutes,
      trackedLinks: row.trackedLinks,
      bookingMenus: row.bookingMenus,
      affiliateOffers: row.affiliateOffers,
      broadcasts: row.broadcasts,
    },
  };
}

export async function getTagsWithUsage(db: D1Database): Promise<TagWithUsage[]> {
  const result = await db
    .prepare(`SELECT t.*, ${USAGE_SELECT} FROM tags t ORDER BY t.name ASC`)
    .all<UsageRow>();
  return (result.results ?? []).map(splitUsage);
}

export async function getTagWithUsage(
  db: D1Database,
  id: string,
): Promise<TagWithUsage | null> {
  const row = await db
    .prepare(`SELECT t.*, ${USAGE_SELECT} FROM tags t WHERE t.id = ?`)
    .bind(id)
    .first<UsageRow>();
  return row ? splitUsage(row) : null;
}

/** 友だちへの付与を除いた、設定側からの参照数。0 なら消しても自動化は壊れない。 */
export function countAutomationRefs(usage: TagUsage): number {
  return (
    usage.scenarioTriggers +
    usage.scenarioSteps +
    usage.forms +
    usage.entryRoutes +
    usage.trackedLinks +
    usage.bookingMenus +
    usage.affiliateOffers +
    usage.broadcasts
  );
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

export async function getFriendTags(
  db: D1Database,
  friendId: string,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*
       FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
       WHERE ft.friend_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
): Promise<Friend[]> {
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id = ?
       ORDER BY f.created_at DESC`,
    )
    .bind(tagId)
    .all<Friend>();
  return result.results;
}
