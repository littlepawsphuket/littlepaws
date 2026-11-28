import {daycareTiming} from './daycare.mjs';
import {stayCashRefunds} from './precheckin_cash.mjs';
import {stayAgreement} from './effective_booking.mjs';
// Read-only checkout review. Writing a quote never closes a stay, restores credits or receives cash.
import {overnightPricing} from '../boarding_pricing.mjs';
import {cashTopupCents,bookingSettlement} from './settlement.mjs';
import {allocatableLots,allocateBookingLots} from './lot_allocation.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail} from './rules.mjs';
const iso=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('invalid_checkout_time');
 const date=new Date(value),calendar=new Date(value.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(date.getTime())||!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))fail('invalid_checkout_time');return date.toISOString();
};
const local=at=>{const d=new Date(Date.parse(at)+7*3600000).toISOString();return {day:d.slice(0,10),time:d.slice(11,16)};};
export function checkoutTiming({checkinAt,scheduledCheckoutAt,actualCheckoutAt,originalQuantity100,quantity100}){
 const start=iso(checkinAt),scheduled=iso(scheduledCheckoutAt),actual=iso(actualCheckoutAt);
 if(actual<start||scheduled<start||!Number.isSafeInteger(originalQuantity100)||originalQuantity100<100||originalQuantity100%100)fail('invalid_checkout_time');
 const elapsed=Date.parse(actual)-Date.parse(start),wholeDays=Math.max(1,Math.floor(elapsed/86400000));
 // An unchanged agreed pickup preserves manually negotiated days. An extension cannot erase them.
 const suggested=actual<scheduled?wholeDays*100:Math.max(originalQuantity100,wholeDays*100);
 const chosen=quantity100??suggested;
 if(!Number.isSafeInteger(chosen)||chosen<100||chosen>36500||chosen%100)fail('invalid_checkout_quantity');
 const a=local(start),b=local(actual),pricing=overnightPricing({pricingVersion:1,service:'overnight',checkin:a.day,checkout:b.day,checkinTime:a.time,checkoutTime:b.time,quantity100:chosen,dogs:[]});
 if(!pricing)fail('invalid_checkout_time');
 return {checkin_at:start,scheduled_checkout_at:scheduled,actual_checkout_at:actual,suggested_quantity100:suggested,quantity100:chosen,quantity_overridden:chosen!==suggested,early:actual<scheduled,elapsed_minutes:Math.floor(elapsed/60000),extra_minutes:pricing.extra_minutes,late_percent:pricing.percent,units_per_dog:chosen/25+pricing.percent/25};
}
export function checkoutSettlement({timing,original,allocations,lots,nowAt,passStatus,paidCents,extraAllocations,fixedCashCents=0,service='overnight'}){
 if(!Number.isSafeInteger(fixedCashCents)||fixedCashCents<0)fail('checkout_review_required');
 const rows=original.rows;
 // Released dogs remain in the immutable attribution view with zero balances.
 allocations=allocations.filter(a=>a.consumed_units!==0||a.reserved_units!==0);
 if(!Array.isArray(rows)||!rows.length||rows.length>30||new Set(rows.map(r=>r.dog_id)).size!==rows.length||!Number.isSafeInteger(paidCents)||paidCents<0)fail('checkout_review_required');
 if(allocations.some(a=>!Number.isSafeInteger(a.consumed_units)||a.consumed_units<0||a.reserved_units!==0||!rows.some(r=>r.dog_id===a.dog_id)||!lots.some(l=>l.id===a.lot_id)))fail('ledger_mismatch');
 for(const r of rows){if(!Number.isSafeInteger(r.total_units)||r.total_units<1||!Number.isSafeInteger(r.covered_units)||r.covered_units<0||r.covered_units>r.total_units||!Number.isSafeInteger(r.regular_rate_cents)||r.regular_rate_cents<0||r.cash_cents!==cashTopupCents(r.total_units-r.covered_units,r.regular_rate_cents,service)||allocations.filter(a=>a.dog_id===r.dog_id).reduce((n,a)=>n+a.consumed_units,0)!==r.covered_units)fail('checkout_review_required');}
 if(new Set(rows.map(r=>r.total_units)).size!==1)fail('checkout_review_required');
 const demand=timing.units_per_dog,extra=Math.max(0,demand-rows[0].total_units),eligible=['active','fully_used'].includes(passStatus)?allocatableLots(lots,nowAt,timing.actual_checkout_at):[];
 const available=eligible.reduce((n,l)=>n+l.available_units,0),extraQuote=extra?bookingSettlement({baseUnits:extra*rows.length,latePercent:0,dogs:rows.map(r=>({id:r.dog_id,name:r.name,nightly_rate_cents:r.regular_rate_cents})),availableUnits:available,service,allocations:extraAllocations}):null;
 if(!extra&&extraAllocations!==undefined)fail('invalid_credit_allocation');
 const blockers=extraQuote?.blockers||[],newRows=[],restore=[];
 for(const r of rows){
  const retained=Math.min(r.covered_units,demand),added=extraQuote?extraQuote.rows.find(d=>d.dog_id===r.dog_id).covered_units:0;
  let returning=r.covered_units-retained;
  // Undo the last purchased coverage first so retained consumption continues to use carry first.
  const consumed=allocations.filter(a=>a.dog_id===r.dog_id&&a.consumed_units>0).sort((a,b)=>{
   const la=lots.find(l=>l.id===a.lot_id),lb=lots.find(l=>l.id===b.lot_id);
   return (lb.source_kind==='carry_forward'?0:1)-(la.source_kind==='carry_forward'?0:1)||lb.expires_at.localeCompare(la.expires_at)||lb.id.localeCompare(la.id);
  });
  for(const a of consumed){const units=Math.min(returning,a.consumed_units);if(units){restore.push({lot_id:a.lot_id,dog_id:r.dog_id,units,expired:lots.find(l=>l.id===a.lot_id).expires_at<=nowAt});returning-=units;}}
  if(returning)fail('ledger_mismatch');
  const covered=added===null?null:retained+added,cash=covered===null?null:cashTopupCents(demand-covered,r.regular_rate_cents,service);
  newRows.push({dog_id:r.dog_id,name:r.name,regular_rate_cents:r.regular_rate_cents,before_units:r.total_units,after_units:demand,before_covered_units:r.covered_units,retained_units:retained,restored_units:r.covered_units-retained,extra_covered_units:added,after_covered_units:covered,cash_units:covered===null?null:demand-covered,cash_cents:cash});
 }
 const cash=newRows.every(r=>r.cash_cents!==null)?newRows.reduce((n,r)=>n+r.cash_cents,0)+fixedCashCents:null,restored=restore.reduce((n,r)=>n+r.units,0),extraCovered=extraQuote?.covered_units||0;
 if(cash!==null&&!Number.isSafeInteger(cash))fail('checkout_review_required');
 const extraLines=blockers.length?[]:allocateBookingLots(eligible,extraQuote?.rows||[],null);
 const remaining=lots.reduce((n,l)=>n+l.remaining_units,0),reserved=lots.reduce((n,l)=>n+l.reserved_units,0),refundHeld=lots.reduce((n,l)=>n+l.refund_held_units,0);
 return {rows:newRows,blockers,restore_lines:restore,extra_lines:extraLines,restored_units:restored,extra_covered_units:extraCovered,net_credit_change_units:restored-extraCovered,
  remaining_before_units:remaining,remaining_after_units:remaining+restored-extraCovered,reserved_units:reserved,refund_held_units:refundHeld,
  // Restoring an expired lot preserves provenance; it does not reactivate the right to book.
  expired_restored_units:restore.filter(r=>r.expired).reduce((n,r)=>n+r.units,0),
  cancellation_cash_fees_cents:fixedCashCents,original_cash_cents:rows.reduce((n,r)=>n+r.cash_cents,0)+fixedCashCents,cash_cents:cash,paid_cents:paidCents,balance_cents:cash===null?null:Math.max(0,cash-paidCents),refund_review_cents:cash===null?null:Math.max(0,paidCents-cash),
  available_after_units:!['active','fully_used'].includes(passStatus)?0:Math.max(0,lots.filter(l=>l.expires_at>nowAt).reduce((n,l)=>n+l.remaining_units-l.reserved_units-l.refund_held_units,0)+restore.filter(r=>!r.expired).reduce((n,r)=>n+r.units,0)-extraCovered)};
}
export const checkoutState=`SELECT json_object('stay',json_object('id',s.id,'customer',s.customer_id,'status',s.status,'cancelled',s.cancelled_at,'start',s.checkin,'end',s.checkout,'actual',s.actual_checkin_at,'returned',s.actual_checkout_at,'quantity',s.charged_nights,'total',s.agreed_total),
 'pricing',(SELECT details FROM boarding_charges WHERE stay_id=s.id),'pets',(SELECT json_group_array(json_object('id',dog_id,'rate',nightly_rate_cents)) FROM (SELECT dog_id,nightly_rate_cents FROM stay_dogs WHERE stay_id=s.id ORDER BY dog_id)),
 'payments',(SELECT json_group_array(json_object('id',id,'kind',kind,'type',payment_type,'amount',amount)) FROM (SELECT id,kind,payment_type,amount FROM transactions WHERE stay_id=s.id AND payment_type!='' ORDER BY id)),
 'allocations',(SELECT json_group_array(json_object('lot',lot_id,'dog',dog_id,'held',reserved_units,'used',consumed_units)) FROM (SELECT a.* FROM stay_pass_booking_allocations a JOIN stay_pass_checkin_commits c ON c.booking_id=a.booking_id WHERE c.stay_id=s.id ORDER BY lot_id,dog_id))) AS state FROM stays s WHERE s.id=?`;
export async function quotePassCheckout(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 if(!input||Object.keys(input).some(k=>!['stayId','actualCheckoutAt','quantity100','extraAllocations'].includes(k))||!Number.isSafeInteger(input.stayId)||input.stayId<1)fail('invalid_request');
 const [records,allocations,lots,pets,payments,ledger,state]=await db.batch([
  db.prepare(`SELECT s.*,c.booking_id,c.operation_id AS checkin_operation,p.id AS pass_id,p.pass_number,p.revision AS pass_revision,p.status AS pass_status,p.expires_at,p.customer_id AS pass_customer,l.cash_cents AS original_cash_cents,b.snapshot FROM stays s JOIN stay_pass_checkin_commits c ON c.stay_id=s.id JOIN stay_pass_booking_links l ON l.booking_id=c.booking_id JOIN stay_pass_booking_settlements b ON b.id=l.hold_operation_id JOIN stay_passes p ON p.id=l.pass_id WHERE s.id=?`).bind(input.stayId),
  db.prepare(`SELECT a.* FROM stay_pass_booking_allocations a JOIN stay_pass_checkin_commits c ON c.booking_id=a.booking_id WHERE c.stay_id=? ORDER BY a.dog_id,a.lot_id`).bind(input.stayId),
  db.prepare(`SELECT l.* FROM stay_pass_credit_lots l JOIN stay_pass_booking_links b ON b.pass_id=l.pass_id JOIN stay_pass_checkin_commits c ON c.booking_id=b.booking_id WHERE c.stay_id=? ORDER BY l.id`).bind(input.stayId),
  db.prepare(`SELECT d.id,d.name,sd.nightly_rate_cents FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=? ORDER BY d.id`).bind(input.stayId),
  db.prepare(`SELECT id,kind,payment_type,ROUND(amount*100) AS cents FROM transactions WHERE stay_id=? AND payment_type!='' ORDER BY id`).bind(input.stayId),
  db.prepare(`SELECT t.lot_id,SUM(t.delta_units) AS units,SUM(t.delta_reserved) AS reserved,SUM(t.delta_refund_held) AS refund_held FROM stay_pass_credit_transactions t JOIN stay_pass_booking_links b ON b.pass_id=t.pass_id JOIN stay_pass_checkin_commits c ON c.booking_id=b.booking_id WHERE c.stay_id=? GROUP BY t.lot_id`).bind(input.stayId),
  db.prepare(checkoutState).bind(input.stayId)
 ]);
 const row=records.results[0];if(!row)fail('not_found');if(row.status!=='checked_in'||row.cancelled_at)fail('not_checked_in');
 const original=await stayAgreement(db,row.id,row.booking_id,row.snapshot);if(!['overnight','daycare'].includes(original.service))fail('checkout_service_review_required');
 row.original_cash_cents=original.booking_cash_total_cents??row.original_cash_cents;
 if(row.customer_id!==row.pass_customer||Math.round(row.agreed_total*100)!==row.original_cash_cents||row.original_cash_cents!==original.settlement.cash_cents+(original.cancellation_cash_fees_cents??0)||row.charged_nights!==original.declared_quantity)fail('checkout_review_required');
 if(pets.results.length!==original.settlement.rows.length||pets.results.some(d=>!original.settlement.rows.some(r=>r.dog_id===d.id&&r.regular_rate_cents===d.nightly_rate_cents)))fail('checkout_review_required');
 if(lots.results.some(l=>{const t=ledger.results.find(t=>t.lot_id===l.id);return !t||l.remaining_units!==t.units||l.reserved_units!==t.reserved||l.refund_held_units!==t.refund_held;}))fail('ledger_mismatch');
 if(payments.results.some(t=>t.kind!=='income'||!Number.isSafeInteger(t.cents)||t.cents<0))fail('existing_payment_review_required');
 const preRefund=await stayCashRefunds(db,input.stayId),paid=payments.results.reduce((n,t)=>n+t.cents,0)-preRefund;let timing;if(original.service==='daycare'){
  if(input.quantity100!==undefined&&input.quantity100!==100)fail('daycare_single_visit_required');const d=daycareTiming(row.actual_checkin_at,input.actualCheckoutAt);
  timing={...d,actual_checkout_at:d.checkout_at,scheduled_checkout_at:original.checkout_at,suggested_quantity100:100,quantity100:100,quantity_overridden:false,early:d.checkout_at<original.checkout_at,extra_minutes:0,late_percent:0,service:'daycare'};
 }else timing=checkoutTiming({checkinAt:row.actual_checkin_at,scheduledCheckoutAt:original.checkout_at,actualCheckoutAt:input.actualCheckoutAt,originalQuantity100:row.charged_nights*100,quantity100:input.quantity100});
 const settlement=checkoutSettlement({timing,original:original.settlement,allocations:allocations.results,lots:lots.results,nowAt:now.toISOString(),passStatus:row.pass_status,paidCents:paid,extraAllocations:input.extraAllocations,fixedCashCents:original.cancellation_cash_fees_cents??0,service:original.service});
 const result={status:'ready',read_only:true,source_state:state.results[0].state,stay_id:row.id,pass_id:row.pass_id,pass_number:row.pass_number,booking_id:row.booking_id,pass_revision:row.pass_revision,timing,settlement,agreement_snapshot:original,original_agreement:{checkin_at:original.checkin_at,checkout_at:original.checkout_at,quantity100:row.charged_nights*100,cash_cents:row.original_cash_cents},warnings:[...(settlement.refund_review_cents?['cash_refund_review_required']:[]),...(settlement.expired_restored_units?['restored_credit_expired']:[])]};
 return {...result,quote_hash:await digest({...result,source:row,allocations:allocations.results,lots:lots.results,payments:payments.results})};
}

// One atomic batch owns the credit events, optional already-received cash, immutable agreement and closure.
export async function confirmPassCheckout(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 const allowed=['stayId','actualCheckoutAt','quantity100','extraAllocations','key','quoteHash','reason','amountCents','paymentDate','receivedTime','paymentMethod','reference','confirmed'];
 if(!input||Object.keys(input).some(k=>!allowed.includes(k))||input.confirmed!==true||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800||!Number.isSafeInteger(input.amountCents)||input.amountCents<0)fail('invalid_checkout_request');
 const key=actor.id+':checkout:'+input.key,hash=await digest(input);
 async function replay(){const r=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!r)return null;if(r.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(r.result),replayed:true};}
 const prior=await replay();if(prior)return prior;
 const quoteInput={stayId:input.stayId,actualCheckoutAt:input.actualCheckoutAt};if(input.quantity100!==undefined)quoteInput.quantity100=input.quantity100;if(input.extraAllocations!==undefined)quoteInput.extraAllocations=input.extraAllocations;
 const q=await quotePassCheckout(db,quoteInput,actor,now),s=q.settlement;
 if(q.quote_hash!==input.quoteHash)fail('checkout_confirmation_required');if(s.blockers.length)fail(s.blockers[0]);
 if(input.amountCents>s.balance_cents)fail('payment_exceeds');
 if(q.timing.actual_checkout_at>now.toISOString())fail('checkout_in_future');
 const {normalizePayment}=await import('../stay_payments.mjs');
 const payment=normalizePayment({amountCents:Math.max(1,input.amountCents),paymentDate:input.paymentDate,receivedTime:input.receivedTime,key:input.key},now);
 if(!payment||!['','cash','transfer','card','other'].includes(input.paymentMethod||'')||typeof (input.reference||'')!=='string'||(input.reference||'').length>200)fail('invalid_checkout_payment');
 const op=crypto.randomUUID(),at=now.toISOString(),checkoutDay=local(q.timing.actual_checkout_at).day;
 const lines=new Map();
 for(const r of s.restore_lines){const l=lines.get(r.lot_id)||{id:crypto.randomUUID(),lot_id:r.lot_id,delta:0,kind:'credit_restoration',dogs:[]};l.delta+=r.units;l.dogs.push({dog_id:r.dog_id,delta:-r.units});lines.set(r.lot_id,l);}
 for(const r of s.extra_lines){if(lines.has(r.lotId))fail('checkout_review_required');lines.set(r.lotId,{id:crypto.randomUUID(),lot_id:r.lotId,delta:-r.units,kind:'stay_consumption',dogs:r.dogUnits.map(d=>({dog_id:d.dog_id,delta:d.units}))});}
 const documentSettlement=bookingSettlement({baseUnits:(q.agreement_snapshot.service==='daycare'?q.timing.units_per_dog:q.timing.quantity100/25)*s.rows.length,latePercent:q.timing.late_percent,dogs:s.rows.map(r=>({id:r.dog_id,name:r.name,nightly_rate_cents:r.regular_rate_cents})),availableUnits:s.rows.reduce((n,r)=>n+r.after_covered_units,0),service:q.agreement_snapshot.service,allocations:s.rows.map(r=>({dog_id:r.dog_id,credit_units:r.after_covered_units}))});
 const changes=[...lines.values()],snapshot={...q,confirmed_at:at,amount_received_cents:input.amountCents,balance_after_cents:s.balance_cents-input.amountCents};
 try{
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,p.revision,'checkout_reconciliation',?,? FROM stay_passes p JOIN stay_pass_booking_links b ON b.pass_id=p.id JOIN stay_pass_checkin_commits c ON c.booking_id=b.booking_id JOIN stays st ON st.id=c.stay_id
   WHERE st.id=? AND p.revision=? AND st.status='checked_in' AND st.cancelled_at IS NULL AND ${adminGuard}
   AND (${checkoutState})=? AND NOT EXISTS(SELECT 1 FROM stay_pass_checkout_commits WHERE stay_id=st.id)
   ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,input.reason.trim(),at,input.stayId,q.pass_revision,...actorArgs(actor),input.stayId,q.source_state),
  db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,booking_id,stay_id,recorded_at)
   SELECT j.value->>'id',o.id,o.pass_id,l.id,j.value->>'kind',j.value->>'delta',0,0,l.remaining_units,l.remaining_units+(j.value->>'delta'),l.reserved_units,l.reserved_units,l.refund_held_units,l.refund_held_units,?,?,o.created_at FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' AND l.pass_id=o.pass_id WHERE o.id=?`).bind(q.booking_id,input.stayId,JSON.stringify(changes),op),
  db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at)
   SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,d.value->>'dog_id',0,d.value->>'delta',t.recorded_at FROM stay_pass_credit_transactions t JOIN json_each(?) j ON j.value->>'id'=t.id CROSS JOIN json_each(j.value->'dogs') d WHERE t.operation_id=?`).bind(JSON.stringify(changes),op),
  db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,reference,payment_type,payment_key,received_time)
   SELECT ?,'income','ค่าฝากเลี้ยง','ชำระวันรับกลับ Stay Pass',?/100.0,s.customer_id,s.id,?,?,'checkout',?,? FROM stays s WHERE s.id=? AND ?>0 AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(input.paymentDate,input.amountCents,input.paymentMethod||'',input.reference||'',key,payment.paidAt,input.stayId,input.amountCents,op),
  db.prepare(`INSERT INTO stay_pass_checkout_commits(stay_id,operation_id,quote_hash,snapshot,original_total_cents,total_cents,quantity100,checkout_day,actual_checkout_at,created_at)
   SELECT ?,id,?,?,?,?,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.stayId,q.quote_hash,JSON.stringify(snapshot),s.original_cash_cents,s.cash_cents,q.timing.quantity100,checkoutDay,q.timing.actual_checkout_at,op),
  db.prepare(`UPDATE stays SET status='completed',actual_checkout_at=?,checkout=?,charged_nights=?/100.0,agreed_total=?/100.0 WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.timing.actual_checkout_at,checkoutDay,q.timing.quantity100,s.cash_cents,input.stayId,op),
  db.prepare(`UPDATE boarding_charges SET details=json_set(details,'$.base_days',?,'$.checkout',?,'$.checkout_time',?,'$.extra_minutes',?,'$.percent',?,'$.base_cents',?,'$.fee_cents',?,'$.stay_pass.credit_units',?,'$.stay_pass.settlement',json(?),'$.stay_pass.checkout_reconciliation',json(?)) WHERE stay_id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.timing.quantity100/100,checkoutDay,local(q.timing.actual_checkout_at).time,q.timing.extra_minutes,q.timing.late_percent,documentSettlement.cash_cents-documentSettlement.late_cash_cents,documentSettlement.late_cash_cents,documentSettlement.covered_units,JSON.stringify(documentSettlement),JSON.stringify({...(q.timing.service==='daycare'?{daycare:q.timing}:{}),operation_id:op,original_agreement:q.original_agreement,actual_checkout_at:q.timing.actual_checkout_at,restored_units:s.restored_units,extra_covered_units:s.extra_covered_units,remaining_before_units:s.remaining_before_units,remaining_after_units:s.remaining_after_units,reserved_units:s.reserved_units,available_after_units:s.available_after_units,refund_review_cents:s.refund_review_cents,confirmed_at:at}),input.stayId,op),
  db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE WHEN status IN('active','fully_used') AND expires_at>? THEN CASE WHEN EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id AND remaining_units>0) THEN 'active' ELSE 'fully_used' END ELSE status END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(at,q.pass_id,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id)
   SELECT ?,'stay',?,'checkout_reconciliation',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),String(input.stayId),JSON.stringify(q.original_agreement),JSON.stringify(snapshot),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','completed','stayId',?,'passId',pass_id,'operationId',id,'restoredUnits',?,'extraCreditUnits',?,'balanceCents',?,'refundReviewCents',?,'remainingBeforeUnits',?,'remainingUnits',?,'availableUnits',?,'reservedUnits',?,'amountReceivedCents',?) WHERE id=?`).bind(input.stayId,s.restored_units,s.extra_covered_units,s.balance_cents-input.amountCents,s.refund_review_cents,s.remaining_before_units,s.remaining_after_units,s.available_after_units,s.reserved_units,input.amountCents,op)
 ]);
 return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
 }catch(error){if(/UNIQUE constraint failed: stay_pass_checkout_commits/.test(String(error)))return await replay()||{status:'conflict'};throw error;}
}
export async function checkoutHistory(db,passId,actor){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 if(typeof passId!=='string'||!passId||passId.length>100)fail('invalid_request');
 try{const {results}=await db.prepare(`SELECT c.stay_id,c.created_at,c.snapshot,c.original_total_cents,c.total_cents,c.actual_checkout_at FROM stay_pass_checkout_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE o.pass_id=? AND o.result IS NOT NULL ORDER BY c.created_at DESC,c.stay_id DESC LIMIT 25`).bind(passId).all();return {status:'ready',checkouts:results.map(r=>{const q=JSON.parse(r.snapshot);return {stay_id:r.stay_id,recorded_at:r.created_at,actual_checkout_at:r.actual_checkout_at,quantity100:q.timing.quantity100,restored_units:q.settlement.restored_units,extra_units:q.settlement.extra_covered_units,remaining_units:q.settlement.remaining_after_units,reserved_units:q.settlement.reserved_units,available_units:q.settlement.available_after_units,original_cash_cents:r.original_total_cents,cash_cents:r.total_cents,received_cents:q.amount_received_cents,balance_at_checkout_cents:q.balance_after_cents,refund_review_at_checkout_cents:q.settlement.refund_review_cents};})};}
 catch(error){if(/no such table.*stay_pass_checkout_commits/i.test(String(error)))return {status:'migration_required',checkouts:[]};throw error;}
}
