import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  api_key: string;
  api_key_hash: string | null;
  api_key_hint: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface UpdateStaffInput {
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  is_active?: number;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

async function hashApiKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function apiKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}

function retiredApiKeyValue(): string {
  return `retired_${crypto.randomUUID()}`;
}

export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<StaffMember | null> {
  const hash = await hashApiKey(apiKey);
  const hashed = await db
    .prepare('SELECT * FROM staff_members WHERE api_key_hash = ? AND is_active = 1')
    .bind(hash)
    .first<StaffMember>();
  if (hashed) return hashed;

  // 段階移行: 旧バージョンで平文保存されたキーは、最初の正常ログイン時だけ
  // 旧列で照合し、その場でハッシュへ移して平文を破棄する。
  const legacy = await db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
  if (!legacy) return null;

  await db
    .prepare(
      `UPDATE staff_members
          SET api_key_hash = ?, api_key_hint = ?, api_key = ?, updated_at = ?
        WHERE id = ? AND api_key = ?`,
    )
    .bind(hash, apiKeyHint(apiKey), retiredApiKeyValue(), jstNow(), legacy.id, apiKey)
    .run();

  return {
    ...legacy,
    api_key: '',
    api_key_hash: hash,
    api_key_hint: apiKeyHint(apiKey),
  };
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
): Promise<StaffMember> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);

  await db
    .prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, api_key_hash, api_key_hint, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.email ?? null, input.role, retiredApiKeyValue(), hash, apiKeyHint(apiKey), now, now)
    .run();

  const created = (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
  // 生のキーを返すのは作成直後の一度だけ。DBには保存しない。
  return { ...created, api_key: apiKey };
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(db: D1Database, id: string): Promise<string> {
  const newKey = generateApiKey();
  const hash = await hashApiKey(newKey);
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE staff_members
          SET api_key = ?, api_key_hash = ?, api_key_hint = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(retiredApiKeyValue(), hash, apiKeyHint(newKey), now, id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
