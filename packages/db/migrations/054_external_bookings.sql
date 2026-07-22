-- Bookings imported manually from an external reservation provider.
-- Raw notification text is deliberately not retained because it can include
-- phone numbers, Zoom URLs, and provider-specific customer identifiers.
CREATE TABLE IF NOT EXISTS external_bookings (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  friend_id             TEXT NOT NULL,
  provider              TEXT NOT NULL DEFAULT 'proline',
  starts_at             TEXT NOT NULL,
  ends_at               TEXT,
  status                TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  menu_name             TEXT,
  created_by_staff_id   TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE,
  UNIQUE (line_account_id, friend_id, provider, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_external_bookings_friend_starts
  ON external_bookings (friend_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_bookings_account_status_starts
  ON external_bookings (line_account_id, status, starts_at);
