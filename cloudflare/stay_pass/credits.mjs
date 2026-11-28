// Internal ledger service. It is deliberately NOT exposed as a browser write API.
// Sale/booking/refund orchestration must supply verified cash and allocation links first.
import {passBookingState} from './booking_state.mjs';
import {bookingSnapshot} from '../booking_warnings.mjs';
import {fail,stamp} from './rules.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
const kinds=new Set(['purchase','reservation_hold','reservation_release','stay_consumption','daycare_consumption','reversal']);
export async function balances(db,passId){
 const [lots,ledger]=await db.batch([
  db.prepare(`SELECT id,source_kind,issued_units,remaining_units,reserved_units,refund_held_units,origin_value_cents,expires_at FROM stay_pass_credit_lots WHERE pass_id=? ORDER BY expires_at,id`).bind(passId),
  db.prepare(`SELECT lot_id,SUM(delta_units) AS remaining_units,SUM(delta_reserved) AS reserved_units,SUM(delta_refund_held) AS refund_held_units FROM stay_pass_credit_transactions WHERE pass_id=? GROUP BY lot_id`).bind(passId)
 ]);
 const totals={remaining_units:0,reserved_units:0,refund_held_units:0,available_units:0};
 for(const l of lots.results){const t=ledger.results.find(r=>r.lot_id===l.id)||{remaining_units:0,reserved_units:0,refund_held_units:0};
  for(const key of ['remaining_units','reserved_units','refund_held_units']){if(l[key]!==t[key])fail('ledger_mismatch');totals[key]+=l[key];}}
 totals.available_units=totals.remaining_units-totals.reserved_units-totals.refund_held_units;return {...totals,lots:lots.results};
}
export async function applyCreditOperation(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(!input||!kinds.has(input.kind)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||
  !/^[a-f0-9]{32}$/.test(input.key||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800||
  !Array.isArray(input.lines)||input.lines.length<1||input.lines.length>30||new Set(input.lines.map(l=>l.lotId)).size!==input.lines.length)fail('invalid_credit_operation');
 const source=await db.prepare('SELECT * FROM stay_passes WHERE id=?').bind(input.passId).first();if(!source)fail('not_found');
 const hash=await digest(input),key=actor.id+':credit:'+input.key;
 async function replay(){const op=await db.prepare(`SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=? AND ${adminGuard}`).bind(actor.id,key,...actorArgs(actor)).first();if(!op)return null;if(op.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(op.result),replayed:true};}
 const previous=await replay();if(previous)return previous;
 const rows=[];
 for(const line of input.lines){
  if(typeof line.lotId!=='string')fail('invalid_credit_operation');let delta=0,reserved=0,refund=0,original=null;const dogIds=line.dogIds??(line.dogId?[line.dogId]:[]);if(!Array.isArray(dogIds)||dogIds.length>30||dogIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(dogIds).size!==dogIds.length)fail('allocation_reference_required');
  if(input.kind==='reversal'){
   original=await db.prepare('SELECT * FROM stay_pass_credit_transactions WHERE id=? AND pass_id=? AND lot_id=? AND kind!=?').bind(line.reversalOf,input.passId,line.lotId,'reversal').first();
   if(!original)fail('invalid_reversal');delta=-original.delta_units;reserved=-original.delta_reserved;refund=-original.delta_refund_held;
  }else{
   if(!Number.isSafeInteger(line.units)||line.units<=0)fail('invalid_credit_operation');
   if(input.kind==='purchase')delta=line.units;
   if(input.kind==='reservation_hold')reserved=line.units;
   if(input.kind==='reservation_release')reserved=-line.units;
   if(['stay_consumption','daycare_consumption'].includes(input.kind)){delta=-line.units;reserved=-line.units;}
  }
  if(['reservation_hold','stay_consumption','daycare_consumption'].includes(input.kind)){
   if(!dogIds.length||!Number.isSafeInteger(line.bookingId)||line.bookingId<1||(!line.dogUnits&&line.units%dogIds.length))fail('allocation_reference_required');
   for(const dogId of dogIds){
   const dog=await db.prepare(`SELECT d.id FROM dogs d JOIN stay_pass_pets pp ON pp.dog_id=d.id AND pp.pass_id=? JOIN appointments a ON a.id=?
    JOIN appointment_dogs ad ON ad.appointment_id=a.id AND ad.dog_id=d.id WHERE d.id=? AND d.customer_id=? AND a.customer_id=? AND d.size=? AND d.archived=0`).bind(input.passId,line.bookingId,dogId,source.customer_id,source.customer_id,source.size).first();
   if(!dog)fail('ineligible_pet');
   if(input.kind!=='reservation_hold'){
    const stay=await db.prepare(`SELECT s.id FROM stays s JOIN stay_dogs sd ON sd.stay_id=s.id AND sd.dog_id=? JOIN appointments a ON a.stay_id=s.id AND a.id=? WHERE s.id=? AND s.customer_id=? AND s.status='checked_in' AND s.cancelled_at IS NULL`).bind(dogId,line.bookingId,line.stayId,source.customer_id).first();if(!stay)fail('allocation_reference_required');
   }
   }
  }
  if(input.kind==='reservation_release'&&(!dogIds.length||!Number.isSafeInteger(line.bookingId)||(!line.dogUnits&&line.units%dogIds.length)))fail('allocation_reference_required');
  const dogUnits=line.dogUnits??dogIds.map(dogId=>({dog_id:dogId,units:line.units/dogIds.length}));
  if(input.kind!=='reversal'&&dogIds.length&&(!Array.isArray(dogUnits)||dogUnits.length!==dogIds.length||dogUnits.some(d=>!d||typeof d!=='object')||new Set(dogUnits.map(d=>d.dog_id)).size!==dogIds.length||dogUnits.some(d=>!dogIds.includes(d.dog_id)||!Number.isSafeInteger(d.units)||d.units<=0)||dogUnits.reduce((n,d)=>n+d.units,0)!==line.units))fail('invalid_credit_allocation');
  rows.push({id:crypto.randomUUID(),lot_id:line.lotId,delta,reserved,refund,booking:original?.booking_id??line.bookingId??null,stay:original?.stay_id??line.stayId??null,dog:original?.dog_id??(dogIds.length===1?dogIds[0]:null),dogs:dogIds,dog_units:dogUnits,reversal:line.reversalOf||null});
 }
 const guard=input.bookingGuard??null;if(guard&&(input.kind!=='reservation_hold'||!Number.isSafeInteger(guard.bookingId)||(guard.revision!==null&&typeof guard.revision!=='string')||typeof guard.snapshot!=='string'||(guard.financialSnapshot!==undefined&&typeof guard.financialSnapshot!=='string')||!Array.isArray(guard.params)||guard.params.length!==8))fail('invalid_booking_guard');
 if(guard&&rows.some(row=>row.booking!==guard.bookingId))fail('invalid_booking_guard');
 if(input.intentHash&&!/^[a-f0-9]{64}$/.test(input.intentHash))fail('invalid_booking_guard');
 if(input.convertBooking&&(!input.settlementSnapshot||!Number.isSafeInteger(input.settlementSnapshot.original_total_cents)||input.settlementSnapshot.original_total_cents<0))fail('invalid_pass_booking');
 if(input.settlementSnapshot&&(!guard||input.kind!=='reservation_hold'||input.settlementSnapshot.booking_id!==guard.bookingId||input.settlementSnapshot.pass_id!==input.passId))fail('invalid_pass_booking');
 const at=now.toISOString(),id=crypto.randomUUID(),requiresActive=input.kind!=='reservation_release'&&input.kind!=='reversal';
 if(input.kind==='reservation_hold'&&(!input.checkoutAt||stamp(input.checkoutAt)>=source.expires_at))fail('stay_crosses_expiry');
 // An active marker gates every mutation; a lost revision race produces no writes.
 const writes=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,?,?,?,? FROM stay_passes p WHERE p.id=? AND p.revision=? AND ${adminGuard}
   AND (?=0 OR (p.status='active' AND p.expires_at>?))
   AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' AND l.pass_id=p.id WHERE l.id IS NULL
    OR l.remaining_units+(j.value->>'delta')<0 OR l.remaining_units+(j.value->>'delta')>l.issued_units
    OR l.reserved_units+(j.value->>'reserved')<0 OR l.refund_held_units+(j.value->>'refund')<0
    OR l.reserved_units+(j.value->>'reserved')+l.refund_held_units+(j.value->>'refund')>l.remaining_units+(j.value->>'delta')
    OR (?=1 AND l.expires_at<=?) OR (?='reservation_hold' AND l.expires_at<=?)
    OR (?='purchase' AND (l.source_kind!='purchase' OR l.remaining_units!=0 OR (j.value->>'delta')!=l.issued_units)))
   AND (? NOT IN ('reservation_hold','stay_consumption','daycare_consumption') OR NOT EXISTS(
     SELECT 1 FROM json_each(?) j CROSS JOIN json_each(j.value->'dogs') chosen WHERE NOT EXISTS(
       SELECT 1 FROM dogs d JOIN stay_pass_pets pp ON pp.dog_id=d.id AND pp.pass_id=p.id
       JOIN appointments a ON a.id=j.value->>'booking' JOIN appointment_dogs ad ON ad.appointment_id=a.id AND ad.dog_id=d.id
       WHERE d.id=chosen.value AND d.customer_id=p.customer_id AND a.customer_id=p.customer_id AND d.size=p.size AND d.archived=0)))
   AND (? NOT IN ('stay_consumption','daycare_consumption') OR NOT EXISTS(
     SELECT 1 FROM json_each(?) j CROSS JOIN json_each(j.value->'dogs') chosen WHERE NOT EXISTS(
       SELECT 1 FROM stays s JOIN stay_dogs sd ON sd.stay_id=s.id AND sd.dog_id=chosen.value
       JOIN appointments a ON a.id=j.value->>'booking' AND a.stay_id=s.id
       WHERE s.id=j.value->>'stay' AND s.customer_id=p.customer_id AND s.status='checked_in' AND s.cancelled_at IS NULL)))
   AND (?!='purchase' OR ((SELECT COALESCE(SUM(pl.amount_cents),0) FROM stay_pass_payment_links pl JOIN transactions t ON t.id=pl.transaction_id
     WHERE pl.pass_id=p.id AND pl.purpose='sale' AND t.kind='income')>=CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER)
     AND CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER)>0))
   AND (?=0 OR (EXISTS(SELECT 1 FROM appointments a WHERE a.id=? AND a.cloud_revision IS ? AND a.status='pending' AND a.stay_id IS NULL)
     AND (${bookingSnapshot})=? AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_allocations ba WHERE ba.booking_id=? AND (ba.reserved_units>0 OR ba.consumed_units>0))))
   AND (?=0 OR (${passBookingState})=?)
   ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(id,actor.id,key,hash,input.expectedRevision,input.kind,input.reason.trim(),at,input.passId,input.expectedRevision,...actorArgs(actor),+requiresActive,at,JSON.stringify(rows),+requiresActive,at,input.kind,input.checkoutAt?stamp(input.checkoutAt):at,input.kind,input.kind,JSON.stringify(rows),input.kind,JSON.stringify(rows),input.kind,+!!guard,guard?.bookingId??null,guard?.revision??null,...(guard?.params??Array(8).fill(null)),guard?.snapshot??'',guard?.bookingId??null,+!!guard?.financialSnapshot,guard?.bookingId??null,guard?.financialSnapshot??''),
  db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,
   before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,booking_id,stay_id,dog_id,reversal_of,recorded_at)
   SELECT j.value->>'id',o.id,o.pass_id,l.id,o.kind,j.value->>'delta',j.value->>'reserved',j.value->>'refund',l.remaining_units,l.remaining_units+(j.value->>'delta'),
   l.reserved_units,l.reserved_units+(j.value->>'reserved'),l.refund_held_units,l.refund_held_units+(j.value->>'refund'),j.value->>'booking',j.value->>'stay',j.value->>'dog',j.value->>'reversal',o.created_at
   FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'lot_id' WHERE o.id=?`).bind(JSON.stringify(rows),id),
  db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at)
   SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,chosen.value->>'dog_id',
    CASE WHEN t.delta_reserved<0 THEN -(chosen.value->>'units') WHEN t.delta_reserved>0 THEN chosen.value->>'units' ELSE 0 END,CASE WHEN t.delta_units<0 THEN chosen.value->>'units' ELSE 0 END,t.recorded_at
   FROM stay_pass_credit_transactions t JOIN json_each(?) j ON j.value->>'id'=t.id CROSS JOIN json_each(j.value->'dog_units') chosen
   WHERE t.operation_id=? AND t.kind IN('reservation_hold','reservation_release','stay_consumption','daycare_consumption')`).bind(JSON.stringify(rows),id),
  db.prepare(`INSERT INTO stay_pass_booking_credit_events(id,operation_id,ledger_id,pass_id,lot_id,booking_id,dog_id,reserved_delta,consumed_delta,recorded_at,reversal_of)
   SELECT lower(hex(randomblob(16))),t.operation_id,t.id,t.pass_id,t.lot_id,t.booking_id,e.dog_id,-e.reserved_delta,-e.consumed_delta,t.recorded_at,e.id
   FROM stay_pass_credit_transactions t JOIN stay_pass_booking_credit_events e ON e.ledger_id=t.reversal_of WHERE t.operation_id=? AND t.kind='reversal'`).bind(id),
  ...(input.settlementSnapshot?[db.prepare(`INSERT INTO stay_pass_booking_settlements(id,pass_id,booking_id,quote_hash,covered_units,cash_units,cash_cents,snapshot,created_at)
   SELECT id,pass_id,?,?,?,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.settlementSnapshot.booking_id,input.settlementSnapshot.quote_hash,input.settlementSnapshot.settlement.covered_units,input.settlementSnapshot.settlement.cash_units,input.settlementSnapshot.settlement.cash_cents,JSON.stringify(input.settlementSnapshot),id)]:[]),
  ...(input.convertBooking?[db.prepare(`INSERT INTO stay_pass_booking_links(booking_id,pass_id,hold_operation_id,original_total_cents,cash_cents,converted_revision,created_at)
   SELECT ?,pass_id,id,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.settlementSnapshot.booking_id,input.settlementSnapshot.original_total_cents,input.settlementSnapshot.settlement.cash_cents,crypto.randomUUID(),id),
   db.prepare(`UPDATE appointments SET agreed_total=(SELECT cash_cents/100.0 FROM stay_pass_booking_links WHERE booking_id=appointments.id),cloud_revision=(SELECT converted_revision FROM stay_pass_booking_links WHERE booking_id=appointments.id)
    WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(input.settlementSnapshot.booking_id,id)]:[]),
  db.prepare("UPDATE stay_passes SET revision=revision+1,status=CASE WHEN status IN('active','fully_used') AND expires_at>? THEN CASE WHEN COALESCE((SELECT SUM(remaining_units) FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id),0)>0 THEN 'active' ELSE 'fully_used' END ELSE status END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)").bind(at,input.passId,id),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id)
   SELECT ?,'pass',o.pass_id,o.kind,o.actor_id,o.created_at,o.reason,?,?,o.id FROM stay_pass_operations o WHERE o.id=?`).bind(crypto.randomUUID(),input.intentHash?JSON.stringify({booking_intent_hash:input.intentHash}):null,JSON.stringify(rows),id),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','operationId',id,'revision',expected_revision+1) WHERE id=?`).bind(id)
 ]);
 return writes[0].meta.changes===1?{status:'saved',operationId:id,revision:input.expectedRevision+1}:await replay()||{status:'conflict'};
}
