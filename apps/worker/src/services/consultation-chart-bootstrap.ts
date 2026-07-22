/**
 * Prepare the customer's consultation chart as soon as a booking is confirmed.
 *
 * The chart only establishes the link between the LINE friend and the booking.
 * It deliberately does not create a consultation record or copy health data:
 * those are added only after an operator has reviewed the source information.
 */
export async function ensureConsultationChartForConfirmedBooking(
  db: D1Database,
  bookingId: string,
  now = new Date(),
): Promise<{ created: boolean }> {
  const result = await db.prepare(
    `INSERT INTO consultation_charts
      (id, line_account_id, friend_id, customer_name, customer_name_kana, birth_date,
       phone, allergies, current_medications, safety_notes, general_notes, created_at, updated_at)
     SELECT ?, b.line_account_id, b.friend_id, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, ?, ?
       FROM bookings b
       INNER JOIN friends f
         ON f.id = b.friend_id AND f.line_account_id = b.line_account_id
      WHERE b.id = ? AND b.status = 'confirmed'
     ON CONFLICT(friend_id) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    now.toISOString(),
    now.toISOString(),
    bookingId,
  ).run();

  return { created: (result.meta?.changes ?? 0) > 0 };
}
