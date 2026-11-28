// Development-only orchestration. Ordinary sale validation and payment writes are reused.
import {quoteSale,recordPaidSale} from './sales.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {balances} from './credits.mjs';
import {allocatableLots} from './lot_allocation.mjs';
import {fail} from './rules.mjs';
async function authorize(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
export async function quoteRenewal(db,input,actor,now=new Date()){
 await authorize(db,actor);if(typeof input?.oldPassId!=='string'||!input.oldPassId||input.oldPassId.length>100)fail('invalid_renewal');
 const old=await db.prepare('SELECT * FROM stay_passes WHERE id=?').bind(input.oldPassId).first();if(!old)fail('not_found');
 if(!['active','fully_used'].includes(old.status)||old.expires_at<=now.toISOString()||old.purchase_at>now.toISOString())fail('renewal_not_eligible');
 if(old.customer_id!==input.customerId)fail('invalid_customer');if(old.size!==input.size)fail('cross_size_renewal_review_required');
 if(await db.prepare('SELECT 1 FROM stay_pass_renewals WHERE old_pass_id=?').bind(old.id).first())fail('already_renewed');
 const credit=await balances(db,old.id);
 if(credit.reserved_units||credit.refund_held_units)fail('renewal_booking_review_required');
 if(await db.prepare("SELECT 1 FROM stay_pass_refunds WHERE pass_id=? AND status IN('requested','approved')").bind(old.id).first())fail('renewal_refund_review_required');
 // Also review checked-in bookings, which no longer have reservation holds.
 if(await db.prepare("SELECT 1 FROM stay_pass_booking_allocations a JOIN appointments b ON b.id=a.booking_id LEFT JOIN stays s ON s.id=b.stay_id WHERE a.pass_id=? AND (a.reserved_units>0 OR (a.consumed_units>0 AND s.status='checked_in' AND s.cancelled_at IS NULL))").bind(old.id).first())fail('renewal_booking_review_required');
 const sale=await quoteSale(db,input,actor,now),eligible=allocatableLots(credit.lots,now.toISOString(),null);
 if(eligible.some(l=>!['purchase','carry_forward'].includes(l.source_kind)))fail('renewal_source_review_required');
 let left=Math.min(12,eligible.reduce((n,l)=>n+l.available_units,0));const lines=[];
 for(const lot of eligible){const units=Math.min(left,lot.available_units);if(!units)break;
  const numerator=BigInt(lot.origin_value_cents)*BigInt(units),denominator=BigInt(lot.issued_units);
  // Preserve exact originating value. Fractional-satang provenance requires explicit review.
  if(numerator%denominator)fail('renewal_value_review_required');
  lines.push({source_lot_id:lot.id,source_kind:lot.source_kind,units,value_cents:Number(numerator/denominator),before_units:lot.remaining_units,source_expiry:lot.expires_at});left-=units;
 }
 const carried=lines.reduce((n,l)=>n+l.units,0);
 const q={old_pass_id:old.id,old_pass_number:old.pass_number,old_revision:old.revision,old_expires_at:old.expires_at,old_status:old.status,
  carried_units:carried,origin_value_cents:lines.reduce((n,l)=>n+l.value_cents,0),old_remaining_units:credit.remaining_units,old_excess_units:credit.remaining_units-carried,
  lines,sale_quote_hash:sale.quote_hash,new_expiry:sale.snapshot.expires_at,new_purchased_units:sale.snapshot.credit_units,
  rules_version:'1.5-owner-confirmed-20261127'};
 return {status:'ready',...q,sale,quote_hash:await digest(q)};
}
export async function recordRenewal(db,input,actor,now=new Date()){
 await authorize(db,actor);
 if(!input||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||''))fail('invalid_renewal');
 const requestHash=await digest(input),requestKey=actor.id+':renewal:'+input.key;
 const prior=await db.prepare(`SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=? AND ${adminGuard}`).bind(actor.id,requestKey,...actorArgs(actor)).first();
 if(prior){if(prior.request_hash!==requestHash)fail('idempotency_conflict');if(!prior.result)fail('operation_in_progress');return {...JSON.parse(prior.result),replayed:true};}
 const q=await quoteRenewal(db,input,actor,now);if(input.quoteHash!==q.quote_hash)fail('renewal_confirmation_required');
 const renewalId=crypto.randomUUID(),outOp=crypto.randomUUID(),inOp=crypto.randomUUID();
 const guardSql=`AND EXISTS(SELECT 1 FROM stay_passes old WHERE old.id=? AND old.revision=? AND old.customer_id=? AND old.size=? AND old.status=? AND old.expires_at=? AND old.expires_at>?
  AND NOT EXISTS(SELECT 1 FROM stay_pass_renewals WHERE old_pass_id=old.id)
  AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=old.id AND (reserved_units>0 OR refund_held_units>0))
  AND NOT EXISTS(SELECT 1 FROM stay_pass_refunds WHERE pass_id=old.id AND status IN('requested','approved'))
  AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_allocations a JOIN appointments b ON b.id=a.booking_id LEFT JOIN stays s ON s.id=b.stay_id WHERE a.pass_id=old.id AND (a.reserved_units>0 OR (a.consumed_units>0 AND s.status='checked_in' AND s.cancelled_at IS NULL))))`;
 const extension={guardSql,guardParams:[q.old_pass_id,q.old_revision,input.customerId,input.size,q.old_status,q.old_expires_at,now.toISOString()],statements:({passId,passNumber,at})=>{
  const lines=q.lines.map(l=>({...l,target_lot_id:crypto.randomUUID(),out_ledger_id:crypto.randomUUID(),in_ledger_id:crypto.randomUUID()})),json=JSON.stringify(lines);
  const marker='EXISTS(SELECT 1 FROM stay_passes WHERE id=?)';
  return [
   db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) SELECT ?,?,?,?, ?,?,'renewal_transfer_out',?,? WHERE ${marker}`)
    .bind(outOp,q.old_pass_id,actor.id,requestKey,requestHash,q.old_revision,input.reason.trim(),at,passId),
   db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) SELECT ?,id,?,?,?,1,'renewal_carry_forward',?,? FROM stay_passes WHERE id=?`)
    .bind(inOp,actor.id,requestKey+':in',requestHash,input.reason.trim(),at,passId),
   db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at)
    SELECT j.value->>'out_ledger_id',o.id,o.pass_id,l.id,'renewal_transfer_out',-(j.value->>'units'),0,0,l.remaining_units,l.remaining_units-(j.value->>'units'),l.reserved_units,l.reserved_units,l.refund_held_units,l.refund_held_units,?
    FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'source_lot_id' AND l.pass_id=o.pass_id WHERE o.id=?`)
    .bind(at,json,outOp),
   db.prepare(`INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,source_lot_id,issued_units,origin_value_cents,expires_at,created_at)
    SELECT j.value->>'target_lot_id',p.id,'carry_forward',j.value->>'source_lot_id',j.value->>'units',j.value->>'value_cents',p.expires_at,? FROM stay_passes p CROSS JOIN json_each(?) j WHERE p.id=?`)
    .bind(at,json,passId),
   db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at)
    SELECT j.value->>'in_ledger_id',o.id,o.pass_id,l.id,'renewal_carry_forward',l.issued_units,0,0,0,l.issued_units,0,0,0,0,? FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_lots l ON l.id=j.value->>'target_lot_id' AND l.pass_id=o.pass_id WHERE o.id=?`)
    .bind(at,json,inOp),
   db.prepare(`INSERT INTO stay_pass_renewals(id,old_pass_id,new_pass_id,source_operation_id,target_operation_id,carried_units,origin_value_cents,old_excess_units,snapshot,recorded_at,actor_id,reason)
    SELECT ?,?,?,?, ?,?,?,?,?,?,?,? WHERE ${marker}`)
    .bind(renewalId,q.old_pass_id,passId,outOp,inOp,q.carried_units,q.origin_value_cents,q.old_excess_units,JSON.stringify({...q,sale:undefined,lines}),at,actor.id,input.reason.trim(),passId),
   db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE WHEN (SELECT COALESCE(SUM(remaining_units),0) FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id)=0 THEN 'fully_used' ELSE 'active' END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(q.old_pass_id,outOp),
   db.prepare(`UPDATE stay_passes SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(passId,inOp),
   db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id)
    SELECT ?,'renewal',?,'renewal_completed',?,?,?,?,?,? WHERE ${marker}`)
    .bind(crypto.randomUUID(),renewalId,actor.id,at,input.reason.trim(),JSON.stringify(q),JSON.stringify({new_pass_id:passId,carried_units:q.carried_units,old_excess_units:q.old_excess_units,origin_value_cents:q.origin_value_cents}),outOp,passId),
   db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','renewalId',?,'passId',?,'passNumber',?,'oldPassId',?,'carriedUnits',?,'oldExcessUnits',?) WHERE id=?`)
    .bind(renewalId,passId,passNumber,q.old_pass_id,q.carried_units,q.old_excess_units,outOp),
   db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','renewalId',?,'revision',2) WHERE id=?`).bind(renewalId,inOp)
  ];
 }};
 const sale=await recordPaidSale(db,{...input,renewalQuoteHash:input.quoteHash,quoteHash:q.sale_quote_hash},actor,now,extension);
 if(sale.status!=='saved')return sale;
 const result=await db.prepare('SELECT result FROM stay_pass_operations WHERE id=?').bind(outOp).first();
 if(!result)return {status:'conflict'};return JSON.parse(result.result);
}

export async function renewalHistory(db,passId,actor){
 await authorize(db,actor);if(typeof passId!=='string'||!passId||passId.length>100)fail('invalid_renewal');
 const {results}=await db.prepare(`SELECT r.id,r.old_pass_id,r.new_pass_id,old.pass_number AS old_pass_number,fresh.pass_number AS new_pass_number,r.carried_units,r.origin_value_cents,r.old_excess_units,r.recorded_at,r.reason,old.expires_at AS old_expires_at,fresh.expires_at AS new_expires_at
  FROM stay_pass_renewals r JOIN stay_passes old ON old.id=r.old_pass_id JOIN stay_passes fresh ON fresh.id=r.new_pass_id
  WHERE (r.old_pass_id=? OR r.new_pass_id=?) AND ${adminGuard} ORDER BY r.recorded_at,r.id LIMIT 100`).bind(passId,passId,...actorArgs(actor)).all();
 return {status:'ready',renewals:results};
}
