import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail} from './rules.mjs';
import {normalizePayment} from '../stay_payments.mjs';
import {cashRefundSources} from './booking_cash.mjs';
async function access(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
export const stayCashState=`SELECT json_object('stay',json_array(s.id,s.customer_id,s.status,s.cancelled_at,ROUND(s.agreed_total*100),s.actual_checkout_at),
 'checkout',c.operation_id,'cash',(SELECT json_group_array(json_array(id,kind,amount,payment_type,payment_key,customer_id,stay_id,occurred_on,received_time,payment_method,reference)) FROM (SELECT * FROM transactions WHERE stay_id=s.id ORDER BY id)),
 'records',(SELECT json_group_array(json_array(id,transaction_id,direction,amount_cents,reversal_of)) FROM (SELECT * FROM stay_pass_stay_cash_records WHERE stay_id=s.id ORDER BY created_at,id))) state FROM stays s JOIN stay_pass_checkout_commits c ON c.stay_id=s.id WHERE s.id=?`;
export async function stayCashReview(db,stayId,actor){
 await access(db,actor);if(!Number.isSafeInteger(stayId)||stayId<1)fail('invalid_stay_cash');
 const [stays,transactions,records,sources,state]=await db.batch([
  db.prepare(`SELECT s.*,c.total_cents,c.operation_id AS checkout_operation_id,o.pass_id,p.revision AS pass_revision,p.pass_number FROM stays s JOIN stay_pass_checkout_commits c ON c.stay_id=s.id JOIN stay_pass_operations o ON o.id=c.operation_id JOIN stay_passes p ON p.id=o.pass_id WHERE s.id=? AND o.result IS NOT NULL`).bind(stayId),
  db.prepare('SELECT *,ROUND(amount*100) cents FROM transactions WHERE stay_id=? ORDER BY id').bind(stayId),
  db.prepare(`SELECT r.*,t.occurred_on,t.received_time,t.payment_method,t.reference,o.reason FROM stay_pass_stay_cash_records r JOIN stay_pass_operations o ON o.id=r.id JOIN transactions t ON t.id=r.transaction_id WHERE r.stay_id=? AND o.result IS NOT NULL ORDER BY t.id`).bind(stayId),
  db.prepare(`SELECT x.* FROM stay_pass_stay_cash_sources x JOIN stay_pass_stay_cash_records r ON r.id=x.record_id WHERE r.stay_id=?`).bind(stayId),db.prepare(stayCashState).bind(stayId)
 ]);
 const s=stays.results[0];if(!s)fail('not_found');if(s.status!=='completed'||s.cancelled_at!==null||Math.round(s.agreed_total*100)!==s.total_cents)fail('cash_source_review_required');
 const tx=transactions.results;if(tx.some(t=>!['income','refund'].includes(t.kind)||t.customer_id!==s.customer_id||!Number.isSafeInteger(t.cents)||t.cents<0||Math.abs(t.amount*100-t.cents)>.00001||t.kind==='income'&&!t.payment_type))fail('cash_source_review_required');
 const receipts=tx.filter(t=>t.kind==='income').map(t=>({id:t.id,cents:t.cents})),received=receipts.reduce((n,t)=>n+t.cents,0),refunded=tx.filter(t=>t.kind==='refund').reduce((n,t)=>n+t.cents,0),net=received-refunded;
 if(!Number.isSafeInteger(net)||net<0)fail('cash_source_review_required');
 // Earlier partial-booking refunds have immutable source links of their own.
 const prior=await db.prepare(`SELECT x.transaction_id,x.amount_cents FROM stay_pass_booking_cash_refund_sources x JOIN stay_pass_booking_cash_records r ON r.id=x.record_id JOIN transactions t ON t.id=r.transaction_id WHERE t.stay_id=?`).bind(stayId).all();
 const allSources=[...prior.results,...sources.results];if(allSources.reduce((n,x)=>n+x.amount_cents,0)!==refunded)fail('cash_source_review_required');
 if(allSources.some(x=>!receipts.some(t=>t.id===x.transaction_id))||receipts.some(t=>allSources.filter(x=>x.transaction_id===t.id).reduce((n,x)=>n+x.amount_cents,0)>t.cents))fail('cash_source_review_required');
 const history=records.results.map(({snapshot,...r})=>({...r,reversible:!r.reversal_of&&!records.results.some(x=>x.reversal_of===r.id)&&r.id===records.results.at(-1)?.id}));
 const q={status:'ready',read_only:true,stay_id:stayId,pass_id:s.pass_id,pass_number:s.pass_number,pass_revision:s.pass_revision,customer_id:s.customer_id,checkout_at:s.actual_checkout_at,checkout_operation_id:s.checkout_operation_id,charge_cents:s.total_cents,received_cents:received,refunded_cents:refunded,net_received_cents:net,due_cents:Math.max(0,s.total_cents-net),refund_due_cents:Math.max(0,net-s.total_cents),receipts,refund_sources:allSources,history,source_state:state.results[0].state};
 return {...q,quote_hash:await digest(q)};
}
export async function recordStayCash(db,input,actor,now=new Date()){
 await access(db,actor);const fields=['stayId','direction','amountCents','paymentDate','receivedTime','method','evidence','reason','confirmed','key','quoteHash','reversalOf'];
 if(!input||Object.keys(input).some(k=>!fields.includes(k))||input.confirmed!==true||!['receive','refund'].includes(input.direction)||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||!['cash','transfer','card','other'].includes(input.method)||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>1000||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800||input.reversalOf!==undefined&&(typeof input.reversalOf!=='string'||input.reversalOf.length>100))fail('invalid_stay_cash');
 const payment=normalizePayment(input,now);if(!payment)fail('invalid_stay_cash');
 const key=actor.id+':stay-cash:'+input.key,hash=await digest(input);
 async function replay(){const row=await db.prepare('SELECT request_hash,result FROM stay_pass_operations WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(!row)return null;if(row.request_hash!==hash)fail('idempotency_conflict');return {...JSON.parse(row.result),replayed:true};}
 const previous=await replay();if(previous)return previous;
 const q=await stayCashReview(db,input.stayId,actor);if(q.quote_hash!==input.quoteHash)fail('stay_cash_confirmation_required');
 const reversal=input.reversalOf?q.history.find(r=>r.id===input.reversalOf):null;
 if(input.reversalOf){if(!reversal?.reversible||reversal.direction===input.direction||reversal.amount_cents!==input.amountCents)fail('cash_reversal_review_required');}
 else if(input.amountCents>(input.direction==='receive'?q.due_cents:q.refund_due_cents))fail(input.direction==='receive'?'cash_receipt_exceeded':'cash_refund_exceeded');
 const instant=Date.parse(input.paymentDate+'T'+payment.paidAt+':00+07:00');if(instant<Math.floor(Date.parse(reversal?.created_at||q.checkout_at)/60000)*60000||instant>now.getTime())fail('invalid_cash_date');
 const sources=input.direction==='refund'?cashRefundSources(q.receipts,q.refund_sources,input.amountCents):[],op=crypto.randomUUID(),at=now.toISOString(),net=q.net_received_cents+(input.direction==='receive'?input.amountCents:-input.amountCents);
 if(net<0)fail('cash_refund_exceeded');
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,p.revision,'stay_cash_followup',?,? FROM stay_passes p JOIN stay_pass_operations co ON co.pass_id=p.id JOIN stay_pass_checkout_commits c ON c.operation_id=co.id JOIN stays s ON s.id=c.stay_id WHERE s.id=? AND s.status='completed' AND s.cancelled_at IS NULL AND p.revision=? AND ${adminGuard} AND (${stayCashState})=? ON CONFLICT(actor_id,request_key) DO NOTHING`).bind(op,actor.id,key,hash,input.reason.trim(),at,input.stayId,q.pass_revision,...actorArgs(actor),input.stayId,q.source_state),
  db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,reference,payment_type,payment_key,received_time)
   SELECT ?,?,'ค่าฝากเลี้ยง',?,?/100.0,?,?,?,?,?,?,? FROM stay_pass_operations WHERE id=?`).bind(input.paymentDate,input.direction==='receive'?'income':'refund',reversal?'กลับรายการเงินหลังเช็กเอาต์ Stay Pass':input.direction==='receive'?'ชำระหลังเช็กเอาต์ Stay Pass':'คืนเงินส่วนเกินหลังเช็กเอาต์ Stay Pass',input.amountCents,q.customer_id,input.stayId,input.method,input.evidence.trim(),input.direction==='receive'?'additional':'',key,payment.paidAt,op),
  db.prepare(`INSERT INTO stay_pass_stay_cash_records(id,stay_id,transaction_id,direction,amount_cents,charge_cents,before_net_cents,after_net_cents,reversal_of,snapshot,created_at)
   SELECT o.id,?,t.id,?,?,?,?,?,?,?,o.created_at FROM stay_pass_operations o JOIN transactions t ON t.payment_key=o.request_key WHERE o.id=?`).bind(input.stayId,input.direction,input.amountCents,q.charge_cents,q.net_received_cents,net,input.reversalOf||null,JSON.stringify(q),op),
  db.prepare(`INSERT INTO stay_pass_stay_cash_sources(record_id,transaction_id,amount_cents) SELECT o.id,j.value->>'transaction_id',j.value->>'amount_cents' FROM stay_pass_operations o CROSS JOIN json_each(?) j WHERE o.id=?`).bind(JSON.stringify(sources),op),
  db.prepare('UPDATE stay_passes SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=?)').bind(q.pass_id,op),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data,operation_id) SELECT ?,'stay',?,'stay_cash_followup',actor_id,created_at,reason,?,?,id FROM stay_pass_operations WHERE id=?`).bind(crypto.randomUUID(),String(input.stayId),JSON.stringify(q),JSON.stringify({direction:input.direction,amount_cents:input.amountCents,net_received_cents:net,reversal_of:input.reversalOf||null,evidence:input.evidence.trim()}),op),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','operationId',id,'stayId',?,'direction',?,'amountCents',?,'netReceivedCents',?,'dueCents',?,'refundDueCents',?) WHERE id=?`).bind(input.stayId,input.direction,input.amountCents,net,Math.max(0,q.charge_cents-net),Math.max(0,net-q.charge_cents),op)
 ]);
 return result[0].meta.changes===1?{...await replay(),replayed:false}:await replay()||{status:'conflict'};
}
