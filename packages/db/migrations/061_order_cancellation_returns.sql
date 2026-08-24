-- 注文を削除せず、発送前のキャンセル・誤登録の取り消し・発送後の返品返金を記録する。
ALTER TABLE orders ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active','cancelled','voided','returned'));
ALTER TABLE orders ADD COLUMN lifecycle_reason TEXT;
ALTER TABLE orders ADD COLUMN lifecycle_at TEXT;
ALTER TABLE orders ADD COLUMN lifecycle_by_staff_id TEXT;
ALTER TABLE orders ADD COLUMN refund_type TEXT NOT NULL DEFAULT 'none'
  CHECK (refund_type IN ('none','partial','full'));
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (refund_status IN ('not_required','pending','completed'));
ALTER TABLE orders ADD COLUMN refund_amount INTEGER
  CHECK (refund_amount IS NULL OR refund_amount >= 0);
ALTER TABLE orders ADD COLUMN refund_processed_at TEXT;

CREATE TABLE IF NOT EXISTS order_lifecycle_history (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL,
  from_lifecycle_status TEXT NOT NULL,
  to_lifecycle_status   TEXT NOT NULL,
  refund_type           TEXT NOT NULL,
  refund_status         TEXT NOT NULL,
  refund_amount         INTEGER,
  reason                TEXT NOT NULL,
  staff_id              TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_account_lifecycle_updated
  ON orders (line_account_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_lifecycle_history_order_created
  ON order_lifecycle_history (order_id, created_at DESC);
