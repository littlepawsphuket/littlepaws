import {partialCashEnabled} from './precheckin_cash.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail} from './rules.mjs';
import {normalizePayment} from '../stay_payments.mjs';
async function access(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
// Includes original receipts and follow-up receipts/refunds. Compare again inside the committing batch.
export const bookingCashState=`SELECT json_object('booking',json_array(a.id,a.customer_id,a.status,a.stay_id,ROUND(a.agreed_total*100),a.cloud_revision),
 'cancel',(SELECT id FROM stay_pass_booking_cancellations WHERE booking_id=a.id ORDER BY sequence DESC LIMIT 1),
 'original',(SELECT json_group_array(json_array(id,kind,amount,payment_type,customer_id,stay_id,payment_key)) FROM (SELECT * FROM transactions WHERE deposit_appointment_id=a.id ORDER BY id)),
 'cash',(SELECT json_group_array(json_array(r.id,r.direction,r.amount_cents,r.transaction_id,t.kind,t.amount,t.customer_id,t.stay_id,t.payment_key)) FROM stay_pass_booking_cash_records r JOIN transactions t ON t.id=r.transaction_id WHERE r.booking_id=a.id ORDER BY r.created_at,r.id),
 'sources',(SELECT json_group_array(json_array(x.record_id,x.transaction_id,x.amount_cents)) FROM stay_pass_booking_cash_refund_sources x JOIN stay_pass_booking_cash_records r ON r.id=x.record_id WHERE r.booking_id=a.id)) AS state FROM appointments a WHERE a.id=?`;
export function cashRefundSources(receipts,refunded,amountCents){
 let left=amountCents;const sources=[];
 for(const receipt of [...receipts].sort((a,b)=>a.id-b.id)){const used=refunded.filter(r=>r.transaction_id===receipt.id).reduce((n,r)=>n+r.amount_cents,0);if(!Number.isSafeInteger(receipt.cents)||receipt.cents<0||used>receipt.cents)fail('cash_source_review_required');const take=Math.min(left,receipt.cents-used);if(take){sources.push({transaction_id:receipt.id,amount_cents:take});left-=take;}if(!left)break;}
 if(left)fail('cash_refund_exceeded');return sources;
}
export async function bookingCashReview(db,bookingId,actor){
 await access(db,actor);if(!Number.isSafeInteger(bookingId)||bookingId<1)fail('invalid_booking_cash');
 const [bookings,original,records,sources,state]=await db.batch([
  db.prepare(`SELECT a.id,a.booking_number,a.customer_id,a.status,a.stay_id,a.agreed_total,c.id AS cancellation_id,c.pass_id,c.cash_after_cents,c.remaining_dogs,c.notified_at,p.revision AS pass_revision FROM appointments a JOIN stay_pass_booking_cancellations c ON c.booking_id=a.id JOIN stay_passes p ON p.id=c.pass_id WHERE a.id=? ORDER BY c.sequence DESC LIMIT 1`).bind(bookingId),
  db.prepare(`SELECT id,kind,amount,payment_type,customer_id,stay_id,ROUND(amount*100) cents FROM transactions WHERE deposit_appointment_id=? ORDER BY id`).bind(bookingId),
  db.prepare(`SELECT r.*,t.kind,t.amount,t.customer_id,t.stay_id,t.payment_type,t.payment_key,t.occurred_on,t.received_time,t.payment_method,t.reference,o.reason FROM stay_pass_booking_cash_records r JOIN transactions t ON t.id=r.transaction_id JOIN stay_pass_operations o ON o.id=r.id WHERE r.booking_id=? AND o.result IS NOT NULL ORDER BY r.created_at,r.id`).bind(bookingId),
  db.prepare(`SELECT x.* FROM stay_pass_booking_cash_refund_sources x JOIN stay_pass_booking_cash_records r ON r.id=x.record_id WHERE r.booking_id=? ORDER BY x.record_id,x.transaction_id`).bind(bookingId),db.prepare(bookingCashState).bind(bookingId)
 ]);
 const a=bookings.results[0];if(!a)fail('not_found');const partial=a.status==='pending'&&a.remaining_dogs>0&&a.stay_id===null&&await partialCashEnabled(db);if(!partial&&(a.status!=='cancelled'||a.stay_id!==null||a.remaining_dogs!==0))fail('cash_followup_requires_full_cancellation');
 const charge=Math.round(a.agreed_total*100);if(!Number.isSafeInteger(charge)||charge<0||charge!==a.cash_after_cents)fail('cash_source_review_required');
 if(original.results.some(t=>t.kind!=='income'||t.payment_type!=='deposit'||t.customer_id!==a.customer_id||t.stay_id!==null||!Number.isSafeInteger(t.cents)||t.cents<0||Math.abs(t.amount*100-t.cents)>.00001))fail('cash_source_review_required');
 if(records.results.some(r=>r.kind!==(r.direction==='receive'?'income':'refund')||Math.abs(r.amount*100-r.amount_cents)>.00001||r.customer_id!==a.customer_id||r.stay_id!==null||r.payment_type!==''))fail('cash_source_review_required');
 const receipts=[...original.results,...records.results.filter(r=>r.direction==='receive').map(r=>({id:r.transaction_id,cents:r.amount_cents}))];
 const received=receipts.reduce((n,r)=>n+r.cents,0),refunded=records.results.filter(r=>r.direction==='refund').reduce((n,r)=>n+r.amount_cents,0),net=received-refunded;
 if(!Number.isSafeInteger(net)||net<0||sources.results.reduce((n,r)=>n+r.amount_cents,0)!==refunded)fail('cash_source_review_required');
 for(const receipt of receipts)if(sources.results.filter(r=>r.transaction_id===receipt.id).reduce((n,r)=>n+r.amount_cents,0)>receipt.cents)fail('cash_source_review_required');
 if(sources.results.some(x=>!receipts.some(r=>r.id===x.transaction_id)||!records.results.some(r=>r.id===x.record_id&&r.direction==='refund')))fail('cash_source_review_required');
 const q={status:'ready',read_only:true,partial_booking:partial,booking_id:a.id,booking_number:a.booking_number,customer_id:a.customer_id,pass_id:a.pass_id,pass_revision:a.pass_revision,cancellation_id:a.cancellation_id,cancelled_at:a.notified_at,charge_cents:charge,received_cents:received,refunded_cents:refunded,net_received_cents:net,due_cents:Math.max(0,charge-net),refund_due_cents:Math.max(0,net-charge),receipts,refund_sources:sources.results,history:records.results.map(r=>({id:r.id,transaction_id:r.transaction_id,direction:r.direction,amount_cents:r.amount_cents,occurred_on:r.occurred_on,received_time:r.received_time,payment_method:r.payment_method,reference:r.reference,reason:r.reason,created_at:r.created_at})),source_state:state.results[0].state};
 return {...q,quote_hash:await digest(q)};
}
export async function recordBookingCash(db,input,actor,now=new Date()){
 await access(db,actor);if(!input||Object.keys(input).some(k=>!['bookingId','direction','amountCents','paymentDate','receivedTime','method','evidence','reason','confirmed','key','quoteHash'].includes(k))||input.confirmed!==true||!['receive','refund'].includes(input.direction)||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||!['cash','transfer','card','other'].includes(input.method)||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>1000||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_booking_cash');
 const payment=normalizePayment({...input,key:input.key},now);if(!payment)fail('invalid_booking_cash_payment');
 const key=actor.id+':booking-cash:'+input.key,hash=await digest(input);
 async function replay(){const row=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!row)return null;if(row.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(row.result),replayed:true};}
 const previous=await replay();if(previous)return previous;
 const q=await bookingCashReview(db,input.bookingId,actor);if(q.quote_hash!==input.quoteHash)fail('booking_cash_confirmation_required');if(q.partial_booking&&input.direction!=='refund')fail('partial_cash_refund_only');
 if(input.amountCents>(input.direction==='receive'?q.due_cents:q.refund_due_cents))fail(input.direction==='receive'?'cash_receipt_exceeded':'cash_refund_exceeded');
 const paidAt=payment.paidAt,paidInstant=Date.parse(input.paymentDate+'T'+paidAt+':00+07:00');if(paidInstant<Math.floor(Date.parse(q.cancelled_at)/60000)*60000)fail('cash_payment_before_cancellation');if(paidInstant>now.getTime())fail('cash_payment_in_future');
 const sources=input.direction==='refund'?cashRefundSources(q.receipts,q.refund_sources,input.amountCents):[],op=crypto.randomUUID(),at=now.toISOString(),net=q.net_received_cents+(input.direction==='receive'?input.amountCents:-input.amountCents);
 const writes=[
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,p.revision,'booking_cash_followup',?,? FROM stay_passes p JOIN stay_pass_booking_cancellations c ON c.pass_id=p.id JOIN appointments a ON a.id=c.booking_id WHERE c.id=? AND a.id=? AND ((a.status='cancelled' AND c.remaining_dogs=0) OR (a.status='pending' AND c.remaining_dogs>0 AND ?='refund')) AND a.stay_id IS NULL AND p.revision=? AND ${adminGuard} AND (${bookingCashState})=? ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,input.reason.trim(),at,q.cancellation_id,input.bookingId,input.direction,q.pass_revision,...actorArgs(actor),input.bookingId,q.source_state),
  db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,payment_method,reference,payment_type,payment_key,received_time)
   SELECT ?,?,'ค่าฝากเลี้ยง',?,?/100.0,?,?,?,'',?,? FROM stay_pass_operations WHERE id=?`).bind(input.paymentDate,input.direction==='receive'?'income':'refund',input.direction==='receive'?'รับค่าบริการยกเลิกจอง Stay Pass':'คืนเงินส่วนเกินจากยกเลิกจอง Stay Pass',input.amountCents,q.customer_id,input.method,input.evidence.trim(),key,paidAt,op),
  db.prepare(`INSERT INTO stay_pass_booking_cash_records(id,booking_id,cancellation_id,transaction_id,direction,amount_cents,charge_cents,before_net_cents,after_net_cents,snapshot,created_at)
   SELECT o.id,?,?,t.id,?,?,?,?,?,?,o.created_at FROM stay_pass_operations o JOIN transactions t ON t.payment_key=o.request_key WHERE o.id=?`).bind(input.bookingId,q.cancellation_id,input.direction,input.amountCents,q.charge_cents,q.net_received_cents,net,JSON.stringify(q),op),
  db.prepare(`INSERT INTO stay_pass_booking_cash_refund_sources(record_id,transaction_id,amount_cents) SELECT o.id,j.value->>'transaction_id',j.value->>'amount_cents' FROM stay_pass_operations o CROSS JOIN json_each(?) j WHERE o.id=?`).bind(JSON.stringify(sources),op),
  ...(q.partial_booking?[db.prepare(`UPDATE boarding_charges SET details=json_set(details,'$.booking_cash_adjustment_cents',?) WHERE appointment_id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(-q.refunded_cents-input.amountCents,input.bookingId,op)]:[]),
  db.prepare(`UPDATE stay_passes SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.pass_id,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id)
   SELECT ?,'booking',?,'booking_cash_followup',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),String(input.bookingId),JSON.stringify(q),JSON.stringify({direction:input.direction,amount_cents:input.amountCents,net_received_cents:net,refund_sources:sources,evidence:input.evidence.trim(),paid_at:paidAt}),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','operationId',id,'bookingId',?,'direction',?,'amountCents',?,'netReceivedCents',?,'dueCents',?,'refundDueCents',?) WHERE id=?`).bind(input.bookingId,input.direction,input.amountCents,net,Math.max(0,q.charge_cents-net),Math.max(0,net-q.charge_cents),op)
 ];
 const result=await db.batch(writes);return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
}
