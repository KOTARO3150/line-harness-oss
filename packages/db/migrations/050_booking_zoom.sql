-- Zoom meeting automation for booking menus.
ALTER TABLE menus ADD COLUMN create_zoom_meeting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN zoom_meeting_id TEXT;
ALTER TABLE bookings ADD COLUMN zoom_join_url TEXT;
ALTER TABLE bookings ADD COLUMN zoom_start_url TEXT;
