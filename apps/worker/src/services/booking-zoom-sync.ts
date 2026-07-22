export interface ZoomConfig {
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
  userId?: string;
}

type ZoomSyncResult =
  | { status: 'created'; meetingId: string; joinUrl: string }
  | { status: 'deleted' }
  | { status: 'skipped'; reason: 'not_online' | 'not_configured' | 'already_synced' | 'not_linked' };

interface ZoomBookingRow {
  id: string;
  starts_at: string;
  ends_at: string;
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  menu_name: string;
  create_zoom_meeting: number;
  friend_name: string | null;
}

function configured(config: ZoomConfig): config is Required<ZoomConfig> {
  return Boolean(config.accountId && config.clientId && config.clientSecret && config.userId);
}

async function getAccessToken(config: ZoomConfig): Promise<string> {
  if (!configured(config)) throw new Error('Zoom Server-to-Server OAuth is not configured');
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const url = new URL('https://zoom.us/oauth/token');
  url.searchParams.set('grant_type', 'account_credentials');
  url.searchParams.set('account_id', config.accountId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!response.ok) throw new Error(`Zoom OAuth error ${response.status}`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Zoom OAuth response missing access_token');
  return data.access_token;
}

async function deleteZoomMeeting(meetingId: string, config: ZoomConfig): Promise<void> {
  const token = await getAccessToken(config);
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Zoom delete meeting error ${response.status}`);
  }
}

export async function ensureZoomMeetingForBooking(
  db: D1Database,
  bookingId: string,
  config: ZoomConfig,
): Promise<ZoomSyncResult> {
  const booking = await db.prepare(
    `SELECT b.id, b.starts_at, b.ends_at, b.zoom_meeting_id, b.zoom_join_url,
            m.name AS menu_name, m.create_zoom_meeting,
            f.display_name AS friend_name
       FROM bookings b
       INNER JOIN menus m ON m.id = b.menu_id
       LEFT JOIN friends f ON f.id = b.friend_id
      WHERE b.id = ? AND b.status = 'confirmed'`,
  ).bind(bookingId).first<ZoomBookingRow>();
  if (!booking || booking.create_zoom_meeting !== 1) {
    return { status: 'skipped', reason: 'not_online' };
  }
  if (booking.zoom_meeting_id && booking.zoom_join_url) {
    return { status: 'skipped', reason: 'already_synced' };
  }
  if (!configured(config)) return { status: 'skipped', reason: 'not_configured' };

  const token = await getAccessToken(config);
  const duration = Math.max(1, Math.round(
    (new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 60_000,
  ));
  const response = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(config.userId)}/meetings`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: `鈴木薬舗 ${booking.menu_name}（${booking.friend_name || 'お客様'}）`,
        type: 2,
        start_time: booking.starts_at,
        duration,
        timezone: 'Asia/Tokyo',
        settings: { waiting_room: true, join_before_host: false },
      }),
    },
  );
  if (!response.ok) throw new Error(`Zoom create meeting error ${response.status}`);
  const meeting = await response.json() as {
    id?: number | string;
    join_url?: string;
    start_url?: string;
  };
  if (!meeting.id || !meeting.join_url || !meeting.start_url) {
    throw new Error('Zoom create meeting response missing meeting details');
  }
  const meetingId = String(meeting.id);
  const stored = await db.prepare(
    `UPDATE bookings
        SET zoom_meeting_id = ?, zoom_join_url = ?, zoom_start_url = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE id = ? AND status = 'confirmed' AND zoom_meeting_id IS NULL`,
  ).bind(meetingId, meeting.join_url, meeting.start_url, bookingId).run();
  if ((stored.meta?.changes ?? 0) === 0) {
    await deleteZoomMeeting(meetingId, config);
    return { status: 'skipped', reason: 'already_synced' };
  }
  return { status: 'created', meetingId, joinUrl: meeting.join_url };
}

export async function removeZoomMeetingForBooking(
  db: D1Database,
  bookingId: string,
  config: ZoomConfig,
): Promise<ZoomSyncResult> {
  const booking = await db.prepare(
    `SELECT zoom_meeting_id FROM bookings WHERE id = ?`,
  ).bind(bookingId).first<{ zoom_meeting_id: string | null }>();
  if (!booking?.zoom_meeting_id) return { status: 'skipped', reason: 'not_linked' };
  if (!configured(config)) return { status: 'skipped', reason: 'not_configured' };
  await deleteZoomMeeting(booking.zoom_meeting_id, config);
  await db.prepare(
    `UPDATE bookings
        SET zoom_meeting_id = NULL, zoom_join_url = NULL, zoom_start_url = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE id = ? AND zoom_meeting_id = ?`,
  ).bind(bookingId, booking.zoom_meeting_id).run();
  return { status: 'deleted' };
}
