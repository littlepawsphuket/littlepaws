import {stayBalance} from "./stay_payments.mjs";

export async function staySummary(db, id) {
  const [record,dogs,payments,consent] = await db.batch([
    db.prepare(`SELECT s.id,s.stay_number,s.status,s.checkin,s.checkout,s.actual_checkin_at,s.actual_checkout_at,
        s.charged_nights,
        CASE WHEN json_valid(s.intake) THEN COALESCE(json_extract(s.intake,'$.service_type'),'overnight')
          ELSE 'overnight' END AS service_type,s.intake,
        ROUND(s.agreed_total*100) AS total_cents,s.discount_cents,s.payment_tracking,
        CASE WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE NULL END AS due_cents,
        c.name AS customer,b.id AS booking_id,b.booking_number
      FROM stays s JOIN customers c ON c.id=s.customer_id LEFT JOIN appointments b ON b.stay_id=s.id
      WHERE s.id=?`).bind(id),
    db.prepare(`SELECT d.name,sd.nightly_rate_cents FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
      WHERE sd.stay_id=? ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT occurred_on,received_time,payment_type,ROUND(amount*100) AS amount_cents FROM transactions
      WHERE stay_id=? AND payment_type!='' ORDER BY occurred_on,received_time,id`).bind(id),
    db.prepare(`SELECT customer_name,signed_at,signed_language,signature FROM stay_consents
      WHERE stay_id=? ORDER BY id DESC LIMIT 1`).bind(id),
  ]);
  const stay = record.results[0];
  if (!stay) return null;
  try { stay.intake = JSON.parse(stay.intake) || {}; } catch { stay.intake = {}; }
  return {...stay, dogs:dogs.results, payments:payments.results, consent:consent.results[0] || null};
}
