import {addPassBadges} from './stay_pass/booking_badges.mjs';
import {bookingCashRefunds} from './stay_pass/precheckin_cash.mjs';
import {savedBoardingPrice} from "./boarding_pricing.mjs";
import {bookingCardDogs} from "./card_dogs.mjs";
import {authorizedStaff, normalizePayment} from "./stay_payments.mjs";

const quotePending = `(NOT EXISTS (SELECT 1 FROM appointment_dogs ad WHERE ad.appointment_id=a.id)
  OR EXISTS (SELECT 1 FROM appointment_dogs ad
             WHERE ad.appointment_id=a.id AND ad.nightly_rate_cents IS NULL))`;
const deposited = `(COALESCE((SELECT SUM(ROUND(t.amount * 100)) FROM transactions t
  WHERE t.deposit_appointment_id=a.id AND t.payment_type='deposit'), 0) + COALESCE((SELECT CASE WHEN json_valid(details) THEN json_extract(details,'$.booking_cash_adjustment_cents') ELSE 0 END FROM boarding_charges WHERE appointment_id=a.id),0))`;

// Aggregate the full waiting queue, independently of page size and calendar cells.
export async function bookingForecast(db) {
  return db.prepare(`SELECT COUNT(*) AS booking_count,
    COALESCE(SUM(CASE WHEN ${quotePending} THEN 1 ELSE 0 END),0) AS unpriced_count,
    COALESCE(SUM(CASE WHEN ${quotePending} THEN 0 ELSE ROUND(a.agreed_total*100) END),0) AS total_cents,
    COALESCE(SUM(${deposited}),0) AS deposit_cents,
    COALESCE(SUM(CASE WHEN ${quotePending} THEN 0
      ELSE MAX(0,ROUND(a.agreed_total*100)-${deposited}) END),0) AS balance_cents
    FROM appointments a WHERE a.status='pending' AND a.stay_id IS NULL`).bind().first();
}

// Search pending bookings without exposing notes, contact details, or payment records.
export async function pendingBookings(db, after, search) {
  const {results} = await db.prepare(`
    SELECT a.id, a.booking_number, a.checkin, a.checkout, a.charged_nights,${bookingCardDogs} AS dog_photos,
      c.name AS customer,
      (SELECT group_concat(d.name, ', ') FROM appointment_dogs ad
       JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) AS dogs,
      ROUND(a.agreed_total * 100) AS total_cents,
      ${deposited} AS deposit_cents,
      ${quotePending} AS quote_pending
    FROM appointments a JOIN customers c ON c.id=a.customer_id
    WHERE a.status='pending' AND a.stay_id IS NULL AND a.id>?
      AND (?='' OR instr(lower(a.booking_number),?)>0 OR instr(lower(c.name),?)>0
        OR EXISTS (SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
                   WHERE ad.appointment_id=a.id AND instr(lower(d.name),?)>0))
    ORDER BY a.id LIMIT 26
  `).bind(after, search, search, search, search).all();
  const bookings = await addPassBadges(db,results.slice(0, 25));
  return {bookings, forecast:await bookingForecast(db), nextAfter: results.length > bookings.length ? bookings.at(-1).id : null};
}

export async function bookingDetails(db, id) {
  const [details, dogs, payments] = await db.batch([
    db.prepare(`SELECT a.id,a.customer_id,a.cloud_revision,a.booking_number,a.checkin,a.checkout,a.charged_nights,a.service_type,
      a.status,a.stay_id,a.note,a.discount_cents,a.rounding_cents,c.name AS customer,
      COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id,' /'),''),c.contact) AS contact,
      ROUND(COALESCE(s.agreed_total,a.agreed_total)*100) AS total_cents
      FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN stays s ON s.id=a.stay_id
      WHERE a.id=? AND a.status!='cancelled'`).bind(id),
    db.prepare(`SELECT d.id,d.name,ad.nightly_rate_cents
      FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
      WHERE ad.appointment_id=? ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT t.id,t.payment_key,t.occurred_on,t.received_time,t.payment_type,ROUND(t.amount*100) AS amount_cents
      FROM appointments a JOIN transactions t
        ON (a.stay_id IS NOT NULL AND t.stay_id=a.stay_id)
        OR (a.stay_id IS NULL AND t.deposit_appointment_id=a.id)
      WHERE a.id=? AND t.payment_type!=''
      ORDER BY t.occurred_on,t.received_time,t.id`).bind(id),
  ]);
  const booking = details.results[0];
  if (!booking) return null;
  const quotePending = !dogs.results.length || dogs.results.some((dog) => dog.nightly_rate_cents === null);
  const pricing=await savedBoardingPrice(db,booking.stay_id ? "stay" : "booking",booking.stay_id || id);
  const paidCents = payments.results.reduce((sum, payment) => sum + payment.amount_cents, 0)+(booking.stay_id?pricing?.stay_pass?.precheckin_cash_adjustment_cents||0:pricing?.booking_cash_adjustment_cents||0);
  const cashHistory=booking.stay_id?pricing?.stay_pass?.precheckin_cash_history||[]:pricing?.booking_cash_adjustment_cents?(await bookingCashRefunds(db,id)).history:[];
  return {
    ...booking, refunds:cashHistory.map(row=>({date:row.occurred_on,received_time:row.received_time,amount:row.amount_cents/100,note:''})),pricing, dogs: dogs.results, payments: payments.results, paid_cents: paidCents,
    balance_cents: quotePending ? null : Math.max(0, booking.total_cents - paidCents),
  };
}

export async function receiveBookingDeposit(db, bookingId, payment, actor) {
  const normalized = normalizePayment(payment);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || !normalized) return "invalid";
  const {amountCents, paymentDate, key, paidAt} = normalized;
  const recorded = `EXISTS (SELECT 1 FROM transactions t
    WHERE t.deposit_appointment_id=a.id AND t.payment_key=?)
    OR EXISTS (SELECT 1 FROM booking_deposit_deletions d
      WHERE d.appointment_id=a.id AND d.payment_key=?)`;
  const pending = "a.status='pending' AND a.stay_id IS NULL";
  const [insert, lookup] = await db.batch([
    db.prepare(`INSERT INTO transactions
      (occurred_on,kind,category,description,amount,customer_id,deposit_appointment_id,payment_type,payment_key,received_time)
      SELECT ?,'income','ค่าฝากเลี้ยง','มัดจำ',?/100.0,a.customer_id,a.id,'deposit',?,?
      FROM appointments a
      WHERE a.id=? AND ${authorizedStaff} AND ${pending}
        AND NOT (${recorded})
        AND (${quotePending} OR ${deposited}+? <= ROUND(a.agreed_total*100))`)
      .bind(paymentDate, amountCents, key, paidAt, bookingId, actor.id, actor.email, key, key, amountCents),
    db.prepare(`SELECT (${recorded}) AS recorded, (${authorizedStaff}) AS authorized,
      (${pending}) AS pending FROM appointments a WHERE a.id=?`)
      .bind(key, key, actor.id, actor.email, bookingId),
  ]);
  if (insert.meta.changes === 1) return "saved";
  const booking = lookup.results[0];
  if (!booking) return "not_found";
  if (!booking.authorized) return "forbidden";
  if (booking.recorded) return "duplicate";
  return booking.pending ? "balance_exceeded" : "booking_closed";
}

export async function deleteBookingDeposit(db, bookingId, transactionId, {key}, actor) {
  if (![bookingId, transactionId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      typeof key !== "string" || !key || key.length > 128) return "invalid";
  const match = `t.id=? AND t.deposit_appointment_id=? AND t.payment_key=?
    AND t.payment_type='deposit' AND t.stay_id IS NULL`;
  const identity = [actor.id, actor.email];
  const identifiers = [transactionId, bookingId, key];
  const [archive, , lookup] = await db.batch([
    db.prepare(`INSERT INTO booking_deposit_deletions
      (appointment_id,transaction_id,payment_key,amount,occurred_on,received_time,deleted_at,deleted_by)
      SELECT t.deposit_appointment_id,t.id,t.payment_key,t.amount,t.occurred_on,t.received_time,?,?
      FROM transactions t JOIN appointments a ON a.id=t.deposit_appointment_id
      WHERE ${match} AND a.stay_id IS NULL AND ${authorizedStaff}
      ON CONFLICT (appointment_id,payment_key) DO NOTHING`)
      .bind(new Date().toISOString(), actor.id, ...identifiers, ...identity),
    db.prepare(`DELETE FROM transactions AS t WHERE ${match} AND ${authorizedStaff}
      AND EXISTS (SELECT 1 FROM booking_deposit_deletions d
        WHERE d.appointment_id=t.deposit_appointment_id AND d.payment_key=t.payment_key
          AND d.transaction_id=t.id)
      AND EXISTS (SELECT 1 FROM appointments a WHERE a.id=t.deposit_appointment_id AND a.stay_id IS NULL)`)
      .bind(...identifiers, ...identity),
    db.prepare(`SELECT (${authorizedStaff}) AS authorized,
      a.stay_id IS NOT NULL AS checked_in,
      EXISTS(SELECT 1 FROM booking_deposit_deletions d
        WHERE d.transaction_id=? AND d.appointment_id=? AND d.payment_key=?) AS deleted
      FROM appointments a WHERE a.id=?`).bind(...identity, ...identifiers, bookingId),
  ]);
  const booking = lookup.results[0];
  if (!booking) return "not_found";
  if (!booking.authorized) return "forbidden";
  if (archive.meta.changes === 1 || booking.deleted) return "deleted";
  return booking.checked_in ? "booking_closed" : "not_found";
}

export function randomReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(6))].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value;
}

export async function bookingCalendar(db, start, end) {
  if (!validDay(start) || !validDay(end) || end < start || Date.parse(end)-Date.parse(start) > 41*86400000) {
    return null;
  }
  const [bookings,holidays] = await db.batch([
    db.prepare(`SELECT a.id,a.checkin,a.checkout,a.booking_number,a.stay_id,c.name AS customer,
      (SELECT group_concat(d.name, ', ') FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
        WHERE ad.appointment_id=a.id) AS dogs
      FROM appointments a JOIN customers c ON c.id=a.customer_id
      WHERE a.status='pending' AND a.checkin<=? AND a.checkout>=?
      ORDER BY a.checkin,a.id`).bind(end,start),
    db.prepare(`SELECT id,name,starts_on,ends_on FROM shop_holidays
      WHERE starts_on<=? AND ends_on>=? ORDER BY starts_on,id`).bind(end,start),
  ]);
  return {bookings:await addPassBadges(db,bookings.results),holidays:holidays.results,forecast:await bookingForecast(db)};
}
