import {quotePassCheckout,checkoutState} from './checkout.mjs';
import {bookingSettlement} from './settlement.mjs';
import {bookingWarnings,bookingSnapshot} from '../booking_warnings.mjs';
import {normalizePayment} from '../stay_payments.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail} from './rules.mjs';
const local=value=>new Date(Date.parse(value)+7*3600000).toISOString();
export async function quotePassExtension(db,input,actor,now=new Date()){
 if(!input||Object.keys(input).some(k=>!['stayId','checkout','checkoutTime','extraAllocations'].includes(k))||!Number.isSafeInteger(input.stayId)||typeof input.checkout!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.checkout)||typeof input.checkoutTime!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.checkoutTime))fail('invalid_extension');
 const value={stayId:input.stayId,actualCheckoutAt:input.checkout+'T'+input.checkoutTime+':00+07:00'};if(input.extraAllocations!==undefined)value.extraAllocations=input.extraAllocations;
 const q=await quotePassCheckout(db,value,actor,now),s=q.settlement;
 if(q.agreement_snapshot.service!=='overnight')fail('extension_service_review_required');
 if(q.timing.actual_checkout_at<=q.original_agreement.checkout_at||q.timing.quantity100<q.original_agreement.quantity100||s.restored_units||Date.parse(q.timing.actual_checkout_at)-Date.parse(q.timing.checkin_at)>365*86400000)fail('invalid_extension');
 const pass=await db.prepare('SELECT status,expires_at FROM stay_passes WHERE id=?').bind(q.pass_id).first();
 if(!['active','fully_used'].includes(pass.status)||pass.expires_at<=now.toISOString())fail('pass_not_active');
 if(q.timing.actual_checkout_at>=pass.expires_at)fail('extension_expiry_review_required');
 if(s.cash_cents!==null&&s.cash_cents<s.original_cash_cents)fail('extension_price_review_required');
 const capacity=await bookingWarnings(db,null,local(q.timing.checkin_at).slice(0,10),input.checkout,s.rows.map(r=>r.dog_id),input.stayId);
 const result={status:'ready',review:q,old_total_cents:s.original_cash_cents,added_cents:s.cash_cents===null?null:s.cash_cents-s.original_cash_cents,total_cents:s.cash_cents,paid_cents:s.paid_cents,due_cents:s.balance_cents,quantity100:q.timing.quantity100,old_checkout:local(q.original_agreement.checkout_at).slice(0,10),old_checkout_time:local(q.original_agreement.checkout_at).slice(11,16),checkout:input.checkout,checkout_time:input.checkoutTime,warnings:capacity.warnings,capacity_snapshot:capacity.snapshot};
 return {...result,quote_hash:await digest(result)};
}
export async function confirmPassExtension(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 if(!input||Object.keys(input).some(k=>!['stayId','checkout','checkoutTime','extraAllocations','key','quoteHash','reason','payment'].includes(k))||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)fail('invalid_extension');
 const key=actor.id+':extension:'+input.key,hash=await digest(input);
 async function replay(){const row=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!row)return null;if(row.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(row.result),replayed:true};}
 const previous=await replay();if(previous)return previous;
 const quoteInput={stayId:input.stayId,checkout:input.checkout,checkoutTime:input.checkoutTime};if(input.extraAllocations!==undefined)quoteInput.extraAllocations=input.extraAllocations;
 const preview=await quotePassExtension(db,quoteInput,actor,now),q=preview.review,s=q.settlement;
 if(preview.quote_hash!==input.quoteHash)fail('extension_confirmation_required');
 if(s.blockers.length)fail(s.blockers[0]);if(preview.warnings.length)fail('capacity_review_required');
 const payment=input.payment?normalizePayment({...input.payment,key:input.key},now):null;
 if(input.payment&&!payment)fail('invalid_extension_payment');if(payment&&payment.amountCents>s.balance_cents)fail('payment_exceeds');
 const amount=payment?.amountCents||0,op=crypto.randomUUID(),at=now.toISOString();
 const capacity=await bookingWarnings(db,null,local(q.timing.checkin_at).slice(0,10),input.checkout,s.rows.map(r=>r.dog_id),input.stayId);
 if(capacity.snapshot!==preview.capacity_snapshot)fail('extension_confirmation_required');
 const settlement=bookingSettlement({baseUnits:q.timing.quantity100/25*s.rows.length,latePercent:q.timing.late_percent,dogs:s.rows.map(r=>({id:r.dog_id,name:r.name,nightly_rate_cents:r.regular_rate_cents})),availableUnits:s.rows.reduce((n,r)=>n+r.after_covered_units,0),service:'overnight',allocations:s.rows.map(r=>({dog_id:r.dog_id,credit_units:r.after_covered_units}))});
 const agreement={...q.agreement_snapshot,checkout_at:q.timing.actual_checkout_at,declared_quantity:q.timing.quantity100/100,settlement,booking_cash_total_cents:s.cash_cents};
 const changes=s.extra_lines.map(line=>({id:crypto.randomUUID(),lot_id:line.lotId,units:line.units,dogs:line.dogUnits}));
 const entry={key:input.key,actor_id:actor.id,created_at:at,reason:input.reason.trim(),before:{checkout:preview.old_checkout,time:preview.old_checkout_time,total_cents:preview.old_total_cents,quantity:q.original_agreement.quantity100/100},after:{checkout:input.checkout,time:input.checkoutTime,total_cents:s.cash_cents,quantity:q.timing.quantity100/100},added_cents:preview.added_cents,payment_cents:amount,extra_credit_units:s.extra_covered_units,operation_id:op};
 try{
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,p.revision,'stay_extension',?,? FROM stay_passes p JOIN stay_pass_booking_links b ON b.pass_id=p.id JOIN stay_pass_checkin_commits c ON c.booking_id=b.booking_id JOIN stays st ON st.id=c.stay_id
   WHERE st.id=? AND p.revision=? AND p.status IN('active','fully_used') AND p.expires_at>? AND st.status='checked_in' AND st.cancelled_at IS NULL AND st.actual_checkout_at IS NULL AND ${adminGuard}
   AND (${checkoutState})=? AND (${bookingSnapshot})=? ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,input.reason.trim(),at,input.stayId,q.pass_revision,q.timing.actual_checkout_at,...actorArgs(actor),input.stayId,q.source_state,...capacity.params,capacity.snapshot),
  db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,booking_id,stay_id,recorded_at)
   SELECT j.value->>'id',o.id,o.pass_id,l.id,'stay_consumption',-(j.value->>'units'),0,0,l.remaining_units,l.remaining_units-(j.value->>'units'),l.reserved_units,l.reserved_units,l.refund_held_units,l.refund_held_units,?,?,o.created_at FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' AND l.pass_id=o.pass_id WHERE o.id=?`).bind(q.booking_id,input.stayId,JSON.stringify(changes),op),
  db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at)
   SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,d.value->>'dog_id',0,d.value->>'units',t.recorded_at FROM stay_pass_credit_transactions t JOIN json_each(?) j ON j.value->>'id'=t.id CROSS JOIN json_each(j.value->'dogs') d WHERE t.operation_id=?`).bind(JSON.stringify(changes),op),
  db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,payment_type,payment_key,received_time)
   SELECT ?,'income','ค่าฝากเลี้ยง','ชำระเพิ่มเติม · ต่อวันเข้าพัก Stay Pass',?/100.0,s.customer_id,s.id,'','additional',?,? FROM stays s WHERE s.id=? AND ?>0 AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(payment?.paymentDate||local(at).slice(0,10),amount,key,payment?.paidAt||'',input.stayId,amount,op),
  db.prepare(`INSERT INTO stay_pass_stay_extensions(id,stay_id,sequence,quote_hash,snapshot,after_snapshot,before_total_cents,total_cents,quantity100,checkout_day,checkout_at,created_at)
   SELECT id,?,1+COALESCE((SELECT MAX(sequence) FROM stay_pass_stay_extensions WHERE stay_id=?),0),?,?,?,?,?,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.stayId,input.stayId,preview.quote_hash,JSON.stringify({...preview,received_cents:amount}),JSON.stringify(agreement),s.original_cash_cents,s.cash_cents,q.timing.quantity100,input.checkout,q.timing.actual_checkout_at,op),
  db.prepare(`UPDATE stays SET checkout=?,charged_nights=?/100.0,agreed_total=?/100.0,intake=json_set(intake,'$.pickup_time',?) WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(input.checkout,q.timing.quantity100,s.cash_cents,input.checkoutTime,input.stayId,op),
  db.prepare(`UPDATE boarding_charges SET details=json_set(details,'$.base_days',?,'$.checkout',?,'$.checkout_time',?,'$.extra_minutes',?,'$.percent',?,'$.base_cents',?,'$.fee_cents',?,'$.stay_pass.credit_units',?,'$.stay_pass.settlement',json(?),'$.extensions',json_insert(COALESCE(json_extract(details,'$.extensions'),'[]'),'$[#]',json(?))) WHERE stay_id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.timing.quantity100/100,input.checkout,input.checkoutTime,q.timing.extra_minutes,q.timing.late_percent,settlement.cash_cents-settlement.late_cash_cents,settlement.late_cash_cents,settlement.covered_units,JSON.stringify(settlement),JSON.stringify(entry),input.stayId,op),
  db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE WHEN EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id AND remaining_units>0) THEN 'active' ELSE 'fully_used' END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.pass_id,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id) SELECT ?,'stay',?,'stay_extension',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),String(input.stayId),JSON.stringify(q.original_agreement),JSON.stringify({...entry,settlement}),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','id',?,'operationId',id,'added_cents',?,'total_cents',?,'due_cents',?,'extra_credit_units',?,'remaining_units',?,'available_units',?) WHERE id=?`).bind(input.stayId,preview.added_cents,s.cash_cents,s.balance_cents-amount,s.extra_covered_units,s.remaining_after_units,s.available_after_units,op)
 ]);
 return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
 }catch(error){if(/UNIQUE constraint failed: stay_pass_stay_extensions/.test(String(error)))return await replay()||{status:'conflict'};throw error;}
}
