// Refund orchestration. Browser writes require the explicit development/staging gate.
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail,stamp,changeOfMindRefund,refundValueSlice,refundDeadline,thaiDay} from './rules.mjs';
const kinds=new Set(['change_of_mind','death','serious_illness','force_majeure','shop_unavailable','shop_closure','legal']);
async function access(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
function request(input){if(!input||!/^[a-f0-9]{32}$/.test(input.key||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800)fail('invalid_refund');}
async function replay(db,key,hash,actor){const op=await db.prepare(`SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=? AND ${adminGuard}`).bind(actor.id,key,...actorArgs(actor)).first();if(!op)return null;if(op.request_hash!==hash)fail('idempotency_conflict');if(!op.result)fail('operation_in_progress');return {...JSON.parse(op.result),replayed:true};}
function root(db,{op,passId,revision,key,hash,kind,reason,at,extra='',params=[]},actor){return db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
 SELECT ?,p.id,?,?,?,?,?,?,? FROM stay_passes p WHERE p.id=? AND p.revision=? AND ${adminGuard} ${extra}`)
 .bind(op,actor.id,key,hash,revision,kind,reason.trim(),at,passId,revision,...actorArgs(actor),...params);}
const marker='EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)';
function ledger(db,{op,passId,lot,kind,units=0,held=0,at}){return db.prepare(`INSERT INTO stay_pass_credit_transactions
 (id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at)
 SELECT ?,o.id,o.pass_id,l.id,?,?,0,?,l.remaining_units,l.remaining_units+?,l.reserved_units,l.reserved_units,l.refund_held_units,l.refund_held_units+?,?
 FROM stay_pass_operations o JOIN stay_pass_credit_lots l ON l.pass_id=o.pass_id WHERE o.id=? AND o.pass_id=? AND l.id=?`)
 .bind(crypto.randomUUID(),kind,units,held,units,held,at,op,passId,lot);}
function finish(db,{op,passId,at,action,before,after,refundId,status}){return [
 db.prepare(`UPDATE stay_passes SET revision=revision+1,status=CASE
  WHEN COALESCE((SELECT SUM(remaining_units) FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id),0)=0 THEN ?
  WHEN COALESCE((SELECT SUM(remaining_units-refund_held_units) FROM stay_pass_credit_lots WHERE pass_id=stay_passes.id),0)=0 THEN 'refund_pending'
  WHEN expires_at<=? THEN 'expired' ELSE 'active' END WHERE id=? AND ${marker}`)
  .bind(status==='paid'?'refunded':'fully_used',at,passId,op),
 db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id)
 SELECT ?,'refund',?,?,o.actor_id,o.created_at,o.reason,?,?,o.id FROM stay_pass_operations o WHERE o.id=?`)
  .bind(crypto.randomUUID(),refundId,action,JSON.stringify(before),JSON.stringify(after),op),
 db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','refundId',?,'refundStatus',?,'revision',expected_revision+1) WHERE id=?`)
  .bind(refundId,status,op)
 ];}

export async function quoteRefund(db,input,actor,now=new Date()){
 await access(db,actor);
 if(!input||typeof input.passId!=='string'||!kinds.has(input.kind)||!Number.isSafeInteger(input.units)||input.units<1)fail('invalid_refund');
 const requestedAt=stamp(input.requestedAt),at=now.toISOString();if(requestedAt>at)fail('invalid_request_time');
 const [p,lots,pay,history,pending]=await db.batch([
  db.prepare(`SELECT * FROM stay_passes WHERE id=? AND ${adminGuard}`).bind(input.passId,...actorArgs(actor)),
  db.prepare('SELECT * FROM stay_pass_credit_lots WHERE pass_id=? ORDER BY created_at,id').bind(input.passId),
  db.prepare(`SELECT l.*,COALESCE((SELECT SUM(amount_cents) FROM stay_pass_payment_links f WHERE f.original_link_id=l.id AND f.purpose='refund'),0) AS refunded_cents FROM stay_pass_payment_links l WHERE l.pass_id=? AND l.purpose='sale'`).bind(input.passId),
  db.prepare(`SELECT t.kind,t.delta_units,original.kind AS original_kind FROM stay_pass_credit_transactions t LEFT JOIN stay_pass_credit_transactions original ON original.id=t.reversal_of WHERE t.pass_id=?`).bind(input.passId),
  db.prepare(`SELECT id,status,units FROM stay_pass_refunds WHERE pass_id=? AND status IN('requested','approved')`).bind(input.passId)
 ]);
 const pass=p.results[0];if(!pass)fail('not_found');
 if(['pending_payment','cancelled','refunded'].includes(pass.status))fail('pass_unavailable');
 if(requestedAt<pass.purchase_at)fail('invalid_request_time');
 if(pending.results.length)return {status:'refund_already_pending',refundId:pending.results[0].id};
 if(lots.results.some(l=>l.reserved_units>0||l.refund_held_units>0))return {status:'booking_review_required'};
 const purchased=lots.results.filter(l=>l.source_kind==='purchase'),payment=pay.results[0];
 if(purchased.length!==1||pay.results.length!==1)return {status:'refund_source_review_required'};
 const lot=purchased[0],snapshot=JSON.parse(pass.snapshot),available=lot.remaining_units-lot.reserved_units-lot.refund_held_units;
 if(lot.origin_value_cents!==snapshot.paid_cents||lot.issued_units!==snapshot.credit_units||payment.amount_cents!==snapshot.paid_cents)fail('refund_source_mismatch');
 if(input.units>available)fail('refund_credit_exceeded');
 let used=0,deducted=0;
 for(const row of history.results){const kind=row.kind==='reversal'?row.original_kind:row.kind;if(['stay_consumption','daycare_consumption'].includes(kind))used-=row.delta_units;if(['cancellation_deduction','no_show_deduction'].includes(kind))deducted-=row.delta_units;}
 if(used<0||deducted<0)fail('ledger_mismatch');
 const previous=await db.prepare(`SELECT COALESCE(SUM(units),0) units FROM stay_pass_refunds WHERE lot_id=? AND status='paid'`).bind(lot.id).first();
 let amount=refundValueSlice(lot.origin_value_cents,lot.issued_units,previous.units,previous.units+input.units);
 if(input.kind==='change_of_mind'){
  const eligibility=changeOfMindRefund({purchasedAt:pass.purchase_at,requestedAt,usedUnits:used,deductionUnits:deducted,paidCents:snapshot.paid_cents});
  if(!eligibility.eligible)return {status:'ineligible',reason:eligibility.reason};
  if(previous.units||payment.refunded_cents)return {status:'ineligible',reason:'already_refunded'};
  if(input.units!==lot.issued_units||available!==lot.issued_units)fail('full_refund_required');
  amount=eligibility.refund_cents;
 }
 if(amount>payment.amount_cents-payment.refunded_cents)fail('refund_money_exceeded');
 const carry=lots.results.filter(l=>l.source_kind==='carry_forward').reduce((n,l)=>n+l.remaining_units,0);
 const q={pass_id:pass.id,pass_number:pass.pass_number,revision:pass.revision,pass_status:pass.status,expires_at:pass.expires_at,
  customer_id:pass.customer_id,kind:input.kind,requested_at:requestedAt,...refundDeadline(requestedAt),lot_id:lot.id,original_payment_link_id:payment.id,
  units:input.units,amount_cents:amount,carry_preserved_units:carry,remaining_units:lot.remaining_units,prior_refunded_units:previous.units,
  paid_cents:snapshot.paid_cents,refunded_cents:payment.refunded_cents,policy_version:snapshot.policy_version};
 return {status:'ready',...q,quote_hash:await digest(q)};
}

export async function requestRefund(db,input,actor,now=new Date()){
 request(input);await access(db,actor);
 if(typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>2000)fail('refund_evidence_required');
 const key=actor.id+':refund-request:'+input.key,hash=await digest(input),prior=await replay(db,key,hash,actor);if(prior)return prior;
 const q=await quoteRefund(db,input,actor,now);if(q.status!=='ready')return q;if(q.quote_hash!==input.quoteHash)fail('refund_confirmation_required');
 const op=crypto.randomUUID(),id=crypto.randomUUID(),at=now.toISOString();
 const result=await db.batch([
  root(db,{op,passId:q.pass_id,revision:q.revision,key,hash,kind:'refund_hold',reason:input.reason,at,
   extra:`AND p.status=? AND p.expires_at=? AND NOT EXISTS(SELECT 1 FROM stay_pass_refunds WHERE pass_id=p.id AND status IN('requested','approved'))
    AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND (reserved_units>0 OR refund_held_units>0))
    AND EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE id=? AND pass_id=p.id AND remaining_units=?)`,params:[q.pass_status,q.expires_at,q.lot_id,q.remaining_units]},actor),
  ledger(db,{op,passId:q.pass_id,lot:q.lot_id,kind:'refund_hold',held:q.units,at}),
  db.prepare(`INSERT INTO stay_pass_refunds(id,pass_id,lot_id,original_payment_link_id,request_operation_id,kind,units,amount_cents,requested_at,recorded_at,due_exclusive,reason,evidence,snapshot,status)
   SELECT ?,o.pass_id,?,?,o.id,?,?,?,?,?,?,?,?,?,'requested' FROM stay_pass_operations o WHERE o.id=?`)
   .bind(id,q.lot_id,q.original_payment_link_id,q.kind,q.units,q.amount_cents,q.requested_at,at,q.due_exclusive,input.reason.trim(),input.evidence.trim(),JSON.stringify(q),op),
  ...finish(db,{op,passId:q.pass_id,at,action:'refund_requested',before:q,after:{refundId:id,units:q.units,amount_cents:q.amount_cents,carry_preserved_units:q.carry_preserved_units},refundId:id,status:'requested'})
 ]);
 return result[0].meta.changes===1?{status:'saved',refundId:id,refundStatus:'requested',revision:q.revision+1}:await replay(db,key,hash,actor)||{status:'conflict'};
}

async function record(db,id,actor){await access(db,actor);if(typeof id!=='string'||id.length>100)fail('invalid_refund');const row=await db.prepare(`SELECT r.*,p.revision AS pass_revision,p.expires_at AS pass_expiry,p.customer_id,l.remaining_units,l.reserved_units,l.refund_held_units
 FROM stay_pass_refunds r JOIN stay_passes p ON p.id=r.pass_id JOIN stay_pass_credit_lots l ON l.id=r.lot_id WHERE r.id=? AND ${adminGuard}`).bind(id,...actorArgs(actor)).first();if(!row)fail('not_found');return row;}
export async function actOnRefund(db,id,action,input,actor,now=new Date()){
 request(input);await access(db,actor);if(!['approve','reject','pay'].includes(action)||!Number.isSafeInteger(input.expectedRevision))fail('invalid_refund');
 const key=actor.id+':refund-'+action+':'+input.key,hash=await digest({refundId:id,action,...input}),prior=await replay(db,key,hash,actor);if(prior)return prior;
 const row=await record(db,id,actor);if(row.pass_revision!==input.expectedRevision)return {status:'conflict'};
 if(row.status==='paid')return {status:'already_paid',refundId:id};
 if(action==='approve'&&row.status!=='requested'||action==='pay'&&row.status!=='approved'||action==='reject'&&!['requested','approved'].includes(row.status))return {status:'refund_state_conflict'};
 const at=now.toISOString(),paidAt=action==='pay'?stamp(input.paidAt):null;
 if(action==='pay'&&(paidAt>at||paidAt<row.requested_at||!['cash','transfer'].includes(input.method)||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>2000||input.amountCents!==row.amount_cents))fail('invalid_refund_payment');
 const op=crypto.randomUUID(),kind=action==='approve'?'refund_approval':action==='reject'?'refund_release':'refund',status=action==='approve'?'approved':action==='reject'?'rejected':'paid';
 const writes=[root(db,{op,passId:row.pass_id,revision:row.pass_revision,key,hash,kind,reason:input.reason,at,
  extra:`AND p.expires_at=? AND EXISTS(SELECT 1 FROM stay_pass_refunds WHERE id=? AND status=?) AND EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE id=? AND remaining_units=? AND reserved_units=? AND refund_held_units=?)`,
  params:[row.pass_expiry,id,row.status,row.lot_id,row.remaining_units,row.reserved_units,row.refund_held_units]},actor)];
 const paymentId=action==='pay'&&row.amount_cents>0?crypto.randomUUID():null,cashKey='stay-pass-refund:'+id;
 if(action!=='approve')writes.push(ledger(db,{op,passId:row.pass_id,lot:row.lot_id,kind,units:action==='pay'?-row.units:0,held:-row.units,at}));
 if(paymentId){
  writes.push(db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,payment_method,reference,payment_type,payment_key,received_time)
   SELECT ?,'refund','Stay Pass','Stay Pass refund',?/100.0,p.customer_id,?,?,'',?,? FROM stay_passes p WHERE p.id=? AND ${marker}`)
   .bind(thaiDay(paidAt),row.amount_cents,input.method,input.evidence.trim(),cashKey,new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(paidAt)),row.pass_id,op),
   db.prepare(`INSERT INTO stay_pass_payment_links(id,pass_id,transaction_id,purpose,amount_cents,original_link_id,created_at)
    SELECT ?,o.pass_id,t.id,'refund',?,?,? FROM stay_pass_operations o JOIN transactions t ON t.payment_key=? AND t.kind='refund' WHERE o.id=?`)
    .bind(paymentId,row.amount_cents,row.original_payment_link_id,at,cashKey,op));
 }
 if(action==='approve')writes.push(db.prepare(`UPDATE stay_pass_refunds SET status='approved',approved_at=?,approved_by=? WHERE id=? AND ${marker}`).bind(at,actor.id,id,op));
 else if(action==='reject')writes.push(db.prepare(`UPDATE stay_pass_refunds SET status='rejected',closed_at=?,closed_by=?,close_reason=? WHERE id=? AND ${marker}`).bind(at,actor.id,input.reason.trim(),id,op));
 else writes.push(db.prepare(`UPDATE stay_pass_refunds SET status='paid',closed_at=?,closed_by=?,payment_operation_id=?,payment_link_id=?,paid_at=?,payment_method=?,payment_evidence=? WHERE id=? AND ${marker}`)
  .bind(at,actor.id,op,paymentId,paidAt,input.method,input.evidence.trim(),id,op));
 writes.push(...finish(db,{op,passId:row.pass_id,at,action:'refund_'+status,before:{status:row.status,units:row.units,amount_cents:row.amount_cents},after:{status,units:row.units,amount_cents:row.amount_cents},refundId:id,status}));
 const result=await db.batch(writes);
 return result[0].meta.changes===1?{status:'saved',refundId:id,refundStatus:status,revision:row.pass_revision+1}:await replay(db,key,hash,actor)||{status:'conflict'};
}

export async function refundList(db,input={},actor,now=new Date()){
 await access(db,actor);
 const offset=input.offset??0,passId=input.passId||'',status=input.status||'';
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000||typeof passId!=='string'||passId.length>100||!['','requested','approved','rejected','paid'].includes(status))fail('invalid_search');
 const at=now.toISOString();
 const {results}=await db.prepare(`SELECT r.id,r.pass_id,p.pass_number,c.name AS customer,r.kind,r.units,r.amount_cents,r.requested_at,r.recorded_at,r.due_exclusive,r.status,r.reason,r.approved_at,r.closed_at,r.paid_at,p.revision,
  CASE WHEN r.status IN('requested','approved') AND r.due_exclusive<=? THEN 'overdue'
   WHEN r.status IN('requested','approved') AND r.due_exclusive<=? THEN 'due_soon' ELSE '' END AS alert
  FROM stay_pass_refunds r JOIN stay_passes p ON p.id=r.pass_id JOIN customers c ON c.id=p.customer_id
  WHERE (?='' OR r.pass_id=?) AND (?='' OR r.status=?) AND ${adminGuard}
  ORDER BY CASE WHEN r.status IN('requested','approved') THEN 0 ELSE 1 END,r.due_exclusive,r.id LIMIT 26 OFFSET ?`)
 .bind(at,new Date(now.getTime()+3*86400000).toISOString(),passId,passId,status,status,...actorArgs(actor),offset).all();
 return {status:'ready',refunds:results.slice(0,25).map(row=>({...row,due_day:thaiDay(new Date(Date.parse(row.due_exclusive)-1).toISOString())})),next_offset:results.length>25?offset+25:null,as_of:at};
}
