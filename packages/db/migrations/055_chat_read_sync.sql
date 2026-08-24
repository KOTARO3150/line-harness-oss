-- LINE webhook の最新 markAsReadToken を保持する。
-- 管理画面で会話を開いたとき、LINE Official Account Manager 側にも既読を付けるために使う。
ALTER TABLE chats ADD COLUMN mark_as_read_token TEXT;
