import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail,stamp} from './rules.mjs';
import {passDetail} from './read_models.mjs';
export async function lifecycleReview(db,passId,actor,now=new Date()){
 const view=await passDetail(db,passId,actor,now);if(view.status!=='ready')fail('not_found');if(!view.ledger_consistent)fail('ledger_mismatch');
 const [bookings,refunds,events,expiredEntries]=await db.batch([
  db.prepare(`SELECT DISTINCT a.id,a.status,a.stay_id,s.status AS stay_status FROM stay_pass_booking_links b JOIN appointments a ON a.id=b.booking_id LEFT JOIN stays s ON s.id=a.stay_id WHERE b.pass_id=? AND ((a.status='pending' AND a.stay_id IS NULL) OR s.status='checked_in') ORDER BY a.id`).bind(passId),
  db.prepare("SELECT id,status FROM stay_pass_refunds WHERE pass_id=? AND status IN('requested','approved') ORDER BY id").bind(passId),
  db.prepare('SELECT e.*,o.reason,o.actor_id FROM stay_pass_lifecycle_events e JOIN stay_pass_operations o ON o.id=e.id WHERE e.pass_id=? AND o.result IS NOT NULL ORDER BY e.created_at,e.id').bind(passId),
  db.prepare("SELECT t.id,t.lot_id,t.delta_units,t.delta_reserved,t.delta_refund_held FROM stay_pass_credit_transactions t WHERE t.pass_id=? AND t.kind='expiration' AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions r WHERE r.reversal_of=t.id) ORDER BY t.recorded_at,t.id").bind(passId)
 ]);
 const p=view.pass,at=now.toISOString(),active=['active','fully_used','expired'].includes(p.stored_status),common=[];
 if(!active)common.push('pass_status_review_required');if(refunds.results.length||p.refund_held_units)common.push('refund_pending');
 if(view.lots.some(l=>l.expires_at!==p.expires_at))common.push('lot_expiry_review_required');
 const expiration=[...common];if(p.expires_at>at)expiration.push('not_expired');if(bookings.results.length||p.reserved_units)expiration.push('open_booking_review_required');
 const extension=[...common];if(view.totals.expired_units)extension.push('expired_credit_restoration_review_required');
 const binding={pass_id:passId,revision:p.revision,status:p.stored_status,expires_at:p.expires_at,lots:view.lots,bookings:bookings.results,refunds:refunds.results,event_ids:events.results.map(r=>r.id),expired_entries:expiredEntries.results};
 return {status:'ready',pass_id:passId,pass_number:p.pass_number,customer:p.customer,revision:p.revision,expires_at:p.expires_at,remaining_units:p.remaining_units,reserved_units:p.reserved_units,expiration_blockers:expiration,extension_blockers:extension,restorable_expired_units:expiredEntries.results.reduce((n,r)=>n-r.delta_units,0),expired_entries:expiredEntries.results,bookings:bookings.results,refunds:refunds.results,history:events.results.map(({snapshot,...r})=>r),lots:view.lots,binding,quote_hash:await digest(binding)};
}
export async function confirmLifecycle(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 if(!input||Object.keys(input).some(k=>!['passId','kind','newExpiry','key','quoteHash','reason','confirmed','restoreExpired'].includes(k))||!['expiration','extension'].includes(input.kind)||input.confirmed!==true||input.kind==='expiration'&&input.restoreExpired===true||input.restoreExpired!==undefined&&typeof input.restoreExpired!=='boolean'||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_lifecycle');
 const key=actor.id+':lifecycle:'+input.key,hash=await digest(input);
 async function replay(){const o=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!o)return null;if(o.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(o.result),replayed:true};}
 const previous=await replay();if(previous)return previous;
 const q=await lifecycleReview(db,input.passId,actor,now);if(q.quote_hash!==input.quoteHash)fail('lifecycle_confirmation_required');
 const blockers=input.kind==='extension'?q.extension_blockers.filter(b=>b!=='expired_credit_restoration_review_required'||!input.restoreExpired):q.expiration_blockers;if(blockers.length)fail(blockers[0]);
 const at=now.toISOString(),newExpiry=input.kind==='extension'?stamp(input.newExpiry):q.expires_at;
 if(input.kind==='extension'&&(newExpiry<=q.expires_at||newExpiry<=at||newExpiry>new Date(now.getTime()+5*366*86400000).toISOString()))fail('invalid_expiry');
 const op=crypto.randomUUID(),expired=input.kind==='expiration'?q.remaining_units:input.restoreExpired?q.restorable_expired_units:0;
 // All source checks are repeated in the atomic write. No policy or price snapshot is edited.
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,p.revision,?,?,? FROM stay_passes p WHERE p.id=? AND p.revision=? AND p.expires_at=? AND p.status IN('active','fully_used','expired') AND ${adminGuard}
   AND NOT EXISTS(SELECT 1 FROM stay_pass_refunds WHERE pass_id=p.id AND status IN('requested','approved'))
   AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND (refund_held_units>0 OR expires_at!=p.expires_at))
   AND (?='extension' OR (p.expires_at<=? AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND reserved_units>0) AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links b JOIN appointments a ON a.id=b.booking_id LEFT JOIN stays s ON s.id=a.stay_id WHERE b.pass_id=p.id AND ((a.status='pending' AND a.stay_id IS NULL) OR s.status='checked_in'))))
   ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,input.kind==='extension'?'validity_extension':'expiration',input.reason.trim(),at,input.passId,q.revision,q.expires_at,...actorArgs(actor),input.kind,at),
  db.prepare(`INSERT INTO stay_pass_lifecycle_events(id,pass_id,kind,old_expiry,new_expiry,units,snapshot,created_at) SELECT id,pass_id,?,?,?,?,?,created_at FROM stay_pass_operations WHERE id=?`).bind(input.kind,q.expires_at,newExpiry,expired,JSON.stringify(q.binding),op),
  ...(input.kind==='extension'&&input.restoreExpired?[db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,reversal_of,recorded_at) SELECT lower(hex(randomblob(16))),o.id,o.pass_id,l.id,'reversal',-t.delta_units,0,0,l.remaining_units,l.remaining_units-t.delta_units,l.reserved_units,l.reserved_units,l.refund_held_units,l.refund_held_units,t.id,o.created_at FROM stay_pass_operations o CROSS JOIN json_each(?) j JOIN stay_pass_credit_transactions t ON t.id=j.value->>'id' JOIN stay_pass_credit_lots l ON l.id=t.lot_id WHERE o.id=? AND t.kind='expiration' AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions r WHERE r.reversal_of=t.id)`).bind(JSON.stringify(q.expired_entries),op)]:[]),
  ...(input.kind==='expiration'?[db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at)
   SELECT lower(hex(randomblob(16))),o.id,o.pass_id,l.id,'expiration',-l.remaining_units,0,0,l.remaining_units,0,0,0,0,0,o.created_at FROM stay_pass_operations o JOIN stay_pass_credit_lots l ON l.pass_id=o.pass_id WHERE o.id=? AND l.remaining_units>0 AND l.reserved_units=0 AND l.refund_held_units=0 AND l.expires_at<=o.created_at`).bind(op)]:[db.prepare('UPDATE stay_pass_credit_lots SET expires_at=? WHERE pass_id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)').bind(newExpiry,input.passId,op)]),
  db.prepare(`UPDATE stay_passes SET revision=revision+1,expires_at=?,status=CASE WHEN ?='expiration' THEN 'expired' WHEN EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id AND remaining_units>0) THEN 'active' ELSE 'fully_used' END WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)`).bind(newExpiry,input.kind,input.passId,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id) SELECT ?,'pass',pass_id,kind,actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),JSON.stringify(q.binding),JSON.stringify({old_expiry:q.expires_at,new_expiry:newExpiry,expired_units:input.kind==='expiration'?expired:0,restored_units:input.kind==='extension'?expired:0}),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','passId',pass_id,'operationId',id,'kind',?,'expiredUnits',?,'restoredUnits',?,'expiresAt',?) WHERE id=?`).bind(input.kind,input.kind==='expiration'?expired:0,input.kind==='extension'?expired:0,newExpiry,op)
 ]);
 return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
}
// Scheduled callers must supply an existing authorized administrator. No system identity is created.
export async function processExpirations(db,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
 const candidate="p.expires_at<=? AND p.status IN('active','fully_used','expired') AND (p.status!='expired' OR EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND remaining_units>0))";
 const eligible="NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND (reserved_units>0 OR refund_held_units>0 OR expires_at!=p.expires_at)) AND NOT EXISTS(SELECT 1 FROM stay_pass_refunds WHERE pass_id=p.id AND status IN('requested','approved')) AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links b JOIN appointments a ON a.id=b.booking_id LEFT JOIN stays s ON s.id=a.stay_id WHERE b.pass_id=p.id AND ((a.status='pending' AND a.stay_id IS NULL) OR s.status='checked_in'))";
 const [ready,blocked]=await db.batch([db.prepare(`SELECT p.id FROM stay_passes p WHERE ${candidate} AND (${eligible}) ORDER BY p.expires_at,p.id LIMIT 50`).bind(now.toISOString()),db.prepare(`SELECT p.id FROM stay_passes p WHERE ${candidate} AND NOT (${eligible}) ORDER BY p.expires_at,p.id LIMIT 50`).bind(now.toISOString())]);
 const processed=[],review=[];for(const p of [...ready.results,...blocked.results]){try{const q=await lifecycleReview(db,p.id,actor,now);if(q.expiration_blockers.length){review.push({passId:p.id,blockers:q.expiration_blockers});continue;}const digestKey=(await digest({pass:p.id,expiry:q.expires_at,revision:q.revision})).slice(0,32);processed.push(await confirmLifecycle(db,{passId:p.id,kind:'expiration',key:digestKey,quoteHash:q.quote_hash,reason:'Scheduled expiry at the stored package validity; open bookings and refunds are excluded',confirmed:true},actor,now));}catch(error){if(!error.code)throw error;review.push({passId:p.id,blockers:[error.code]});}}
 return {status:'ready',processed,review,limit:50,as_of:now.toISOString()};
}
