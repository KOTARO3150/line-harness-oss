-- 注文の商品単位と、進捗に関係なく行える編集の監査履歴。
ALTER TABLE order_items ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT '個';

CREATE TABLE IF NOT EXISTS order_edit_history (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_edit_history_order_created
  ON order_edit_history (order_id, created_at DESC);
