import {adminGuard,actorArgs,digest} from './repository.mjs';
import {quoteSale,recordPaidSale} from './sales.mjs';
import {fail} from './rules.mjs';
async function access(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export async function saleDrafts(db,planId,actor){await access(db,actor);if(typeof planId!=='string'||!planId||planId.length>100)fail('invalid_draft');const rows=await db.prepare(`SELECT d.id,d.status,d.revision,d.created_at,d.reason,d.selection,d.quoted_snapshot,d.paid_pass_id,c.name customer,p.pass_number FROM stay_pass_sale_drafts d JOIN customers c ON c.id=d.customer_id LEFT JOIN stay_passes p ON p.id=d.paid_pass_id WHERE d.plan_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 100`).bind(planId).all();return {status:'ready',drafts:rows.results.map(({selection,quoted_snapshot,...r})=>({...r,selection:JSON.parse(selection),original_quote:JSON.parse(quoted_snapshot)}))};}
export async function saveSaleDraft(db,input,actor,now=new Date()){
 await access(db,actor);if(!input||Object.keys(input).some(k=>!['planId','customerId','size','dogIds','quoteHash','reason','key'].includes(k))||!/^[a-f0-9]{32}$/.test(input.key||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_draft');
 const key=actor.id+':draft:'+input.key,hash=await digest(input);const old=await db.prepare('SELECT id,request_hash FROM stay_pass_sale_drafts WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(old){if(old.request_hash!==hash)fail('idempotency_conflict');return {status:'saved',draftId:old.id,replayed:true};}
 const q=await quoteSale(db,input,actor,now);if(q.quote_hash!==input.quoteHash)fail('price_confirmation_required');const id=crypto.randomUUID(),at=now.toISOString(),selection={planId:input.planId,customerId:input.customerId,size:input.size,dogIds:[...input.dogIds].sort((a,b)=>a-b)};
 const result=await db.batch([
 db.prepare(`INSERT INTO stay_pass_sale_drafts(id,plan_id,customer_id,selection,quoted_snapshot,created_at,actor_id,request_key,request_hash,reason) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${adminGuard} ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(id,input.planId,input.customerId,JSON.stringify(selection),JSON.stringify(q.snapshot),at,actor.id,key,hash,input.reason.trim(),...actorArgs(actor)),
 db.prepare(`INSERT INTO stay_pass_sale_draft_events(id,draft_id,actor_id,kind,created_at,reason,snapshot) SELECT ?,id,actor_id,'created',created_at,reason,quoted_snapshot FROM stay_pass_sale_drafts WHERE id=?`).bind(crypto.randomUUID(),id),
 db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data) SELECT ?,'sale_draft',id,'sale_draft_created',actor_id,created_at,reason,selection FROM stay_pass_sale_drafts WHERE id=?`).bind(crypto.randomUUID(),id)
 ]);if(result[0].meta.changes===1)return {status:'saved',draftId:id};const row=await db.prepare('SELECT id,request_hash FROM stay_pass_sale_drafts WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(row?.request_hash!==hash)fail('idempotency_conflict');return row?{status:'saved',draftId:row.id,replayed:true}:{status:'conflict'};
}
export async function quoteDraftPayment(db,draftId,actor,now=new Date()){
 await access(db,actor);if(!validId(draftId))fail('invalid_draft');const d=await db.prepare('SELECT * FROM stay_pass_sale_drafts WHERE id=?').bind(draftId).first();if(!d)fail('not_found');if(d.status!=='pending_payment')fail('draft_not_pending');const selection=JSON.parse(d.selection),quote=await quoteSale(db,selection,actor,now);return {...quote,draft:{id:d.id,revision:d.revision,selection,original_quote:JSON.parse(d.quoted_snapshot)},draft_quote_hash:await digest({draftId:d.id,revision:d.revision,quoteHash:quote.quote_hash})};
}
export async function cancelSaleDraft(db,input,actor,now=new Date()){
 await access(db,actor);if(!input||Object.keys(input).some(k=>!['draftId','revision','reason','confirmed'].includes(k))||!validId(input.draftId)||!Number.isSafeInteger(input.revision)||input.revision<1||input.confirmed!==true||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_draft');
 const at=now.toISOString(),eventId=crypto.randomUUID();const result=await db.batch([
 db.prepare(`UPDATE stay_pass_sale_drafts SET status='cancelled',revision=revision+1 WHERE id=? AND revision=? AND status='pending_payment' AND ${adminGuard}`).bind(input.draftId,input.revision,...actorArgs(actor)),
 db.prepare(`INSERT INTO stay_pass_sale_draft_events(id,draft_id,actor_id,kind,created_at,reason,snapshot) SELECT ?,id,?,'cancelled',?,?,json_object('revision',revision) FROM stay_pass_sale_drafts WHERE id=? AND revision=? AND status='cancelled' AND NOT EXISTS(SELECT 1 FROM stay_pass_sale_draft_events WHERE draft_id=? AND kind='cancelled')`).bind(eventId,actor.id,at,input.reason.trim(),input.draftId,input.revision+1,input.draftId),
 db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data) SELECT ?,'sale_draft',draft_id,'sale_draft_cancelled',actor_id,created_at,reason,snapshot FROM stay_pass_sale_draft_events WHERE id=?`).bind(crypto.randomUUID(),eventId)
 ]);return result[0].meta.changes===1?{status:'saved',draftId:input.draftId}:{status:'conflict'};
}
export async function recordDraftPayment(db,input,actor,now=new Date()){
 await access(db,actor);if(!input||!/^[a-f0-9]{32}$/.test(input.key||'')||!validId(input.draftId)||!/^[a-f0-9]{64}$/.test(input.draftQuoteHash||''))fail('invalid_draft');
 const d=await db.prepare('SELECT * FROM stay_pass_sale_drafts WHERE id=?').bind(input.draftId).first();if(!d)fail('not_found');const hash=await digest(input);if(d.status==='paid'){if(d.payment_hash!==hash)fail('draft_already_paid');return {...JSON.parse(d.payment_result),replayed:true};}if(d.status!=='pending_payment')fail('draft_not_pending');
 const q=await quoteDraftPayment(db,d.id,actor,now);if(q.draft_quote_hash!==input.draftQuoteHash)fail('draft_confirmation_required');const {draftId,draftQuoteHash,...payment}=input;for(const k of ['planId','customerId','size','dogIds'])if(JSON.stringify(payment[k])!==JSON.stringify(q.draft.selection[k]))fail('invalid_draft');
 payment.key=(await digest({draftId:d.id,key:payment.key})).slice(0,32);
 const result=await recordPaidSale(db,payment,actor,now,{
  guardSql:`AND EXISTS(SELECT 1 FROM stay_pass_sale_drafts WHERE id=? AND revision=? AND status='pending_payment')`,guardParams:[d.id,d.revision],
  statements:({passId,passNumber,at})=>[
   db.prepare(`UPDATE stay_pass_sale_drafts SET status='paid',revision=revision+1,paid_pass_id=?,payment_hash=?,payment_result=? WHERE id=? AND revision=? AND status='pending_payment' AND EXISTS(SELECT 1 FROM stay_passes WHERE id=?)`).bind(passId,hash,JSON.stringify({status:'saved',passId,passNumber,draftId:d.id}),d.id,d.revision,passId),
   db.prepare(`INSERT INTO stay_pass_sale_draft_events(id,draft_id,actor_id,kind,created_at,reason,snapshot) SELECT ?,id,?,'paid',?,?,json_object('passId',paid_pass_id,'price',json(?),'original',json(quoted_snapshot)) FROM stay_pass_sale_drafts WHERE id=? AND paid_pass_id=?`).bind(crypto.randomUUID(),actor.id,at,payment.reason,JSON.stringify(q.snapshot),d.id,passId)
  ]
 });return result.status==='saved'?{...result,draftId:d.id}:result;
}
