import {bookingCashRefunds} from './precheckin_cash.mjs';
import {bookingAmendment} from './effective_booking.mjs';
// Gated development orchestration. Existing consent/payment validation is reused.
import {checkInValues,consentInsert,paymentInsert} from '../check_in.mjs';
import {randomReference} from '../bookings.mjs';
import {saveStayPrice} from '../boarding_pricing.mjs';
import {bookingWarnings,bookingSnapshot,snapshotParams} from '../booking_warnings.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {passBookingState} from './booking_state.mjs';
import {fail} from './rules.mjs';
export async function linkedPassBooking(db,bookingId,actor){
 if(!Number.isSafeInteger(bookingId)||bookingId<1||!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 const access=await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first();if(!access)fail('forbidden');
 const row=await db.prepare(`SELECT l.*,s.snapshot,p.pass_number FROM stay_pass_booking_links l JOIN stay_pass_booking_settlements s ON s.id=l.hold_operation_id JOIN stay_passes p ON p.id=l.pass_id WHERE l.booking_id=?`).bind(bookingId).first();
 if(!row)return null;const amendment=await bookingAmendment(db,bookingId);const snapshot=JSON.parse(amendment?.remaining_snapshot||row.snapshot);return {...row,cash_cents:snapshot.booking_cash_total_cents??row.cash_cents,converted_revision:amendment?.next_revision||row.converted_revision,snapshot};
}
export async function quotePassCheckin(db,bookingId,actor,now=new Date()){
 const link=await linkedPassBooking(db,bookingId,actor);if(!link)fail('not_found');
 const [booking,pass,allocation,pets,payments,state]=await db.batch([
  db.prepare('SELECT * FROM appointments WHERE id=?').bind(bookingId),db.prepare('SELECT p.* FROM stay_passes p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.archived=0').bind(link.pass_id),
  db.prepare('SELECT * FROM stay_pass_booking_allocations WHERE booking_id=? AND pass_id=? ORDER BY dog_id,lot_id').bind(bookingId,link.pass_id),
  db.prepare(`SELECT d.id,d.customer_id,d.size,d.archived,pp.pass_id FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id LEFT JOIN stay_pass_pets pp ON pp.dog_id=d.id AND pp.pass_id=? WHERE ad.appointment_id=? ORDER BY d.id`).bind(link.pass_id,bookingId),
  db.prepare(`SELECT id,kind,payment_type,ROUND(amount*100) cents FROM transactions WHERE deposit_appointment_id=? AND payment_type!='' ORDER BY id`).bind(bookingId),
  db.prepare(passBookingState).bind(bookingId)
 ]);
 const a=booking.results[0],p=pass.results[0],frozen=link.snapshot;
 if(a?.stay_id)return {status:'already_checked_in',stayId:a.stay_id};
 if(!a||a.status!=='pending'||!p||!['active','fully_used'].includes(p.status)||p.expires_at<=now.toISOString())fail('pass_not_active');
 if(Math.round(a.agreed_total*100)!==link.cash_cents||a.discount_cents!==0||a.cloud_revision!==link.converted_revision)fail('booking_confirmation_required');
 if(pets.results.length!==frozen.pets.length||pets.results.some(d=>d.customer_id!==p.customer_id||d.size!==p.size||d.archived||d.pass_id!==p.id))fail('ineligible_pet');
 const allocations=allocation.results.filter(r=>r.reserved_units>0);
 if(allocations.reduce((n,r)=>n+r.reserved_units,0)!==frozen.settlement.covered_units||allocation.results.some(r=>r.consumed_units!==0))fail('ledger_mismatch');
 if(frozen.settlement.rows.some(r=>r.covered_units!==allocations.filter(a=>a.dog_id===r.dog_id).reduce((n,a)=>n+a.reserved_units,0)))fail('ledger_mismatch');
 if(payments.results.some(t=>t.kind!=='income'||t.payment_type!=='deposit'||!Number.isSafeInteger(t.cents)||t.cents<0))fail('existing_payment_review_required');
 const refunded=await bookingCashRefunds(db,bookingId);const deposit=payments.results.reduce((n,t)=>n+t.cents,0)-refunded.refunded_cents;if(!Number.isSafeInteger(deposit)||deposit<0||deposit>link.cash_cents)fail('deposit_excess_review_required');
 const warning=await bookingWarnings(db,bookingId,a.checkin,a.checkout,pets.results.map(d=>d.id));if(warning.warnings.length)fail('booking_warning_review_required');
 const q={booking_id:bookingId,pass_id:p.id,pass_number:p.pass_number,pass_revision:p.revision,booking_revision:a.cloud_revision,
  customer_id:a.customer_id,checkin:a.checkin,checkout:a.checkout,charged_nights:a.charged_nights,service:a.service_type,
  checkin_at:frozen.checkin_at,checkout_at:frozen.checkout_at,original_total_cents:link.original_total_cents,cash_cents:link.cash_cents,
  precheckin_cash:refunded,deposit_cents:deposit,balance_cents:link.cash_cents-deposit,credit_units:frozen.settlement.covered_units,allocations,
  ...(frozen.daycare?{daycare:frozen.daycare}:{}),cancellation_cash_fees_cents:frozen.cancellation_cash_fees_cents??0,settlement:frozen.settlement,financial_snapshot:state.results[0].state,capacity_snapshot:warning.snapshot};
 return {status:'ready',...q,quote_hash:await digest(q)};
}
export async function checkInPassBooking(db,bookingId,form,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 const access=await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first();if(!access)fail('forbidden');
 const values=checkInValues(form,now);if(values.status)return values;
 if(form.couponCode||form.draft||!/^[a-f0-9]{64}$/.test(form.passQuoteHash||''))return {status:'invalid'};
 const hash=await digest({bookingId,form}),requestKey=actor.id+':pass-checkin:'+form.key;
 async function prior(){const row=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,requestKey).first();if(!row)return null;if(row.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(row.result),replayed:true};}
 const previous=await prior();if(previous)return previous;
 const q=await quotePassCheckin(db,bookingId,actor,now);if(q.status==='already_checked_in')return q;
 if(form.passQuoteHash!==q.quote_hash||form.revision!==q.booking_revision||values.expectedBalance!==q.balance_cents)return {status:'conflict'};
 if(values.amountCents>q.balance_cents)return {status:'payment_exceeds'};
 if(values.arrival!==q.checkin_at.replace('.000Z','Z')&&new Date(values.arrival).toISOString()!==q.checkin_at)return {status:'pass_timing_review_required'};
 const pickup=new Date(q.checkout_at);const pickupTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(pickup);
 if(form.pickupDay!==q.checkout||form.pickupTime!==pickupTime||form.quantity100!==q.charged_nights*100)return {status:'pass_timing_review_required'};
 const op=crypto.randomUUID(),marker=crypto.randomUUID(),at=now.toISOString(),kind=q.service==='daycare'?'daycare_consumption':'stay_consumption';
 const lotLines=[...new Set(q.allocations.map(a=>a.lot_id))].map(lotId=>({id:crypto.randomUUID(),lot_id:lotId,units:q.allocations.filter(a=>a.lot_id===lotId).reduce((n,a)=>n+a.reserved_units,0)}));
 const lineJson=JSON.stringify(q.allocations.map(a=>({lot_id:a.lot_id,dog_id:a.dog_id,units:a.reserved_units}))),identity=actorArgs(actor);
 for(let attempt=0;attempt<5;attempt++){
  const code=randomReference();
  try{
   await db.batch([
    db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
     SELECT ?,p.id,?,?,?,?,?,'Check in confirmed Stay Pass booking',? FROM stay_passes p
     WHERE p.id=? AND p.revision=? AND p.status IN('active','fully_used') AND p.expires_at>? AND ${adminGuard}
     AND (${passBookingState})=? AND (${bookingSnapshot})=?
     AND EXISTS(SELECT 1 FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE a.id=? AND a.stay_id IS NULL AND a.status='pending' AND a.cloud_revision=? AND c.archived=0)
     AND NOT EXISTS(SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id LEFT JOIN stay_pass_pets pp ON pp.dog_id=d.id AND pp.pass_id=p.id WHERE ad.appointment_id=? AND (pp.pass_id IS NULL OR d.customer_id!=p.customer_id OR d.size!=p.size OR d.archived!=0))
     AND NOT EXISTS(SELECT 1 FROM stays WHERE stay_number=?)
     ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,requestKey,hash,q.pass_revision,kind,at,q.pass_id,q.pass_revision,at,...identity,bookingId,q.financial_snapshot,...snapshotParams(bookingId,q.checkin,q.checkout),q.capacity_snapshot,bookingId,q.booking_revision,bookingId,code),
    db.prepare(`INSERT INTO stays(customer_id,checkin,checkout,charged_nights,agreed_total,status,note,discount_cents,rounding_cents,actual_checkin_at,intake,payment_tracking,create_key,stay_number)
     SELECT a.customer_id,a.checkin,a.checkout,a.charged_nights,?/100.0,'checked_in',a.note,0,0,?,json_patch(?,json_object('service_type',a.service_type,'arrival_time',?,'pickup_time',?)),1,?,?
     FROM appointments a WHERE a.id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.cash_cents,values.arrival,JSON.stringify(values.intake),values.arrivalTime,values.pickupTime,marker,code,bookingId,op),
    db.prepare(`INSERT INTO stay_dogs(stay_id,dog_id,nightly_rate_cents) SELECT s.id,d.dog_id,d.nightly_rate_cents FROM stays s CROSS JOIN appointment_dogs d WHERE s.create_key=? AND d.appointment_id=?`).bind(marker,bookingId),
    consentInsert(db,marker,values),
    db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,booking_id,stay_id,recorded_at)
     SELECT j.value->>'id',o.id,o.pass_id,l.id,o.kind,-(j.value->>'units'),-(j.value->>'units'),0,l.remaining_units,l.remaining_units-(j.value->>'units'),l.reserved_units,l.reserved_units-(j.value->>'units'),l.refund_held_units,l.refund_held_units,?,s.id,o.created_at
     FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' AND l.pass_id=o.pass_id JOIN stays s ON s.create_key=? WHERE o.id=?`).bind(bookingId,JSON.stringify(lotLines),marker,op),
    db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at)
     SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,j.value->>'dog_id',-(j.value->>'units'),j.value->>'units',t.recorded_at FROM stay_pass_credit_transactions t CROSS JOIN json_each(?) j WHERE t.operation_id=? AND t.lot_id=j.value->>'lot_id'`).bind(lineJson,op),
    ...(q.precheckin_cash.refunded_cents?[db.prepare(`INSERT INTO stay_pass_precheckin_cash(booking_id,stay_id,operation_id,refunded_cents,snapshot,created_at) SELECT ?,s.id,o.id,?,?,o.created_at FROM stays s JOIN stay_pass_operations o ON o.id=? WHERE s.create_key=?`).bind(bookingId,q.precheckin_cash.refunded_cents,JSON.stringify(q.precheckin_cash),op,marker),db.prepare(`UPDATE transactions SET stay_id=(SELECT id FROM stays WHERE create_key=?) WHERE id IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,JSON.stringify(q.precheckin_cash.history.map(r=>r.transaction_id)),marker)]:[]),
    db.prepare(`UPDATE transactions SET stay_id=(SELECT id FROM stays WHERE create_key=?) WHERE deposit_appointment_id=? AND EXISTS(SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,bookingId,marker),
    paymentInsert(db,marker,values),
    saveStayPrice(db,marker,{version:1,service:q.service,checkin:q.checkin,checkout:q.checkout,checkin_time:values.arrivalTime,checkout_time:values.pickupTime,base_days:q.charged_nights,fee_cents:0,base_cents:q.cash_cents,percent:0,rows:[],stay_pass:{...(q.daycare?{daycare:q.daycare}:{}),precheckin_cash_adjustment_cents:-q.precheckin_cash.refunded_cents,precheckin_cash_history:q.precheckin_cash.history,pass_number:q.pass_number,credit_units:q.credit_units,cancellation_cash_fees_cents:q.cancellation_cash_fees_cents,settlement:q.settlement}}),
    // A missing operation/stay fails NOT NULL and rolls the entire D1 batch back.
    db.prepare(`INSERT INTO stay_pass_checkin_commits(booking_id,stay_id,operation_id,request_hash,created_at) VALUES(?,(SELECT id FROM stays WHERE create_key=?),(SELECT id FROM stay_pass_operations WHERE id=?),?,?)`).bind(bookingId,marker,op,hash,at),
    db.prepare(`UPDATE appointments SET stay_id=(SELECT id FROM stays WHERE create_key=?) WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(marker,bookingId,op),
    db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE WHEN COALESCE((SELECT SUM(remaining_units) FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id),0)=0 THEN 'fully_used' ELSE status END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.pass_id,op),
    db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id) SELECT ?,'pass',pass_id,'booking_checkin',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),JSON.stringify(q),JSON.stringify({amount_cents:values.amountCents,cash_due_cents:q.balance_cents,remaining_due_cents:q.balance_cents-values.amountCents}),op),
    db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','created','stayId',(SELECT id FROM stays WHERE create_key=?),'operationId',id,'revision',expected_revision+1) WHERE id=?`).bind(marker,op)
   ]);
   return {...await prior(),replayed:false};
  }catch(error){
   if(/stay_pass_checkin_mismatch|NOT NULL constraint failed: stay_pass_checkin_commits|UNIQUE constraint failed: stay_pass_checkin_commits|UNIQUE constraint failed: stays.stay_number/.test(String(error))){const replay=await prior();if(replay)return replay;const existing=await db.prepare('SELECT stay_id FROM stay_pass_checkin_commits WHERE booking_id=?').bind(bookingId).first();if(existing)return {status:'already_checked_in',stayId:existing.stay_id};const collision=await db.prepare('SELECT 1 FROM stays WHERE stay_number=?').bind(code).first();if(collision)continue;return {status:'conflict'};}
   throw error;
  }
 }
 return {status:'conflict'};
}
