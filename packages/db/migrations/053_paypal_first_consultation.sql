ALTER TABLE menus ADD COLUMN paypal_payment_url TEXT;
ALTER TABLE menus ADD COLUMN require_paypal_first_booking INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN is_first_consultation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (payment_status IN ('not_required','pending','paid','refunded'));
ALTER TABLE bookings ADD COLUMN payment_confirmed_at TEXT;
ALTER TABLE bookings ADD COLUMN payment_confirmed_by_staff_id TEXT;
CREATE INDEX idx_bookings_payment_status ON bookings (line_account_id, payment_status, starts_at);
