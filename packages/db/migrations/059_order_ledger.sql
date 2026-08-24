-- 鈴木薬舗向け注文台帳。
-- チャットの対応状態とは分離し、受付から発送までを監査履歴付きで管理する。
CREATE TABLE IF NOT EXISTS orders (
  id                     TEXT PRIMARY KEY,
  line_account_id        TEXT NOT NULL,
  friend_id              TEXT,
  status                 TEXT NOT NULL DEFAULT 'unconfirmed'
                           CHECK (status IN ('unconfirmed','preparing','ready_to_ship','shipped')),
  source                 TEXT NOT NULL DEFAULT 'line'
                           CHECK (source IN ('line','phone','store','other')),
  customer_name_snapshot TEXT NOT NULL,
  shipping_method        TEXT,
  carrier                TEXT,
  tracking_number        TEXT,
  note                   TEXT,
  preparing_at           TEXT,
  ready_to_ship_at       TEXT,
  shipped_at             TEXT,
  created_by_staff_id    TEXT NOT NULL,
  updated_by_staff_id    TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  item_name   TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  INTEGER CHECK (unit_price IS NULL OR unit_price >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('unconfirmed','preparing','ready_to_ship','shipped')),
  to_status   TEXT NOT NULL CHECK (to_status IN ('unconfirmed','preparing','ready_to_ship','shipped')),
  staff_id    TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_account_status_updated
  ON orders (line_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_friend_updated
  ON orders (friend_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_sort
  ON order_items (order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created
  ON order_status_history (order_id, created_at DESC);
