-- Consultation charts are deliberately separated from LINE messages and tags.
CREATE TABLE IF NOT EXISTS consultation_charts (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  friend_id             TEXT NOT NULL UNIQUE,
  customer_name         TEXT,
  customer_name_kana    TEXT,
  birth_date            TEXT,
  phone                 TEXT,
  allergies             TEXT,
  current_medications   TEXT,
  safety_notes          TEXT,
  general_notes         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_consultation_charts_account ON consultation_charts (line_account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS consultation_records (
  id                    TEXT PRIMARY KEY,
  chart_id              TEXT NOT NULL,
  consultation_at       TEXT NOT NULL,
  consultation_type     TEXT NOT NULL DEFAULT 'in_person',
  chief_complaint       TEXT,
  observations          TEXT,
  recommendation        TEXT,
  products              TEXT,
  usage_instructions    TEXT,
  follow_up_plan        TEXT,
  source_form_submission_id TEXT UNIQUE,
  created_by_staff_id   TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (chart_id) REFERENCES consultation_charts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_consultation_records_chart ON consultation_records (chart_id, consultation_at DESC);

CREATE TABLE IF NOT EXISTS consultation_audit_logs (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  chart_id              TEXT,
  friend_id             TEXT NOT NULL,
  staff_id              TEXT NOT NULL,
  action                TEXT NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consultation_audit_chart ON consultation_audit_logs (chart_id, created_at DESC);
