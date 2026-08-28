-- 相談カルテの閲覧を登録制にする。
-- オーナーは常に閲覧できる。それ以外の担当者は、オーナーが明示的に
-- 登録した場合だけ閲覧・記録・フォロー送信ができる。
--
-- 既存の担当者は、これまで閲覧できていた状態をそのまま保つため登録済みとする。
-- これから追加する担当者は既定で未登録（0）になり、登録するまで見られない。
ALTER TABLE staff_members ADD COLUMN can_view_charts INTEGER NOT NULL DEFAULT 0;

UPDATE staff_members SET can_view_charts = 1;

-- 誰をいつ登録したかは staff_members.updated_at と、
-- 閲覧そのものは consultation_audit_logs で追跡する。
