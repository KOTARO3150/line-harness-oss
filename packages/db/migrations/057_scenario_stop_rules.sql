-- 鈴木薬舗向け: お客様が人との相談へ進んだ後に自動配信を続けない。
ALTER TABLE scenarios ADD COLUMN stop_on_customer_reply INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scenarios ADD COLUMN stop_on_booking INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scenarios ADD COLUMN stop_on_consultation INTEGER NOT NULL DEFAULT 1;

-- なぜ終了したかを個人情報なしで監査できるようにする。
ALTER TABLE friend_scenarios ADD COLUMN completion_reason TEXT;
