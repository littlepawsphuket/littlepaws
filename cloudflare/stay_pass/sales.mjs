import {saleAvailability} from './availability.mjs';
// Sale preparation and atomic orchestration. Browser writes require development/staging gates.
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail,stamp,oneYearExpiry,releaseGates,thaiDay} from './rules.mjs';
export async function salesCustomers(db,actor){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 const rows=await db.prepare(`SELECT c.id,c.name FROM customers c WHERE c.archived=0 AND ${adminGuard} ORDER BY c.name,c.id LIMIT 1000`).bind(...actorArgs(actor)).all();
 return rows.results;
}
export async function salesPets(db,customerId,actor){
 if(!Number.isSafeInteger(customerId)||customerId<1)fail('invalid_customer');
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 return (await db.prepare(`SELECT d.id,d.name,d.size FROM dogs d JOIN customers c ON c.id=d.customer_id WHERE c.id=? AND c.archived=0 AND d.archived=0 AND ${adminGuard} ORDER BY d.name,d.id`).bind(customerId,...actorArgs(actor)).all()).results;
}
export async function quoteSale(db,input,actor,now=new Date()){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(!input||typeof input.planId!=='string'||!Number.isSafeInteger(input.customerId)||input.customerId<1||!['small','medium','large'].includes(input.size)||!Array.isArray(input.dogIds)||input.dogIds.length<1||input.dogIds.length>30||input.dogIds.some(n=>!Number.isSafeInteger(n)||n<1)||new Set(input.dogIds).size!==input.dogIds.length)fail('invalid_sale');
 const at=now.toISOString();
 const [access,owner,pets,price,sales]=await db.batch([
  db.prepare(`SELECT 1 AS allowed WHERE ${adminGuard}`).bind(...actorArgs(actor)),
  db.prepare('SELECT id,name FROM customers WHERE id=? AND archived=0').bind(input.customerId),
  db.prepare(`SELECT id,name,size,customer_id FROM dogs WHERE id IN(SELECT value FROM json_each(?)) AND archived=0 ORDER BY id`).bind(JSON.stringify(input.dogIds)),
  db.prepare(`SELECT pr.id AS price_id,pr.version AS price_version,pr.prices,pr.effective_at,pv.id AS plan_version_id,pv.version AS package_version,pv.config,
   po.id AS policy_id,po.version AS policy_version,po.status AS policy_status,po.content_hash,po.content_th,po.content_en,po.created_at AS policy_created_at
   FROM stay_pass_price_versions pr JOIN stay_pass_plan_versions pv ON pv.id=pr.plan_version_id
   LEFT JOIN stay_pass_policy_versions po ON po.version=json_extract(pv.config,'$.policy_version')
   WHERE pr.plan_id=? AND pr.effective_at<=? ORDER BY pr.effective_at DESC LIMIT 1`).bind(input.planId,at),
  db.prepare(`SELECT COUNT(DISTINCT p.id) AS paid_sales FROM stay_passes p JOIN stay_pass_plan_versions pv ON pv.id=p.plan_version_id
   WHERE pv.plan_id=? AND (SELECT COALESCE(SUM(l.amount_cents),0) FROM stay_pass_payment_links l WHERE l.pass_id=p.id AND l.purpose='sale')>=CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER)
   AND CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER)>0`).bind(input.planId)
 ]);
 if(!access.results.length)fail('forbidden');
 if(owner.results.length!==1)fail('invalid_customer');
 if(pets.results.length!==input.dogIds.length||pets.results.some(d=>d.customer_id!==input.customerId||d.size!==input.size))fail('ineligible_pet');
 const row=price.results[0];if(!row)fail('price_not_available');
 const config=JSON.parse(row.config),prices=JSON.parse(row.prices),amount=prices[input.size];
 if(!amount||!Number.isSafeInteger(amount.sale_cents)||amount.sale_cents<=0)fail('invalid_price');
 const availability=await saleAvailability(db,input.planId,now),blockers=['sales_release_not_approved',...availability.blockers];
 if(row.policy_status!=='approved')blockers.push('policy_not_approved');
 let validity=null;
 if(config.validity_months===12){try{validity=oneYearExpiry(at);}catch(error){if(error.code==='leap_day_approval_required')blockers.push(error.code);else throw error;}}
 else blockers.push('validity_rule_approval_required');
 const snapshot={package_name_th:config.name_th,package_name_en:config.name_en,plan_id:input.planId,plan_version_id:row.plan_version_id,package_version:row.package_version,price_version_id:row.price_id,price_version:row.price_version,policy_version_id:row.policy_id,policy_version:config.policy_version,policy_hash:row.content_hash,
  size:input.size,regular_cents:amount.regular_cents,paid_cents:amount.sale_cents,discount_bps:amount.discount_bps,credit_units:config.credit_units,validity_months:config.validity_months,benefits_th:config.benefits_th,benefits_en:config.benefits_en,
  unit_value:{numerator_cents:amount.sale_cents,denominator_units:config.credit_units},purchase_at:at,purchase_day:thaiDay(at),expires_at:validity?.expires_exclusive||null,last_valid_day:validity?.last_valid_day||null};
 const {purchase_at:quotedPurchaseAt,...binding}=snapshot;
 return {status:'preview_only',can_sell:false,can_receive_payment:false,availability,customer:owner.results[0],pets:pets.results.map(({id,name,size})=>({id,name,size})),snapshot,quote_hash:await digest({snapshot:binding,...(availability.schema?{availability_version:availability.version}:{}),customer_id:input.customerId,dog_ids:[...input.dogIds].sort((a,b)=>a-b)}),quoted_at:at,
  sales_limit:config.sales_limit,paid_sales_recorded:sales.results[0].paid_sales,policy:{version:config.policy_version,status:row.policy_status||'missing',content_th:row.content_th||'',content_en:row.content_en||'',created_at:row.policy_created_at||null},blockers,release_gates:releaseGates};
}

// Records already-received full payment through the explicit development/staging gate;
// it does not transfer funds. Activation additionally requires approved policy evidence.
// The optional fifth argument is server-owned batch composition for renewal; routes never forward request data into it.
export async function recordPaidSale(db,input,actor,now=new Date(),internalExtension=null){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(!input||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>800||!['cash','transfer'].includes(input.paymentMethod)||typeof input.reference!=='string'||input.reference.length>200||!input.acceptance||input.acceptance.confirmed!==true||!['in_person','line','document'].includes(input.acceptance.channel)||typeof input.acceptance.evidence!=='string'||!input.acceptance.evidence.trim()||input.acceptance.evidence.length>2000)fail('invalid_sale');
 const photoDogs=input.photoConsentDogIds??[];if(!Array.isArray(photoDogs)||!Array.isArray(input.dogIds)||photoDogs.length>30||new Set(photoDogs).size!==photoDogs.length||photoDogs.some(id=>!Number.isSafeInteger(id)||!input.dogIds.includes(id)))fail('invalid_photo_consent');
 const requestHash=await digest(input),requestKey=actor.id+':sale:'+input.key;
 async function replay(){const row=await db.prepare(`SELECT s.request_hash,p.id,p.pass_number FROM stay_pass_sales s JOIN stay_passes p ON p.id=s.pass_id WHERE s.actor_id=? AND s.request_key=? AND ${adminGuard}`).bind(actor.id,requestKey,...actorArgs(actor)).first();if(!row)return null;if(row.request_hash!==requestHash)fail('idempotency_conflict');return {status:'saved',passId:row.id,passNumber:row.pass_number,replayed:true};}
 const previous=await replay();if(previous)return previous;
 const quote=await quoteSale(db,input,actor,now),q=quote.snapshot,at=now.toISOString();
 if(input.quoteHash!==quote.quote_hash)fail('price_confirmation_required');
 if(quote.policy.status!=='approved'||!q.policy_version_id)fail('policy_not_approved');
 if(!q.expires_at||quote.blockers.some(x=>x!=='sales_release_not_approved'))fail('sale_policy_blocked');
 if(!Number.isSafeInteger(input.paidCents)||input.paidCents!==q.paid_cents)fail('full_payment_required');
 const acceptedAt=stamp(input.acceptance.acceptedAt);if(acceptedAt>at||acceptedAt<quote.policy.created_at)fail('invalid_acceptance_time');
 const revision=await db.prepare('SELECT revision FROM stay_pass_plans WHERE id=?').bind(input.planId).first();
 const availabilityGuard=quote.availability.schema?' AND COALESCE((SELECT MAX(version) FROM stay_pass_sale_windows WHERE plan_id=pl.id),0)=?':'',availabilityArgs=quote.availability.schema?[quote.availability.version]:[];
 const id=crypto.randomUUID(),saleId=crypto.randomUUID(),lotId=crypto.randomUUID(),opId=crypto.randomUUID(),ledgerId=crypto.randomUUID(),linkId=crypto.randomUUID(),cashKey='stay-pass-sale:'+id;
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const passNumber='LP-SP-'+[...crypto.getRandomValues(new Uint8Array(6))].map(x=>alphabet[x&31]).join('');
 // D1 batch is atomic. Only the first statement can authorize this write token (pass ID).
 // All subsequent writes are conditional on that fresh ID, never on an existing request.
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_passes(id,pass_number,customer_id,plan_version_id,price_version_id,policy_version_id,size,snapshot,purchase_at,expires_at,status)
   SELECT ?,?,?,?,?,?,?,json(?),?,?,'active' FROM stay_pass_plans pl
   WHERE pl.id=? AND pl.revision=? AND ${adminGuard}
    AND EXISTS(SELECT 1 FROM customers c WHERE c.id=? AND c.archived=0)
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM dogs d WHERE d.id=j.value AND d.customer_id=? AND d.archived=0 AND d.size=?))
    AND NOT EXISTS(SELECT 1 FROM stay_pass_sales WHERE actor_id=? AND request_key=?)
    AND (SELECT pr.id FROM stay_pass_price_versions pr WHERE pr.plan_id=pl.id AND pr.effective_at<=? ORDER BY pr.effective_at DESC LIMIT 1)=?
    AND EXISTS(SELECT 1 FROM stay_pass_policy_versions po WHERE po.id=? AND po.status='approved' AND po.content_hash=?)
    AND (SELECT COUNT(DISTINCT p.id) FROM stay_passes p JOIN stay_pass_plan_versions pv ON pv.id=p.plan_version_id WHERE pv.plan_id=pl.id
      AND CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER)>0 AND (SELECT COALESCE(SUM(l.amount_cents),0) FROM stay_pass_payment_links l WHERE l.pass_id=p.id AND l.purpose='sale')>=CAST(json_extract(p.snapshot,'$.paid_cents') AS INTEGER))<? ${availabilityGuard} ${internalExtension?.guardSql||''}`)
   .bind(id,passNumber,input.customerId,q.plan_version_id,q.price_version_id,q.policy_version_id,input.size,JSON.stringify(q),at,q.expires_at,input.planId,revision?.revision??-1,...actorArgs(actor),input.customerId,JSON.stringify(input.dogIds),input.customerId,input.size,actor.id,requestKey,at,q.price_version_id,q.policy_version_id,q.policy_hash,quote.sales_limit,...availabilityArgs,...(internalExtension?.guardParams||[])),
  db.prepare(`INSERT INTO stay_pass_sales(id,pass_id,actor_id,request_key,request_hash,quote_hash,recorded_at,reason)
   SELECT ?,p.id,?,?,?,?,?,? FROM stay_passes p WHERE p.id=?`).bind(saleId,actor.id,requestKey,requestHash,quote.quote_hash,at,input.reason.trim(),id),
  db.prepare(`INSERT INTO stay_pass_pets(pass_id,dog_id,photo_consent,registered_at) SELECT p.id,j.value,CASE WHEN j.value IN(SELECT value FROM json_each(?)) THEN 1 ELSE 0 END,? FROM stay_passes p CROSS JOIN json_each(?) j WHERE p.id=?`).bind(JSON.stringify(photoDogs),at,JSON.stringify(input.dogIds),id),
  db.prepare(`INSERT INTO stay_pass_policy_acceptances(id,pass_id,policy_version_id,customer_id,accepted_at,channel,evidence,policy_hash,recorded_at,actor_id)
   SELECT ?,p.id,p.policy_version_id,p.customer_id,?,?,?,?,?,? FROM stay_passes p WHERE p.id=?`).bind(crypto.randomUUID(),acceptedAt,input.acceptance.channel,input.acceptance.evidence.trim(),q.policy_hash,at,actor.id,id),
  db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,reference,payment_type,payment_key,received_time)
   SELECT ?,'income','Stay Pass',?,?/100.0,p.customer_id,NULL,?,?,'stay_pass',?,? FROM stay_passes p WHERE p.id=?`)
   .bind(q.purchase_day,'Little Paws Stay Pass '+passNumber,q.paid_cents,input.paymentMethod,input.reference,cashKey,new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now),id),
  db.prepare(`INSERT INTO stay_pass_payment_links(id,pass_id,transaction_id,purpose,amount_cents,original_link_id,created_at)
   SELECT ?,p.id,t.id,'sale',?,NULL,? FROM stay_passes p JOIN transactions t ON t.payment_key=? AND t.payment_type='stay_pass' WHERE p.id=?`).bind(linkId,q.paid_cents,at,cashKey,id),
  db.prepare(`INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,issued_units,origin_value_cents,expires_at,created_at)
   SELECT ?,p.id,'purchase',?,?,p.expires_at,? FROM stay_passes p WHERE p.id=?`).bind(lotId,q.credit_units,q.paid_cents,at,id),
  db.prepare(`INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at)
   SELECT ?,p.id,?,?,?,0,'purchase',?,? FROM stay_passes p WHERE p.id=?`).bind(opId,actor.id,requestKey,requestHash,input.reason.trim(),at,id),
  db.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at)
   SELECT ?,o.id,o.pass_id,l.id,'purchase',l.issued_units,0,0,0,l.issued_units,0,0,0,0,? FROM stay_pass_operations o JOIN stay_pass_credit_lots l ON l.pass_id=o.pass_id WHERE o.id=?`).bind(ledgerId,at,opId),
  db.prepare('UPDATE stay_passes SET revision=1 WHERE id=?').bind(id),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data,operation_id)
   SELECT ?,'pass',p.id,'paid_sale',?,?,?,?,? FROM stay_passes p WHERE p.id=?`).bind(crypto.randomUUID(),actor.id,at,input.reason.trim(),JSON.stringify({snapshot:q,pass_number:passNumber,customer_id:input.customerId,dog_ids:input.dogIds,photo_consent_dog_ids:photoDogs,payment_link_id:linkId}),opId,id),
  db.prepare(`UPDATE stay_pass_operations SET result=json_object('status','saved','operationId',id,'revision',1,'passId',pass_id) WHERE id=?`).bind(opId),
  ...(internalExtension?.statements?.({passId:id,passNumber,snapshot:q,at,actor})||[])
 ]);
 if(result[0].meta.changes!==1)return await replay()||{status:'conflict'};
 return {status:'saved',passId:id,passNumber};
}
