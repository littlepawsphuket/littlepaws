import {savedBoardingPrice,freezeLegacyPrice} from "./boarding_pricing.mjs";
import {bookingValues} from './booking_writes.mjs';
import {bookingWarnings,bookingSnapshot} from './booking_warnings.mjs';
import {authorizedStaff} from './stay_payments.mjs';
import {normalizeIntake} from './check_in.mjs';
import {quoteCoupon,unchangedCoupon,couponCondition} from './coupons.mjs';
import {intakeGroups} from './stay_terms.mjs';

export const stayPaymentSnapshot=`SELECT json_group_array(json_array(id,amount,payment_type)) FROM
  (SELECT id,amount,payment_type FROM transactions WHERE stay_id=s.id ORDER BY id)`;

export async function editStay(db,id,form,actor) {
  const source=await db.prepare(`SELECT s.*,ROUND(agreed_total*100) AS total,
    (${stayPaymentSnapshot}) AS payment_snapshot,
    COALESCE((SELECT SUM(ROUND(t.amount*100)) FROM transactions t WHERE t.stay_id=s.id AND t.payment_type!=''),0) AS paid,
    (SELECT u.discount_cents FROM coupon_uses u WHERE u.stay_id=s.id) AS coupon_discount,
    (SELECT c.code FROM coupon_uses u JOIN coupons c ON c.id=u.coupon_id WHERE u.stay_id=s.id) AS coupon_code
    FROM stays s WHERE s.id=? AND ${authorizedStaff}`).bind(id,actor.id,actor.email).first();
  if(!source)return {status:'not_found'};
  const previousPrice=await savedBoardingPrice(db,'stay',id);
  const legacyPrice=form.pricingVersion===1 && (!previousPrice || previousPrice.grandfathered);
  const data=bookingValues(form,legacyPrice ? source : null),intake=normalizeIntake(form.intake);
  if(!data || data.quotePending || !intake || (form.revision!==null &&
      (typeof form.revision!=='string' || !/^[a-f0-9-]{36}$/.test(form.revision))) ||
      typeof form.paymentSnapshot!=='string' || form.paymentSnapshot.length>20000 ||
      typeof form.couponCode!=='string' || (form.couponCode && !/^\d{6}$/.test(form.couponCode))) return {status:'invalid'};
  if(!data.pricing && previousPrice)return {status:'conflict'};
  if(source.status!=='checked_in' || source.cancelled_at)return {status:'stay_closed'};
  if(source.cloud_revision!==form.revision || source.payment_snapshot!==form.paymentSnapshot ||
      source.customer_id!==form.customerId)return {status:'conflict'};
  let coupon=null,discount=0;
  const unchanged=source.coupon_code===form.couponCode;
  if(form.couponCode){
    if(unchanged)discount=source.coupon_discount;
    else{
      const quote=await quoteCoupon(db,form.couponCode,data.subtotal,form.discountCents,source.paid);
      if(quote.status)return quote;
      coupon=quote.coupon;discount=quote.discount;
    }
  }
  const totalDiscount=legacyPrice ? source.discount_cents : form.discountCents+discount;
  if(totalDiscount>data.subtotal)return {status:'invalid'};
  const raw=data.subtotal-totalDiscount;
  const net=legacyPrice ? source.total : source.total+source.rounding_cents===raw && source.discount_cents===totalDiscount ? source.total : raw-raw%100;
  if(source.paid>net)return {status:'payment_exceeds'};
  const warnings=await bookingWarnings(db,null,form.checkin,form.checkout,data.dogIds,id);
  if(warnings.token && form.warningToken!==warnings.token)return {status:'warning',warnings:warnings.warnings,token:warnings.token};
  const revision=crypto.randomUUID(),stamp=new Date().toISOString();
  let previousIntake={};try{previousIntake=JSON.parse(source.intake)||{};}catch{}
  for(const group of intakeGroups)for(const [field] of group.fields){delete previousIntake[field];delete previousIntake[field+'_packed'];}
  const savedIntake=JSON.stringify({...previousIntake,...intake,service_type:form.service,...(data.pricing ? {arrival_time:data.pricing.checkin_time,pickup_time:data.pricing.checkout_time} : {})});
  const owned=`(SELECT COUNT(*) FROM dogs d JOIN json_each(?) choices ON d.id=choices.value
    WHERE d.customer_id=? AND (d.archived=0 OR EXISTS(SELECT 1 FROM stay_dogs sd WHERE sd.stay_id=? AND sd.dog_id=d.id)))=?`;
  const marker=`EXISTS(SELECT 1 FROM stays WHERE id=? AND cloud_revision=?)`;
  const statements=[db.prepare(`UPDATE stays AS s SET checkin=?,checkout=?,charged_nights=?,agreed_total=?,note=?,
    discount_cents=?,rounding_cents=?,intake=?,cloud_revision=?
    WHERE id=? AND status='checked_in' AND cancelled_at IS NULL AND cloud_revision IS ?
      AND customer_id=? AND (${stayPaymentSnapshot})=? AND ${owned} AND ${authorizedStaff}
      AND (${bookingSnapshot})=? AND ${unchangedCoupon}
      AND (SELECT COALESCE(SUM(discount_cents),0) FROM coupon_uses WHERE stay_id=s.id)=?`)
    .bind(form.checkin,form.checkout,form.quantity100/100,net/100,form.note,totalDiscount,raw-net,savedIntake,revision,
      id,form.revision,form.customerId,form.paymentSnapshot,JSON.stringify(data.dogIds),form.customerId,id,data.dogIds.length,
      actor.id,actor.email,...warnings.params,warnings.snapshot,...couponCondition(coupon),source.coupon_discount ?? 0),
    db.prepare(`DELETE FROM care_share_links WHERE stay_id=? AND ${marker} AND dog_id NOT IN(SELECT value FROM json_each(?))`)
      .bind(id,id,revision,JSON.stringify(data.dogIds)),
    db.prepare(`DELETE FROM stay_dogs WHERE stay_id=? AND ${marker}`).bind(id,id,revision),
    db.prepare(`INSERT INTO stay_dogs(stay_id,dog_id,nightly_rate_cents)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.rate') FROM json_each(?) WHERE ${marker}`)
      .bind(id,data.dogRows,id,revision),
    db.prepare(`UPDATE transactions SET amount=? WHERE stay_id=? AND auto_stay=1 AND ?=0 AND ${marker}`)
      .bind(net/100,id,source.payment_tracking,id,revision),
    db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,auto_stay)
      SELECT date('now','+7 hours'),'income','ค่าฝากเลี้ยง','ค่าฝากเลี้ยง #'||s.id,?,s.customer_id,s.id,'',1
      FROM stays s WHERE s.id=? AND s.cloud_revision=? AND s.payment_tracking=0
        AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.stay_id=s.id AND t.kind='income')`)
      .bind(net/100,id,revision),
  ];
  if(data.pricing)statements.push(db.prepare(`INSERT INTO boarding_charges(stay_id,details)
    SELECT id,? FROM stays WHERE id=? AND cloud_revision=?
    ON CONFLICT(stay_id) DO UPDATE SET details=excluded.details`).bind(JSON.stringify({...data.pricing,...(previousPrice?.extensions ? {extensions:previousPrice.extensions} : {})}),id,revision));
  if(!unchanged){
    statements.push(db.prepare(`DELETE FROM coupon_uses WHERE stay_id=? AND ${marker}`).bind(id,id,revision));
    if(coupon)statements.push(db.prepare(`INSERT INTO coupon_uses(stay_id,coupon_id,discount_cents,used_at)
      SELECT ?,?,?,? WHERE ${marker}`).bind(id,coupon.id,discount,stamp,id,revision));
  }
  const [changed]=await db.batch(statements);
  return changed.meta.changes===1 ? {status:'saved',id} : {status:'conflict'};
}
