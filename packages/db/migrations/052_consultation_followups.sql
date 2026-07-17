ALTER TABLE consultation_records ADD COLUMN follow_up_due_date TEXT;
ALTER TABLE consultation_records ADD COLUMN follow_up_completed_at TEXT;
ALTER TABLE consultation_records ADD COLUMN follow_up_last_sent_at TEXT;
CREATE INDEX IF NOT EXISTS idx_consultation_records_follow_up_due
  ON consultation_records (follow_up_due_date, follow_up_completed_at);
