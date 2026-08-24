import { jstNow } from './utils.js';

export interface VideoLibraryItem {
  id: string;
  line_account_id: string;
  title: string;
  description: string | null;
  category: string;
  video_url: string;
  thumbnail_url: string | null;
  sort_order: number;
  is_featured: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateVideoLibraryItemInput {
  lineAccountId: string;
  title: string;
  description?: string | null;
  category?: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  sortOrder?: number;
  isFeatured?: boolean;
  isActive?: boolean;
}

export async function getVideoLibraryItems(
  db: D1Database,
  lineAccountId: string,
  activeOnly = false,
): Promise<VideoLibraryItem[]> {
  const activeClause = activeOnly ? 'AND is_active = 1' : '';
  const result = await db.prepare(
    `SELECT * FROM video_library_items
     WHERE line_account_id = ? ${activeClause}
     ORDER BY is_featured DESC, sort_order ASC, created_at ASC`,
  ).bind(lineAccountId).all<VideoLibraryItem>();
  return result.results;
}

export async function getVideoLibraryItem(
  db: D1Database,
  id: string,
): Promise<VideoLibraryItem | null> {
  return db.prepare('SELECT * FROM video_library_items WHERE id = ?').bind(id).first<VideoLibraryItem>();
}

export async function createVideoLibraryItem(
  db: D1Database,
  input: CreateVideoLibraryItemInput,
): Promise<VideoLibraryItem> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO video_library_items
      (id, line_account_id, title, description, category, video_url, thumbnail_url,
       sort_order, is_featured, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.lineAccountId,
    input.title,
    input.description ?? null,
    input.category || 'お悩み別',
    input.videoUrl,
    input.thumbnailUrl ?? null,
    input.sortOrder ?? 0,
    input.isFeatured ? 1 : 0,
    input.isActive === false ? 0 : 1,
    now,
    now,
  ).run();
  return (await getVideoLibraryItem(db, id))!;
}

export async function updateVideoLibraryItem(
  db: D1Database,
  id: string,
  input: Partial<Omit<CreateVideoLibraryItemInput, 'lineAccountId'>>,
): Promise<VideoLibraryItem | null> {
  const values: unknown[] = [];
  const sets: string[] = [];
  const add = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (input.title !== undefined) add('title', input.title);
  if (input.description !== undefined) add('description', input.description);
  if (input.category !== undefined) add('category', input.category);
  if (input.videoUrl !== undefined) add('video_url', input.videoUrl);
  if (input.thumbnailUrl !== undefined) add('thumbnail_url', input.thumbnailUrl);
  if (input.sortOrder !== undefined) add('sort_order', input.sortOrder);
  if (input.isFeatured !== undefined) add('is_featured', input.isFeatured ? 1 : 0);
  if (input.isActive !== undefined) add('is_active', input.isActive ? 1 : 0);
  if (sets.length === 0) return getVideoLibraryItem(db, id);
  add('updated_at', jstNow());
  values.push(id);
  await db.prepare(`UPDATE video_library_items SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getVideoLibraryItem(db, id);
}

export async function deleteVideoLibraryItem(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM video_library_items WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
