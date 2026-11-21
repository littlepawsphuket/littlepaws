import {savedBoardingPrice} from "./boarding_pricing.mjs";
import {refundableBalance,stayBalance} from "./stay_payments.mjs";
import {stayPaymentSnapshot} from './stay_edits.mjs';

export async function staySummary(db, id) {
  const [record,dogs,payments,consent,links,deletions,refunds] = await db.batch([
    db.prepare(`SELECT s.id,s.customer_id,s.cloud_revision,(${stayPaymentSnapshot}) AS payment_snapshot,s.stay_number,s.status,s.checkin,s.checkout,s.actual_checkin_at,s.actual_checkout_at,
        s.charged_nights,s.note,s.cancelled_at,s.cancel_reason,
        CASE WHEN json_valid(s.intake) THEN COALESCE(json_extract(s.intake,'$.service_type'),'overnight')
          ELSE 'overnight' END AS service_type,s.intake,
        ROUND(s.agreed_total*100) AS total_cents,s.discount_cents,s.payment_tracking,
        CASE WHEN s.cancelled_at IS NOT NULL OR s.status='cancelled' THEN 0
          WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE NULL END AS due_cents,
        CASE WHEN s.cancelled_at IS NOT NULL THEN ${refundableBalance} ELSE 0 END AS refundable_cents,
        c.name AS customer,b.id AS booking_id,b.booking_number,
        coupon.code AS coupon_code,used.discount_cents AS coupon_discount_cents
      FROM stays s JOIN customers c ON c.id=s.customer_id LEFT JOIN appointments b ON b.stay_id=s.id
      LEFT JOIN coupon_uses used ON used.stay_id=s.id LEFT JOIN coupons coupon ON coupon.id=used.coupon_id
      WHERE s.id=?`).bind(id),
    db.prepare(`SELECT d.id,d.name,sd.nightly_rate_cents FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
      WHERE sd.stay_id=? ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT id,payment_key,occurred_on,received_time,payment_type,ROUND(amount*100) AS amount_cents FROM transactions
      WHERE stay_id=? AND payment_type!='' ORDER BY occurred_on,received_time,id`).bind(id),
    db.prepare(`SELECT customer_name,signed_at,signed_language,signature FROM stay_consents
      WHERE stay_id=? ORDER BY id DESC LIMIT 1`).bind(id),
    db.prepare(`SELECT d.name AS dog_name,l.view_count FROM care_share_links l
      JOIN stay_dogs sd ON sd.stay_id=l.stay_id AND sd.dog_id=l.dog_id JOIN dogs d ON d.id=l.dog_id
      WHERE l.stay_id=? ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT occurred_on,received_time,payment_type,ROUND(amount*100) AS amount_cents,deleted_at,reason
      FROM stay_payment_deletions WHERE stay_id=? ORDER BY id DESC`).bind(id),
    db.prepare(`SELECT occurred_on AS date,received_time,amount,note FROM transactions
      WHERE stay_id=? AND kind='refund' ORDER BY occurred_on,received_time,id`).bind(id),
  ]);
  const stay = record.results[0];
  if (!stay) return null;
  try { stay.intake = JSON.parse(stay.intake) || {}; } catch { stay.intake = {}; }
  return {...stay,pricing:await savedBoardingPrice(db,"stay",id),dogs:dogs.results,payments:payments.results,payment_deletions:deletions.results,refunds:refunds.results,
    consent:consent.results[0] || null,timeline_views:links.results};
}
