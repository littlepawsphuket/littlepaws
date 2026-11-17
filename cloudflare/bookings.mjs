// Search pending bookings without exposing notes, contact details, or payment records.
export async function pendingBookings(db, after, search) {
  const {results} = await db.prepare(`
    SELECT a.id, a.booking_number, a.checkin, a.checkout, a.charged_nights,
      c.name AS customer,
      (SELECT group_concat(d.name, ', ') FROM appointment_dogs ad
       JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) AS dogs,
      ROUND(a.agreed_total * 100) AS total_cents,
      COALESCE((SELECT SUM(ROUND(t.amount * 100)) FROM transactions t
       WHERE t.deposit_appointment_id=a.id AND t.payment_type='deposit'), 0) AS deposit_cents,
      (NOT EXISTS (SELECT 1 FROM appointment_dogs ad WHERE ad.appointment_id=a.id)
       OR EXISTS (SELECT 1 FROM appointment_dogs ad
                  WHERE ad.appointment_id=a.id AND ad.nightly_rate_cents IS NULL)) AS quote_pending
    FROM appointments a JOIN customers c ON c.id=a.customer_id
    WHERE a.status='pending' AND a.stay_id IS NULL AND a.id>?
      AND (?='' OR instr(lower(a.booking_number),?)>0 OR instr(lower(c.name),?)>0
        OR EXISTS (SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
                   WHERE ad.appointment_id=a.id AND instr(lower(d.name),?)>0))
    ORDER BY a.id LIMIT 26
  `).bind(after, search, search, search, search).all();
  const bookings = results.slice(0, 25);
  return {bookings, nextAfter: results.length > bookings.length ? bookings.at(-1).id : null};
}

export async function bookingDetails(db, id) {
  const [details, dogs, payments] = await db.batch([
    db.prepare(`SELECT a.id,a.booking_number,a.checkin,a.checkout,a.charged_nights,a.service_type,
      a.status,a.stay_id,a.note,a.discount_cents,c.name AS customer,
      COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id,' /'),''),c.contact) AS contact,
      ROUND(COALESCE(s.agreed_total,a.agreed_total)*100) AS total_cents
      FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN stays s ON s.id=a.stay_id
      WHERE a.id=?`).bind(id),
    db.prepare(`SELECT d.name,ad.nightly_rate_cents
      FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
      WHERE ad.appointment_id=? ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT t.occurred_on,t.received_time,t.payment_type,ROUND(t.amount*100) AS amount_cents
      FROM appointments a JOIN transactions t
        ON (a.stay_id IS NOT NULL AND t.stay_id=a.stay_id)
        OR (a.stay_id IS NULL AND t.deposit_appointment_id=a.id)
      WHERE a.id=? AND t.payment_type!=''
      ORDER BY t.occurred_on,t.received_time,t.id`).bind(id),
  ]);
  const booking = details.results[0];
  if (!booking) return null;
  const quotePending = !dogs.results.length || dogs.results.some((dog) => dog.nightly_rate_cents === null);
  const paidCents = payments.results.reduce((sum, payment) => sum + payment.amount_cents, 0);
  return {
    ...booking, dogs: dogs.results, payments: payments.results, paid_cents: paidCents,
    balance_cents: quotePending ? null : Math.max(0, booking.total_cents - paidCents),
  };
}
