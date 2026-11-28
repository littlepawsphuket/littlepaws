import {pricePreview} from './pricing.mjs';
import {fail,stamp,releaseGates} from './rules.mjs';
export const adminGuard=`EXISTS(SELECT 1 FROM app_users u JOIN staff_access_identities a ON a.user_id=u.id WHERE u.id=? AND u.active=1 AND u.is_admin=1 AND a.email=?)`;
export function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const actorArgs=actor=>[actor.id,actor.email];
function request(actor,key,reason){if(!Number.isSafeInteger(actor?.id)||actor.id<1||typeof actor.email!=='string')fail('forbidden');if(!/^[a-f0-9]{32}$/.test(key||'')||typeof reason!=='string'||!reason.trim()||reason.length>800)fail('invalid_request');}
async function replay(db,table,key,hash,actor){
 const previous=await db.prepare(`SELECT v.* FROM ${table} v WHERE request_key=? AND ${adminGuard}`).bind(key,...actorArgs(actor)).first();
 if(!previous)return null;if(previous.request_hash!==hash)fail('idempotency_conflict');return {status:'saved',id:previous.id,version:previous.version,planId:previous.plan_id,revision:previous.plan_revision,...(previous.effective_at?{effective_at:previous.effective_at}:{}),replayed:true};
}
export async function catalog(db){
 const exists=await db.prepare("SELECT version FROM stay_pass_schema_versions WHERE version=1").bind().first();
 if(!exists)return {status:'migration_required'};
 const [plans,versions,prices,policies]=await db.batch([
  db.prepare('SELECT id,code,revision FROM stay_pass_plans ORDER BY created_at,id').bind(),
  db.prepare('SELECT id,plan_id,version,config,reason,created_at,actor_id FROM stay_pass_plan_versions ORDER BY version DESC').bind(),
  db.prepare(`SELECT id,plan_id,plan_version_id,version,effective_at,LEAD(effective_at) OVER(PARTITION BY plan_id ORDER BY effective_at) AS effective_until,
    prices,reason,copied_from,created_at,actor_id FROM stay_pass_price_versions ORDER BY effective_at DESC`).bind(),
  db.prepare('SELECT id,version,content_th,content_en,content_hash,status,reason,created_at,actor_id FROM stay_pass_policy_versions ORDER BY created_at DESC,id').bind()
 ]);
 return {status:'ready',policies:policies.results,plans:plans.results,versions:versions.results.map(v=>({...v,config:JSON.parse(v.config)})),prices:prices.results.map(v=>({...v,prices:JSON.parse(v.prices)})),release_gates:releaseGates};
}
export async function savePlan(db,input,actor,now=new Date()){
 request(actor,input.key,input.reason);const config=pricePreview(input.config).config;
 const code=typeof input.code==='string'?input.code.trim().toUpperCase():'';
 if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)||input.planId!==null&&typeof input.planId!=='string'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('invalid_request');
 const hash=await digest(input),key=actor.id+':plan:'+input.key;const prior=await replay(db,'stay_pass_plan_versions',key,hash,actor);if(prior)return prior;
 if(input.planId!==null){const previous=await db.prepare('SELECT config FROM stay_pass_plan_versions WHERE plan_id=? ORDER BY version DESC LIMIT 1').bind(input.planId).first();if(previous){const old=JSON.parse(previous.config),rights=['credit_units','validity_months','benefits_th','benefits_en'];if(old.policy_version===config.policy_version&&rights.some(k=>JSON.stringify(old[k])!==JSON.stringify(config[k])))fail('new_policy_version_required');}}
 const id=input.planId||crypto.randomUUID(),versionId=crypto.randomUUID(),token=crypto.randomUUID(),at=now.toISOString(),next=input.expectedRevision+1;
 const primary=input.planId===null
 ?db.prepare(`INSERT INTO stay_pass_plans(id,code,revision,write_token,created_at,created_by) SELECT ?,?,1,?,?,? WHERE ?=0 AND ${adminGuard} ON CONFLICT DO NOTHING`).bind(id,code,token,at,actor.id,input.expectedRevision,...actorArgs(actor))
 :db.prepare(`UPDATE stay_pass_plans SET revision=?,write_token=? WHERE id=? AND code=? AND revision=? AND ${adminGuard}`).bind(next,token,id,code,input.expectedRevision,...actorArgs(actor));
 const result=await db.batch([primary,
  db.prepare(`INSERT INTO stay_pass_plan_versions(id,plan_id,version,plan_revision,config,reason,created_at,actor_id,request_key,request_hash)
   SELECT ?,p.id,COALESCE((SELECT MAX(v.version) FROM stay_pass_plan_versions v WHERE v.plan_id=p.id),0)+1,?,?,?,?,?,?,? FROM stay_pass_plans p WHERE p.id=? AND p.write_token=?`)
   .bind(versionId,next,JSON.stringify(config),input.reason.trim(),at,actor.id,key,hash,id,token),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,before_data,after_data)
   SELECT ?,'plan',p.id,'plan_version',?,?,?,(SELECT v.config FROM stay_pass_plan_versions v WHERE v.plan_id=p.id AND v.id!=? ORDER BY v.version DESC LIMIT 1),?
   FROM stay_pass_plans p WHERE p.id=? AND p.write_token=?`).bind(crypto.randomUUID(),actor.id,at,input.reason.trim(),versionId,JSON.stringify(config),id,token),
  db.prepare('SELECT id,version FROM stay_pass_plan_versions WHERE request_key=?').bind(key)
 ]);
 if(result[0].meta.changes!==1)return await replay(db,'stay_pass_plan_versions',key,hash,actor)||{status:'conflict'};
 return {status:'saved',planId:id,...result.at(-1).results[0],revision:next};
}
export async function savePrice(db,input,actor,now=new Date()){
 request(actor,input.key,input.reason);
 if(typeof input.planId!=='string'||typeof input.planVersionId!=='string'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('invalid_request');
 const hash=await digest(input),key=actor.id+':price:'+input.key,prior=await replay(db,'stay_pass_price_versions',key,hash,actor);if(prior)return prior;
 const version=await db.prepare('SELECT config FROM stay_pass_plan_versions WHERE id=? AND plan_id=?').bind(input.planVersionId,input.planId).first();if(!version)fail('not_found');
 let prices=pricePreview(JSON.parse(version.config)).prices;
 if(input.copiedFrom){
  const source=await db.prepare('SELECT prices,plan_version_id FROM stay_pass_price_versions WHERE id=? AND plan_id=?').bind(input.copiedFrom,input.planId).first();
  if(!source||source.plan_version_id!==input.planVersionId)fail('invalid_price_source');prices=JSON.parse(source.prices);
 }
 const at=now.toISOString(),effective=input.effectiveAt===null?at:stamp(input.effectiveAt);
 if(effective<at)fail('backdated_price_not_allowed');
 const id=crypto.randomUUID(),token=crypto.randomUUID();
 const writes=await db.batch([
  db.prepare(`UPDATE stay_pass_plans SET revision=revision+1,write_token=? WHERE id=? AND revision=? AND ${adminGuard}
   AND NOT EXISTS(SELECT 1 FROM stay_pass_price_versions WHERE plan_id=? AND effective_at=?)`).bind(token,input.planId,input.expectedRevision,...actorArgs(actor),input.planId,effective),
  db.prepare(`INSERT INTO stay_pass_price_versions(id,plan_id,plan_version_id,version,plan_revision,effective_at,prices,reason,copied_from,created_at,actor_id,request_key,request_hash)
   SELECT ?,p.id,?,COALESCE((SELECT MAX(v.version) FROM stay_pass_price_versions v WHERE v.plan_id=p.id),0)+1,?,?,?,?,?,?,?,?,?
   FROM stay_pass_plans p WHERE p.id=? AND p.write_token=?`).bind(id,input.planVersionId,input.expectedRevision+1,effective,JSON.stringify(prices),input.reason.trim(),input.copiedFrom||null,at,actor.id,key,hash,input.planId,token),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data)
   SELECT ?,'price_version',v.id,'price_version',?,?,?,json_object('effective_at',v.effective_at,'prices',json(v.prices))
   FROM stay_pass_price_versions v WHERE v.id=?`).bind(crypto.randomUUID(),actor.id,at,input.reason.trim(),id),
  db.prepare('SELECT id,version FROM stay_pass_price_versions WHERE request_key=?').bind(key)
 ]);
 if(writes[0].meta.changes!==1)return await replay(db,'stay_pass_price_versions',key,hash,actor)||{status:'conflict'};
 return {status:'saved',planId:input.planId,...writes.at(-1).results[0],revision:input.expectedRevision+1,effective_at:effective};
}

export async function savePolicyDraft(db,input,actor,now=new Date()){
 request(actor,input.key,input.reason);
 if(!/^\d+\.\d+(?:\.\d+)?$/.test(input.version||'')||input.version.length>20||['content_th','content_en'].some(k=>typeof input[k]!=='string'||!input[k].trim()||input[k].length>20000)||Object.hasOwn(input,'status'))fail('invalid_policy');
 const requestHash=await digest(input),requestKey=actor.id+':policy:'+input.key;
 async function replay(){const prior=await db.prepare(`SELECT id,version,request_hash FROM stay_pass_policy_versions WHERE request_key=? AND ${adminGuard}`).bind(requestKey,...actorArgs(actor)).first();if(!prior)return null;if(prior.request_hash!==requestHash)fail('idempotency_conflict');return {status:'saved',id:prior.id,version:prior.version,policyStatus:'draft',replayed:true};}
 const previous=await replay();if(previous)return previous;
 const id=crypto.randomUUID(),at=now.toISOString(),contentHash=await digest({th:input.content_th,en:input.content_en});
 const result=await db.batch([
  db.prepare(`INSERT INTO stay_pass_policy_versions(id,version,content_th,content_en,content_hash,reason,request_key,request_hash,status,created_at,actor_id)
   SELECT ?,?,?,?,?,?,?,?,'draft',?,? WHERE ${adminGuard} ON CONFLICT DO NOTHING`).bind(id,input.version,input.content_th,input.content_en,contentHash,input.reason.trim(),requestKey,requestHash,at,actor.id,...actorArgs(actor)),
  db.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data)
   SELECT ?,'policy',p.id,'policy_draft',?,?,?,json_object('version',p.version,'hash',p.content_hash,'status',p.status) FROM stay_pass_policy_versions p WHERE p.id=?`).bind(crypto.randomUUID(),actor.id,at,input.reason.trim(),id)
 ]);
 return result[0].meta.changes===1?{status:'saved',id,version:input.version,policyStatus:'draft'}:await replay()||{status:'conflict'};
}
