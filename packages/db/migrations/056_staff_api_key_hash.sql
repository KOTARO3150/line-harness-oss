-- 管理画面APIキーを復元不能なSHA-256ハッシュで照合するための列。
-- 既存キーは次回の正常ログイン時にアプリ側で段階移行するため、
-- このマイグレーションでは値の書き換えを行わない。
ALTER TABLE staff_members ADD COLUMN api_key_hash TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_hint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_api_key_hash
  ON staff_members(api_key_hash)
  WHERE api_key_hash IS NOT NULL;
