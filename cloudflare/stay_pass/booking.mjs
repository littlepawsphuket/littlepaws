import {daycareTiming} from './daycare.mjs';
import {allocatableLots,allocateBookingLots} from './lot_allocation.mjs';
// Read-only booking integration. Existing booking dates, manual quantity and prices are preserved.
import {passBookingState} from './booking_state.mjs';
import {bookingSettlement} from './settlement.mjs';
export {cashTopupCents} from './settlement.mjs';
import {bookingWarnings,snapshotParams} from '../booking_warnings.mjs';
import {overnightPricing,savedBoardingPrice} from '../boarding_pricing.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {balances,applyCreditOperation} from './credits.mjs';
import {fail,stamp,releaseGates} from './rules.mjs';
export function bookingCreditUnits(service,quantity,dogCount){
 if(!['overnight','daycare'].includes(service)||!Number.isSafeInteger(quantity)||quantity<1||quantity>36600||!Number.isSafeInteger(dogCount)||dogCount<1||dogCount>30)fail('invalid_pass_booking');
 return quantity*dogCount*(service==='overnight'?4:2);
}
export async function quotePassBooking(db,{passId,bookingId,allocations,convert=false},actor,now=new Date()){
 if(typeof passId!=='string'||!Number.isSafeInteger(bookingId)||bookingId<1)fail('invalid_pass_booking');
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(convert&&await db.prepare('SELECT 1 FROM stay_pass_booking_links WHERE booking_id=?').bind(bookingId).first())fail('booking_already_converted');
 const [access,passRows,bookingRows,petRows,payments,financial]=await db.batch([
  db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)),
  db.prepare('SELECT p.* FROM stay_passes p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.archived=0').bind(passId),
  db.prepare('SELECT id,customer_id,status,stay_id,checkin,checkout,charged_nights,service_type,discount_cents,ROUND(agreed_total*100) AS original_total_cents,cloud_revision FROM appointments WHERE id=?').bind(bookingId),
  db.prepare(`SELECT d.id,d.name,d.size,d.customer_id,d.archived,ad.nightly_rate_cents,pp.pass_id AS registered_pass FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id LEFT JOIN stay_pass_pets pp ON pp.pass_id=? AND pp.dog_id=d.id WHERE ad.appointment_id=? ORDER BY d.id`).bind(passId,bookingId),
  db.prepare("SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN kind='income' AND payment_type='deposit' THEN ROUND(amount*100) ELSE 0 END),0) AS deposit_cents,SUM(CASE WHEN kind!='income' OR payment_type!='deposit' THEN 1 ELSE 0 END) AS review_count FROM transactions WHERE deposit_appointment_id=? AND payment_type!=''").bind(bookingId),
  db.prepare(passBookingState).bind(bookingId)
 ]);
 if(!access.results.length)fail('forbidden');
 const pass=passRows.results[0],booking=bookingRows.results[0],pets=petRows.results;if(!pass||!booking)fail('not_found');
 if(booking.customer_id!==pass.customer_id||!pets.length||pets.some(d=>d.customer_id!==pass.customer_id||d.archived||d.size!==pass.size||d.registered_pass!==pass.id))fail('ineligible_pet');
 if(booking.status!=='pending'||booking.stay_id!==null)fail('booking_not_pending');
 let required=bookingCreditUnits(booking.service_type,booking.charged_nights,pets.length);
 const credit=await balances(db,passId),timing=await savedBoardingPrice(db,'booking',bookingId),warnings=await bookingWarnings(db,bookingId,booking.checkin,booking.checkout,pets.map(d=>d.id));
 const blockers=['booking_release_not_approved'];
 if(pass.status!=='active')blockers.push('pass_not_active');
 if(pass.expires_at<=now.toISOString())blockers.push('pass_expired');
 if(booking.discount_cents>0)blockers.push('promotion_cannot_combine');
 if(payments.results[0].n>0&&(!convert||payments.results[0].review_count))blockers.push('existing_payment_review_required');
 if(booking.service_type==='daycare'&&booking.charged_nights!==1)blockers.push('daycare_single_visit_required');
 if(warnings.warnings.length)blockers.push('booking_warning_review_required');

 let checkinAt=null,checkoutAt=null,late=null,daycare=null;
 if(!timing?.checkin_time||!timing?.checkout_time)blockers.push('booking_times_required');
 else{
  checkinAt=stamp(booking.checkin+'T'+timing.checkin_time+':00+07:00');checkoutAt=stamp(booking.checkout+'T'+timing.checkout_time+':00+07:00');
  if(checkoutAt<checkinAt)fail('invalid_pass_booking');
  if(checkinAt<pass.purchase_at)blockers.push('arrival_before_pass_purchase');
  if(checkoutAt>=pass.expires_at)blockers.push('stay_crosses_expiry');
  const calculation=overnightPricing({pricingVersion:1,service:booking.service_type,checkin:booking.checkin,checkout:booking.checkout,checkinTime:timing.checkin_time,checkoutTime:timing.checkout_time,quantity100:booking.charged_nights*100,dogs:pets.map(d=>({id:d.id,rate:0}))});
  if(!calculation)fail('invalid_pass_booking');
  if(booking.service_type==='daycare'){daycare=daycareTiming(checkinAt,checkoutAt);required=daycare.units_per_dog*pets.length;}
  late={extra_minutes:calculation.extra_minutes,percent:calculation.percent,cash_only:false,credit_units:calculation.percent/25*pets.length};
 }
 const eligibleLots=allocatableLots(credit.lots,now.toISOString(),checkoutAt),available=eligibleLots.reduce((n,l)=>n+l.available_units,0);
 const settlement=bookingSettlement({baseUnits:required,latePercent:late?.percent||0,dogs:pets,availableUnits:available,service:booking.service_type,allocations});
 blockers.push(...settlement.blockers);
 if(settlement.cash_units)blockers.push('mixed_payment_integration_required');
 const deposit=payments.results[0],depositValid=Number.isSafeInteger(deposit.deposit_cents)&&deposit.deposit_cents>=0&&!deposit.review_count;
 const payment_preview={existing_deposit_cents:depositValid?deposit.deposit_cents:null,cash_due_cents:depositValid&&settlement.cash_cents!==null?Math.max(0,settlement.cash_cents-deposit.deposit_cents):null,
  deposit_excess_cents:depositValid&&settlement.cash_cents!==null?Math.max(0,deposit.deposit_cents-settlement.cash_cents):null};
 if(payment_preview.deposit_excess_cents>0)blockers.push('deposit_excess_review_required');
 const quote={pass_id:pass.id,pass_number:pass.pass_number,pass_revision:pass.revision,booking_id:booking.id,booking_revision:booking.cloud_revision,original_total_cents:booking.original_total_cents,customer_id:pass.customer_id,pets:pets.map(d=>({id:d.id,name:d.name})),service:booking.service_type,declared_quantity:booking.charged_nights,checkin_day:booking.checkin,checkout_day:booking.checkout,checkin_at:checkinAt,checkout_at:checkoutAt,
  credit_units:settlement.total_units,settlement,credit_allocation:settlement.covered_units>0&&!settlement.blockers.length?allocateBookingLots(eligibleLots,settlement.rows,bookingId):[],payment_preview,remaining_units:credit.remaining_units,reserved_units:credit.reserved_units,available_units:available,available_after_units:settlement.available_after_units,
  late_checkout:late,...(daycare?{daycare}:{}),health_review_required:true,warning_codes:warnings.warnings,capacity_snapshot:warnings.snapshot,financial_snapshot:financial.results[0]?.state};
 return {status:'preview_only',can_reserve:false,...quote,quote_hash:await digest(quote),blockers,release_gates:releaseGates};
}

// Internal-only hold for a confirmed existing booking. Never reprices legacy cash or booking rows.
export async function reservePassBooking(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(!input||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_pass_booking');
 const intentHash=await digest(input),requestKey=actor.id+':credit:'+input.key;
 const prior=await db.prepare(`SELECT o.result,json_extract(a.before_data,'$.booking_intent_hash') AS intent_hash FROM stay_pass_operations o JOIN stay_pass_audit_logs a ON a.operation_id=o.id
  WHERE o.actor_id=? AND o.request_key=? AND ${adminGuard}`).bind(actor.id,requestKey,...actorArgs(actor)).first();
 if(prior){if(prior.intent_hash!==intentHash)fail('idempotency_conflict');return {...JSON.parse(prior.result),replayed:true};}
 const quote=await quotePassBooking(db,input,actor,now);
 if(quote.quote_hash!==input.quoteHash)fail('booking_confirmation_required');
 const blockers=quote.blockers.filter(b=>!['booking_release_not_approved','mixed_payment_integration_required'].includes(b));if(blockers.length)fail(blockers[0]);
 if(quote.settlement.covered_units===0)fail('no_credit_coverage');
 return applyCreditOperation(db,{passId:input.passId,kind:'reservation_hold',expectedRevision:quote.pass_revision,key:input.key,reason:input.reason,intentHash,
  settlementSnapshot:quote,convertBooking:input.convert===true,checkoutAt:quote.checkout_at,bookingGuard:{bookingId:input.bookingId,revision:quote.booking_revision,snapshot:quote.capacity_snapshot,financialSnapshot:quote.financial_snapshot,params:snapshotParams(input.bookingId,quote.checkin_day,quote.checkout_day)},
  lines:quote.credit_allocation},actor,now);
}

// Staff-only picker for existing, unconverted bookings; never returns customer contact details.
export async function convertPassBooking(db,input,actor,now=new Date()){return reservePassBooking(db,{...input,convert:true},actor,now);}
export async function passBookingOptions(db,{search=''},actor,now=new Date()){
 if(typeof search!=='string'||search.length>100||!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('invalid_pass_booking');
 const access=await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first();if(!access)fail('forbidden');
 const rows=await db.prepare(`SELECT a.id,a.booking_number,c.name AS customer,a.checkin,a.checkout,
  (SELECT group_concat(d.name,', ') FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) AS pets
  FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE a.status='pending' AND a.stay_id IS NULL AND c.archived=0 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links l WHERE l.booking_id=a.id)
  AND (?='' OR instr(lower(COALESCE(a.booking_number,'')),lower(?))>0 OR instr(lower(c.name),lower(?))>0
   OR EXISTS(SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id AND instr(lower(d.name),lower(?))>0))
  ORDER BY a.checkin,a.id LIMIT 50`).bind(search,search,search,search).all();
 return {bookings:rows.results};
}
export async function passOptionsForBooking(db,bookingId,actor,now=new Date()){
 if(!Number.isSafeInteger(bookingId)||bookingId<1||!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('invalid_pass_booking');
 const access=await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first();if(!access)fail('forbidden');
 const rows=await db.prepare(`SELECT p.id,p.pass_number,p.expires_at FROM stay_passes p JOIN customers c ON c.id=p.customer_id
  JOIN appointments a ON a.customer_id=p.customer_id WHERE a.id=? AND a.status='pending' AND a.stay_id IS NULL AND c.archived=0 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links l WHERE l.booking_id=a.id)
  AND p.status='active' AND p.purchase_at<=? AND p.expires_at>? AND EXISTS(SELECT 1 FROM appointment_dogs WHERE appointment_id=a.id)
  AND NOT EXISTS(SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id LEFT JOIN stay_pass_pets pp ON pp.dog_id=d.id AND pp.pass_id=p.id
   WHERE ad.appointment_id=a.id AND (pp.pass_id IS NULL OR d.archived!=0 OR d.customer_id!=p.customer_id OR d.size!=p.size))
  ORDER BY p.expires_at,p.id LIMIT 50`).bind(bookingId,now.toISOString(),now.toISOString()).all();
 const passes=[];for(const p of rows.results){const b=await balances(db,p.id);passes.push({...p,remaining_units:b.remaining_units,reserved_units:b.reserved_units,available_units:b.available_units});}
 return {passes};
}
