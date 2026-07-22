import { GoogleCalendarClient } from './google-calendar.js';

type CalendarSyncResult =
  | { status: 'created'; eventId: string }
  | { status: 'deleted' }
  | { status: 'skipped'; reason: 'already_synced' | 'not_configured' | 'multiple_connections' | 'not_linked' | 'calendar_changed' };

interface BookingCalendarRow {
  id: string;
  starts_at: string;
  ends_at: string;
  external_event_id: string | null;
  external_calendar_id: string | null;
  staff_name: string;
  friend_name: string | null;
  zoom_join_url: string | null;
}

interface CalendarConnectionRow {
  id: string;
  calendar_id: string;
  access_token: string;
  refresh_token: string | null;
  auth_type: string;
}

export interface GoogleOAuthCredentials {
  clientId?: string;
  clientSecret?: string;
}

async function getOnlyActiveConnection(
  db: D1Database,
  oauth: GoogleOAuthCredentials = {},
): Promise<
  { connection: CalendarConnectionRow | null; multiple: boolean }
> {
  const rows = await db.prepare(
    `SELECT id, calendar_id, access_token, refresh_token, auth_type
       FROM google_calendar_connections
      WHERE is_active = 1 AND access_token IS NOT NULL AND access_token <> ''
      ORDER BY created_at DESC
      LIMIT 2`,
  ).all<CalendarConnectionRow>();
  if (rows.results.length !== 1) {
    return { connection: null, multiple: rows.results.length > 1 };
  }
  const connection = rows.results[0];
  // Google access tokens normally expire after one hour. Refresh immediately
  // before booking sync so long-running installations do not silently stop.
  if (
    connection.auth_type === 'oauth2' && connection.refresh_token &&
    oauth.clientId && oauth.clientSecret
  ) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: connection.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new Error(`Google OAuth refresh error ${response.status}`);
    const tokens = await response.json() as { access_token?: string };
    if (!tokens.access_token) throw new Error('Google OAuth refresh response missing access_token');
    connection.access_token = tokens.access_token;
    await db.prepare(
      `UPDATE google_calendar_connections
          SET access_token = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    ).bind(tokens.access_token, connection.id).run();
  }
  return { connection, multiple: false };
}

/**
 * Create one Google event for a confirmed booking.
 *
 * Calendar connections are not tenant-scoped in the current schema. To avoid
 * writing a customer's reservation to the wrong calendar, automatic sync is
 * enabled only when exactly one active access-token connection exists.
 */
export async function syncConfirmedBookingToCalendar(
  db: D1Database,
  bookingId: string,
  oauth: GoogleOAuthCredentials = {},
): Promise<CalendarSyncResult> {
  const booking = await db.prepare(
    `SELECT b.id, b.starts_at, b.ends_at, b.external_event_id, b.external_calendar_id,
            b.zoom_join_url,
            s.display_name AS staff_name, f.display_name AS friend_name
       FROM bookings b
       INNER JOIN staff s ON s.id = b.staff_id
       LEFT JOIN friends f ON f.id = b.friend_id
      WHERE b.id = ? AND b.status = 'confirmed'`,
  ).bind(bookingId).first<BookingCalendarRow>();

  if (!booking) return { status: 'skipped', reason: 'not_linked' };
  if (booking.external_event_id) return { status: 'skipped', reason: 'already_synced' };

  const { connection, multiple } = await getOnlyActiveConnection(db, oauth);
  if (multiple) return { status: 'skipped', reason: 'multiple_connections' };
  if (!connection) return { status: 'skipped', reason: 'not_configured' };

  const client = new GoogleCalendarClient({
    calendarId: connection.calendar_id,
    accessToken: connection.access_token,
  });
  const { eventId } = await client.createEvent({
    // Customer notes and menu details can contain health information, so they
    // are intentionally omitted from the external calendar.
    summary: `鈴木薬舗 予約（${booking.friend_name || 'お客様'}）`,
    start: booking.starts_at,
    end: booking.ends_at,
    description: [
      `担当: ${booking.staff_name}`,
      `予約ID: ${booking.id}`,
      booking.zoom_join_url ? `オンライン相談URL: ${booking.zoom_join_url}` : null,
    ].filter(Boolean).join('\n'),
  });

  const stored = await db.prepare(
    `UPDATE bookings
        SET external_event_id = ?, external_calendar_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE id = ? AND status = 'confirmed' AND external_event_id IS NULL`,
  ).bind(eventId, connection.calendar_id, bookingId).run();

  // Another request won the race, or the booking was cancelled while Google
  // was responding. Remove the event created by this losing request.
  if ((stored.meta?.changes ?? 0) === 0) {
    await client.deleteEvent(eventId);
    return { status: 'skipped', reason: 'already_synced' };
  }
  return { status: 'created', eventId };
}

export async function removeBookingFromCalendar(
  db: D1Database,
  bookingId: string,
  oauth: GoogleOAuthCredentials = {},
): Promise<CalendarSyncResult> {
  const booking = await db.prepare(
    `SELECT external_event_id, external_calendar_id FROM bookings WHERE id = ?`,
  ).bind(bookingId).first<Pick<BookingCalendarRow, 'external_event_id' | 'external_calendar_id'>>();
  if (!booking?.external_event_id || !booking.external_calendar_id) {
    return { status: 'skipped', reason: 'not_linked' };
  }

  const { connection, multiple } = await getOnlyActiveConnection(db, oauth);
  if (multiple) return { status: 'skipped', reason: 'multiple_connections' };
  if (!connection) return { status: 'skipped', reason: 'not_configured' };
  if (connection.calendar_id !== booking.external_calendar_id) {
    return { status: 'skipped', reason: 'calendar_changed' };
  }

  await new GoogleCalendarClient({
    calendarId: connection.calendar_id,
    accessToken: connection.access_token,
  }).deleteEvent(booking.external_event_id);
  await db.prepare(
    `UPDATE bookings
        SET external_event_id = NULL, external_calendar_id = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE id = ? AND external_event_id = ?`,
  ).bind(bookingId, booking.external_event_id).run();
  return { status: 'deleted' };
}
