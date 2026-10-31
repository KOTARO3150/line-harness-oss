-- LINE送信の緊急停止スイッチ。
-- 誤った一斉配信やシナリオの暴走に気づいたとき、管理画面から全アカウントの
-- 送信（push / multicast / broadcast / reply）をまとめて止めるための1行だけの表。
--
-- 既定は「送信する」(paused = 0)。この migration を適用しても挙動は変わらない。
CREATE TABLE IF NOT EXISTS line_send_pause (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  reason TEXT,
  updated_by_staff_id TEXT,
  updated_at TEXT
);

INSERT OR IGNORE INTO line_send_pause (id, paused) VALUES (1, 0);
