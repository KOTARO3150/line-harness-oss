-- 鈴木薬舗向け: ステップ配信から独立した、いつでも見返せる動画案内所。
CREATE TABLE IF NOT EXISTS video_library_items (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'お悩み別',
  video_url         TEXT NOT NULL,
  thumbnail_url     TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_featured       INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_video_library_account_sort
  ON video_library_items (line_account_id, is_active, sort_order, created_at);
