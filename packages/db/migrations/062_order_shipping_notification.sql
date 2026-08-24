ALTER TABLE orders ADD COLUMN expected_delivery_date TEXT;
ALTER TABLE orders ADD COLUMN delivery_time_slot TEXT;
ALTER TABLE orders ADD COLUMN delivery_instruction TEXT;
ALTER TABLE orders ADD COLUMN shipping_notification_status TEXT NOT NULL DEFAULT 'not_sent'
  CHECK (shipping_notification_status IN ('not_sent', 'sent', 'failed', 'not_applicable'));
ALTER TABLE orders ADD COLUMN shipping_notification_sent_at TEXT;
ALTER TABLE orders ADD COLUMN shipping_notification_error TEXT;
ALTER TABLE orders ADD COLUMN shipping_notification_text TEXT;
