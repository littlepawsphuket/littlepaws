// Pending-booking cancellation. Owner-approved cash rates match credit deductions; cash refunds remain separate.
import {bookingCashRefunds} from './precheckin_cash.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {cancellationQuote,stamp,fail,refundValueSlice} from './rules.mjs';
import {passBookingState} from './booking_state.mjs';
import {bookingAmendment} from './effective_booking.mjs';
async function authorize(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
const requestFields=['bookingId','cause','notifiedAt','dogIds','overridePercent','overrideReason'];
function inputCheck(input){if(!input||Object.keys(input).some(k=>!requestFields.includes(k))||!Number.isSafeInteger(input.bookingId)||input.bookingId<1||!['customer','shop','no_show'].includes(input.cause))fail('invalid_cancellation');if(input.dogIds!==undefined&&(!Array.isArray(input.dogIds)||!input.dogIds.length||input.dogIds.length>30||input.dogIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(input.dogIds).size!==input.dogIds.length))fail('invalid_cancellation');}
export function cancellationAllocation({rows,allocations,lots,dogIds,percent}){
 if(![0,25,50,75,100].includes(percent))fail('invalid_cancellation');const lines=[];
 for(const id of [...dogIds].sort((a,b)=>a-b)){
  const row=rows.find(r=>r.dog_id===id),held=allocations.filter(a=>a.dog_id===id&&a.reserved_units>0);
  if(!row||held.reduce((n,a)=>n+a.reserved_units,0)!==row.covered_units||held.some(a=>a.consumed_units!==0||!lots.some(l=>l.id===a.lot_id)))fail('ledger_mismatch');
  if(row.covered_units*percent%100)fail('credit_precision_approval_required');let deduct=row.covered_units*percent/100;
  const sorted=[...held].sort((a,b)=>{const x=lots.find(l=>l.id===a.lot_id),y=lots.find(l=>l.id===b.lot_id);return (x.source_kind==='carry_forward'?0:1)-(y.source_kind==='carry_forward'?0:1)||x.expires_at.localeCompare(y.expires_at)||x.id.localeCompare(y.id);});
  for(const a of sorted){const used=Math.min(deduct,a.reserved_units);deduct-=used;lines.push({lot_id:a.lot_id,dog_id:id,held_units:a.reserved_units,deduct_units:used,release_units:a.reserved_units-used});}
  if(deduct)fail('ledger_mismatch');
 }
 return lines;
}
function remainingSnapshot(original,ids){
 const kept=structuredClone(original);kept.pets=kept.pets.filter(d=>!ids.includes(d.id));if(!kept.pets.length)return null;
 const rows=kept.settlement.rows.filter(d=>!ids.includes(d.dog_id));kept.settlement.rows=rows;
 for(const name of ['base_units','late_units','total_units','covered_units','base_covered_units','late_covered_units','base_cash_units','late_cash_units','cash_units','base_cash_cents','late_cash_cents','cash_cents'])kept.settlement[name]=rows.reduce((n,r)=>n+(r[name]||0),0);
 kept.credit_units=kept.settlement.total_units;kept.credit_allocation=(kept.credit_allocation||[]).map(l=>{const dogUnits=l.dogUnits.filter(d=>!ids.includes(d.dog_id));return {...l,dogUnits,dogIds:dogUnits.map(d=>d.dog_id),units:dogUnits.reduce((n,d)=>n+d.units,0)};}).filter(l=>l.units>0);
 if(kept.late_checkout)kept.late_checkout.credit_units=kept.settlement.late_units;
 return kept;
}
export async function quoteCancellation(db,input,actor,now=new Date()){
 await authorize(db,actor);inputCheck(input);const notifiedAt=stamp(input.notifiedAt),at=now.toISOString();if(notifiedAt>at)fail('invalid_request_time');
 const [records,pets,allocated,lots,ledger,payments,state]=await db.batch([
  db.prepare(`SELECT a.*,l.pass_id,l.created_at AS converted_at,l.converted_revision,s.snapshot,p.revision AS pass_revision,p.status AS pass_status,p.expires_at,p.customer_id AS pass_customer FROM appointments a JOIN stay_pass_booking_links l ON l.booking_id=a.id JOIN stay_pass_booking_settlements s ON s.id=l.hold_operation_id JOIN stay_passes p ON p.id=l.pass_id WHERE a.id=?`).bind(input.bookingId),
  db.prepare(`SELECT ad.dog_id,d.name FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=? ORDER BY ad.dog_id`).bind(input.bookingId),
  db.prepare('SELECT * FROM stay_pass_booking_allocations WHERE booking_id=? ORDER BY dog_id,lot_id').bind(input.bookingId),
  db.prepare(`SELECT l.* FROM stay_pass_credit_lots l JOIN stay_pass_booking_links b ON b.pass_id=l.pass_id WHERE b.booking_id=? ORDER BY l.id`).bind(input.bookingId),
  db.prepare(`SELECT t.lot_id,SUM(t.delta_units) units,SUM(t.delta_reserved) held,SUM(t.delta_refund_held) refunded FROM stay_pass_credit_transactions t JOIN stay_pass_booking_links b ON b.pass_id=t.pass_id WHERE b.booking_id=? GROUP BY t.lot_id`).bind(input.bookingId),
  db.prepare("SELECT id,kind,amount,payment_type FROM transactions WHERE deposit_appointment_id=? AND payment_type!='' ORDER BY id").bind(input.bookingId),db.prepare(passBookingState).bind(input.bookingId)
 ]);
 const a=records.results[0];if(!a)fail('not_found');if(a.status!=='pending'||a.stay_id!==null)fail('booking_not_pending');if(a.customer_id!==a.pass_customer)fail('ineligible_pet');if(notifiedAt<a.converted_at)fail('notification_before_confirmation');
 const amendment=await bookingAmendment(db,input.bookingId),frozen=JSON.parse(amendment?.remaining_snapshot||a.snapshot),revision=amendment?.next_revision||a.converted_revision;
 if(a.cloud_revision!==revision||frozen.pets.length!==pets.results.length||pets.results.some(d=>!frozen.pets.some(p=>p.id===d.dog_id))||a.checkin!==frozen.checkin_day||a.checkout!==frozen.checkout_day||a.charged_nights!==frozen.declared_quantity)fail('booking_confirmation_required');
 if(allocated.results.some(r=>r.consumed_units!==0)||allocated.results.reduce((n,r)=>n+r.reserved_units,0)!==frozen.settlement.covered_units)fail('ledger_mismatch');
 for(const l of lots.results){const t=ledger.results.find(t=>t.lot_id===l.id);if(!t||l.remaining_units!==t.units||l.reserved_units!==t.held||l.refund_held_units!==t.refunded)fail('ledger_mismatch');}
 const ids=input.dogIds??pets.results.map(d=>d.dog_id);if(ids.some(id=>!pets.results.some(d=>d.dog_id===id)))fail('ineligible_pet');
 const policy=cancellationQuote({units:4,arrival:frozen.checkin_at,notified:notifiedAt,cause:input.cause}),percent=input.overridePercent??policy.percent;
 if(![0,25,50,75,100].includes(percent)||percent>policy.percent||typeof (input.overrideReason||'')!=='string'||(input.overrideReason||'').length>800)fail('invalid_cancellation');
 const overrideReason=(input.overrideReason||'').trim();if(percent<policy.percent&&!overrideReason)fail('override_reason_required');
 const blockers=[],priorFees=frozen.cancellation_cash_fees_cents??0,activeCash=frozen.settlement.cash_cents,cashBefore=activeCash+priorFees;
 if(!Number.isSafeInteger(priorFees)||priorFees<0||!Number.isSafeInteger(cashBefore)||cashBefore<0||Math.round(a.agreed_total*100)!==cashBefore||frozen.settlement.rows.some(r=>!Number.isSafeInteger(r.cash_cents)||r.cash_cents<0)||frozen.settlement.rows.reduce((n,r)=>n+r.cash_cents,0)!==activeCash)fail('existing_payment_review_required');
 if(payments.results.some(t=>t.kind!=='income'||t.payment_type!=='deposit'||!Number.isSafeInteger(Math.round(t.amount*100))||t.amount<0))fail('existing_payment_review_required');
 const refunded=await bookingCashRefunds(db,input.bookingId);const paid=payments.results.reduce((n,t)=>n+Math.round(t.amount*100),0)-refunded.refunded_cents;if(!Number.isSafeInteger(paid)||paid<0)fail('existing_payment_review_required');
 // Receipts remain pooled on this booking; never split, copy or re-record the deposit.

 const selectedCash=frozen.settlement.rows.filter(r=>ids.includes(r.dog_id)).reduce((n,r)=>n+r.cash_cents,0),cashFee=frozen.settlement.rows.filter(r=>ids.includes(r.dog_id)).reduce((n,r)=>n+refundValueSlice(r.cash_cents,100,0,percent),0),cashAfter=cashBefore-selectedCash+cashFee;

 let lines=[];try{lines=cancellationAllocation({rows:frozen.settlement.rows,allocations:allocated.results,lots:lots.results,dogIds:ids,percent});}catch(error){if(error.code==='credit_precision_approval_required')blockers.push(error.code);else throw error;}
 const held=ids.reduce((n,id)=>n+frozen.settlement.rows.find(r=>r.dog_id===id).covered_units,0);
 const deducted=blockers.includes('credit_precision_approval_required')?null:lines.reduce((n,l)=>n+l.deduct_units,0),remaining=lots.results.reduce((n,l)=>n+l.remaining_units,0),reserved=lots.results.reduce((n,l)=>n+l.reserved_units,0),next=remainingSnapshot(frozen,ids);
 if(next){next.cancellation_cash_fees_cents=priorFees+cashFee;next.booking_cash_total_cents=cashAfter;}
 const q={status:'ready',read_only:true,booking_id:input.bookingId,pass_id:a.pass_id,pass_revision:a.pass_revision,booking_revision:a.cloud_revision,booking_number:a.booking_number,sequence:(amendment?.sequence||0)+1,
  cause:input.cause,arrival_at:frozen.checkin_at,notified_at:notifiedAt,notice_calendar_days:policy.notice_calendar_days,standard_percent:policy.percent,applied_percent:percent,override_reason:overrideReason,
  dogs:pets.results.filter(d=>ids.includes(d.dog_id)),remaining_dogs:pets.results.filter(d=>!ids.includes(d.dog_id)),held_units:held,deduct_units:deducted,release_units:deducted===null?null:held-deducted,remaining_before_units:remaining,remaining_after_units:deducted===null?null:remaining-deducted,reserved_before_units:reserved,reserved_after_units:reserved-held,
  available_after_units:deducted===null?null:!['active','fully_used'].includes(a.pass_status)||a.expires_at<=at?0:lots.results.filter(l=>l.expires_at>at).reduce((n,l)=>n+l.remaining_units-l.reserved_units-l.refund_held_units,0)+lines.filter(r=>lots.results.find(l=>l.id===r.lot_id).expires_at>at).reduce((n,l)=>n+l.release_units,0),
  prior_cancellation_cash_fees_cents:priorFees,cumulative_cancellation_cash_fees_cents:priorFees+cashFee,remaining_boarding_cash_cents:activeCash-selectedCash,deposit_applied_cents:Math.min(paid,cashAfter),cash_before_cents:cashBefore,selected_cash_cents:selectedCash,cash_fee_cents:cashFee,cash_after_cents:cashAfter,paid_cents:paid,cash_due_cents:Math.max(0,cashAfter-paid),cash_refund_review_cents:Math.max(0,paid-cashAfter),
  expired_released_units:lines.filter(r=>lots.results.find(l=>l.id===r.lot_id).expires_at<=at).reduce((n,l)=>n+l.release_units,0),lines,remaining_snapshot:next,source_state:state.results[0].state,blockers};
 return {...q,quote_hash:await digest(q)};
}
export async function confirmCancellation(db,input,actor,now=new Date()){
 await authorize(db,actor);if(!input||Object.keys(input).some(k=>![...requestFields,'key','quoteHash','reason','confirmed'].includes(k))||input.confirmed!==true||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_cancellation');
 const key=actor.id+':cancel-booking:'+input.key,hash=await digest(input);
 async function replay(){const p=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!p)return null;if(p.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(p.result),replayed:true};}
 const prior=await replay();if(prior)return prior;
 const args=Object.fromEntries(requestFields.filter(k=>input[k]!==undefined).map(k=>[k,input[k]])),q=await quoteCancellation(db,args,actor,now);if(q.quote_hash!==input.quoteHash)fail('booking_confirmation_required');if(q.blockers.length)fail(q.blockers[0]);
 const op=crypto.randomUUID(),revision=crypto.randomUUID(),at=now.toISOString(),ids=q.dogs.map(d=>d.dog_id),lotIds=[...new Set(q.lines.map(l=>l.lot_id))],kind=input.cause==='no_show'?'no_show_deduction':'cancellation_deduction';
 const lines=lotIds.map(lot=>({id:crypto.randomUUID(),lot_id:lot,held:q.lines.filter(l=>l.lot_id===lot).reduce((n,l)=>n+l.held_units,0),deduct:q.lines.filter(l=>l.lot_id===lot).reduce((n,l)=>n+l.deduct_units,0)}));
 try{const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,?, 'booking_cancellation',?,? FROM stay_passes p JOIN stay_pass_booking_links b ON b.pass_id=p.id JOIN appointments a ON a.id=b.booking_id WHERE a.id=? AND a.status='pending' AND a.stay_id IS NULL AND a.cloud_revision=? AND p.revision=? AND ${adminGuard} AND (${passBookingState})=?
   ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,q.pass_revision,input.reason.trim(),at,input.bookingId,q.booking_revision,q.pass_revision,...actorArgs(actor),input.bookingId,q.source_state),
  db.prepare(`INSERT INTO stay_pass_booking_cancellations(id,pass_id,booking_id,sequence,cause,notified_at,notice_days,standard_percent,applied_percent,override_reason,held_units,deduct_units,release_units,remaining_dogs,next_revision,remaining_snapshot,snapshot,cash_before_cents,cash_fee_cents,cash_after_cents,paid_cents,cash_due_cents,cash_refund_review_cents,created_at)
   SELECT id,pass_id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.bookingId,q.sequence,input.cause,q.notified_at,q.notice_calendar_days,q.standard_percent,q.applied_percent,q.override_reason,q.held_units,q.deduct_units,q.release_units,q.remaining_dogs.length,revision,q.remaining_snapshot?JSON.stringify(q.remaining_snapshot):null,JSON.stringify(q),q.cash_before_cents,q.cash_fee_cents,q.cash_after_cents,q.paid_cents,q.cash_due_cents,q.cash_refund_review_cents,op),
  db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,booking_id,recorded_at)
   SELECT j.value->>'id',o.id,o.pass_id,l.id,?,-(j.value->>'deduct'),-(j.value->>'held'),0,l.remaining_units,l.remaining_units-(j.value->>'deduct'),l.reserved_units,l.reserved_units-(j.value->>'held'),l.refund_held_units,l.refund_held_units,?,o.created_at FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' AND l.pass_id=o.pass_id WHERE o.id=?`).bind(kind,input.bookingId,JSON.stringify(lines),op),
  db.prepare(`INSERT INTO stay_pass_cancellation_lines(operation_id,ledger_id,lot_id,dog_id,held_units,deduct_units)
   SELECT o.id,t.id,t.lot_id,j.value->>'dog_id',j.value->>'held_units',j.value->>'deduct_units' FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_transactions t ON t.operation_id=o.id AND t.lot_id=j.value->>'lot_id' WHERE o.id=?`).bind(JSON.stringify(q.lines),op),
  db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at)
   SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,l.dog_id,-l.held_units,0,t.recorded_at FROM stay_pass_credit_transactions t JOIN stay_pass_cancellation_lines l ON l.ledger_id=t.id WHERE t.operation_id=?`).bind(op),
  ...(q.remaining_dogs.length?[db.prepare(`DELETE FROM appointment_dogs WHERE appointment_id=? AND dog_id IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(input.bookingId,JSON.stringify(ids),op)]:[]),
  db.prepare(`UPDATE appointments SET status=?,cloud_revision=?,agreed_total=?/100.0 WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.remaining_dogs.length?'pending':'cancelled',revision,q.cash_after_cents,input.bookingId,op),
  db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE WHEN status IN('active','fully_used') AND expires_at>? THEN CASE WHEN EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id AND remaining_units>0) THEN 'active' ELSE 'fully_used' END ELSE status END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(at,q.pass_id,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id) SELECT ?,'booking',?,'booking_cancellation',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),String(input.bookingId),JSON.stringify({revision:q.booking_revision,held_units:q.held_units}),JSON.stringify(q),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','passId',pass_id,'bookingId',?,'operationId',id,'deductUnits',?,'releasedUnits',?,'remainingUnits',?,'reservedUnits',?,'availableUnits',?,'remainingDogs',?,'cashFeeCents',?,'cashDueCents',?,'cashRefundReviewCents',?) WHERE id=?`).bind(input.bookingId,q.deduct_units,q.release_units,q.remaining_after_units,q.reserved_after_units,q.available_after_units,q.remaining_dogs.length,q.cash_fee_cents,q.cash_due_cents,q.cash_refund_review_cents,op)
 ]);return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
 }catch(error){if(/UNIQUE constraint failed: stay_pass_booking_cancellations/.test(String(error)))return await replay()||{status:'conflict'};throw error;}
}
export async function cancellationHistory(db,passId,actor){
 await authorize(db,actor);if(typeof passId!=='string'||!passId||passId.length>100)fail('invalid_request');
 const {results}=await db.prepare('SELECT id,booking_id,cause,notified_at,notice_days,standard_percent,applied_percent,override_reason,held_units,deduct_units,release_units,remaining_dogs,cash_before_cents,cash_fee_cents,cash_after_cents,paid_cents,cash_due_cents,cash_refund_review_cents,snapshot,created_at FROM stay_pass_booking_cancellations WHERE pass_id=? ORDER BY created_at DESC,sequence DESC LIMIT 50').bind(passId).all();
 return {status:'ready',cancellations:results.map(({snapshot,...r})=>({...r,dogs:JSON.parse(snapshot).dogs}))};
}
