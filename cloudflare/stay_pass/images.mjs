import {currentTemplate} from './template_settings.mjs';
import {passDetail} from './read_models.mjs';
import {adminGuard,actorArgs,digest} from './repository.mjs';
import {fail} from './rules.mjs';
import {imageAssets,bytesHash} from './image_assets.mjs';
import {imageTemplateVersion,imageHtml,imagePageSpecs} from './image_layout.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
async function authorize(db,actor){if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string'||!await db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');}
function validate(input,write=false){const allowed=write?['passId','kind','language','format','key','quoteHash']:['passId','kind','language'];if(!input||Object.keys(input).some(k=>!allowed.includes(k))||typeof input.passId!=='string'||!input.passId||input.passId.length>100||!['card','usage','renewal','guide'].includes(input.kind)||!['th','en','bi'].includes(input.language))fail('invalid_image_request');if(write&&(!['png','jpg'].includes(input.format)||!/^[a-f0-9]{32}$/.test(input.key||'')||!/^[a-f0-9]{64}$/.test(input.quoteHash||'')))fail('invalid_image_request');}
export async function templateImageSnapshot(db,snapshot,config){
 const s=structuredClone(snapshot);s.template={version:'preview',config};if(!config.show_pet_photos)return s;
 try{const photos=await db.prepare('SELECT d.id,photo.object_key FROM stay_pass_pets pp JOIN stay_passes p ON p.id=pp.pass_id JOIN dogs d ON d.id=pp.dog_id AND d.customer_id=p.customer_id JOIN dog_photos photo ON photo.dog_id=d.id WHERE p.id=? AND pp.photo_consent=1 AND d.archived=0').bind(s.pass.id).all();for(const pet of s.pass.pets){const photo=photos.results.find(p=>p.id===pet.id);if(pet.photo_consent&&photo)pet.photo_key=photo.object_key;}}catch(error){if(!/no such table.*dog_photos/i.test(String(error)))throw error;}return s;
}
export async function prepareImage(db,input,actor,now=new Date()){
 validate(input);const view=await passDetail(db,input.passId,actor,now);if(view.status!=='ready')fail('not_found');if(!view.ledger_consistent)fail('ledger_mismatch');
 if(input.kind==='renewal'&&!await db.prepare('SELECT 1 FROM stay_pass_renewals WHERE new_pass_id=?').bind(input.passId).first())fail('image_renewal_required');
 const classified=view.totals.used_units+view.totals.cancellation_units+view.totals.no_show_units+view.totals.expired_units+view.totals.refunded_units+view.totals.transferred_units+view.pass.remaining_units;
 if(classified!==view.totals.purchased_units+view.totals.carry_units)fail('image_credit_review_required');
 const p=view.pass;if(p.status==='pending_payment')fail('image_payment_required');
 if(!view.policy?.content_th||!view.policy?.content_en||view.policy.version!==p.snapshot.policy_version)fail('image_policy_missing');
 let recent=view.history[0],group=recent?view.history.filter(r=>r.operation_id===recent.operation_id):[],checkout=null;
 try{const record=await db.prepare(`SELECT c.snapshot,o.id,o.created_at,o.reason,o.expected_revision FROM stay_pass_checkout_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE o.pass_id=? AND o.result IS NOT NULL AND o.expected_revision<? ORDER BY o.created_at DESC,c.stay_id DESC LIMIT 1`).bind(p.id,p.revision).first();if(record&&(!recent||record.created_at>=recent.recorded_at)){checkout=JSON.parse(record.snapshot);recent={operation_id:record.id,recorded_at:record.created_at,kind:'checkout_reconciliation',reason:record.reason,booking_id:checkout.booking_id,delta_units:checkout.settlement.net_credit_change_units,delta_reserved:0};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_checkout_commits/i.test(String(error)))throw error;}

 // A cancellation can change only cash or reservations and therefore have no credit ledger row.
 try{const record=await db.prepare(`SELECT c.snapshot,o.id,o.created_at,o.reason,o.expected_revision FROM stay_pass_booking_cancellations c JOIN stay_pass_operations o ON o.id=c.id WHERE o.pass_id=? AND o.result IS NOT NULL AND o.expected_revision<? ORDER BY o.expected_revision DESC LIMIT 1`).bind(p.id,p.revision).first();if(record&&(!recent||record.created_at>=recent.recorded_at)){const cancelled=JSON.parse(record.snapshot);checkout=null;recent={operation_id:record.id,recorded_at:record.created_at,kind:'booking_cancellation',reason:record.reason,booking_id:cancelled.booking_id,delta_units:-cancelled.deduct_units,delta_reserved:-cancelled.held_units};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_booking_cancellations/i.test(String(error)))throw error;}

 // A cash-only extension also deserves its own usage update event.
 try{const record=await db.prepare(`SELECT e.snapshot,o.id,o.created_at,o.reason,o.expected_revision FROM stay_pass_stay_extensions e JOIN stay_pass_operations o ON o.id=e.id WHERE o.pass_id=? AND o.result IS NOT NULL AND o.expected_revision=? ORDER BY e.sequence DESC LIMIT 1`).bind(p.id,p.revision-1).first();if(record){const extended=JSON.parse(record.snapshot);checkout=null;recent={operation_id:record.id,recorded_at:record.created_at,kind:'stay_extension',reason:record.reason,booking_id:extended.review.booking_id,delta_units:-extended.review.settlement.extra_covered_units,delta_reserved:0};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_stay_extensions/i.test(String(error)))throw error;}
 try{const record=await db.prepare(`SELECT e.kind,e.units,e.old_expiry,e.new_expiry,o.id,o.created_at,o.reason FROM stay_pass_lifecycle_events e JOIN stay_pass_operations o ON o.id=e.id WHERE e.pass_id=? AND o.result IS NOT NULL AND o.expected_revision=? ORDER BY e.created_at DESC LIMIT 1`).bind(p.id,p.revision-1).first();if(record){checkout=null;recent={operation_id:record.id,recorded_at:record.created_at,kind:record.kind==='extension'?'validity_extension':'expiration',reason:record.reason,delta_units:record.kind==='extension'?record.units:-record.units,delta_reserved:0};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_lifecycle_events/i.test(String(error)))throw error;}
 try{const record=await db.prepare(`SELECT t.id,o.created_at,o.reason FROM stay_pass_transfers t JOIN stay_pass_operations o ON o.id=t.id WHERE t.pass_id=? AND o.result IS NOT NULL AND o.expected_revision=? LIMIT 1`).bind(p.id,p.revision-1).first();if(record){checkout=null;recent={operation_id:record.id,recorded_at:record.created_at,kind:'ownership_transfer',reason:record.reason,delta_units:0,delta_reserved:0};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_transfers/i.test(String(error)))throw error;}
 try{const record=await db.prepare(`SELECT t.id,o.created_at,o.reason FROM stay_pass_pet_changes t JOIN stay_pass_operations o ON o.id=t.id WHERE t.pass_id=? AND o.result IS NOT NULL AND o.expected_revision=? LIMIT 1`).bind(p.id,p.revision-1).first();if(record){checkout=null;recent={operation_id:record.id,recorded_at:record.created_at,kind:'pet_registration',reason:record.reason,delta_units:0,delta_reserved:0};group=[recent];}}
 catch(error){if(!/no such table.*stay_pass_pet_changes/i.test(String(error)))throw error;}
 const template=await currentTemplate(db);
 const s={version:1,template_version:template.version?imageTemplateVersion+'+settings-'+template.version:imageTemplateVersion,...(template.version?{template}:{}),kind:input.kind,language:input.language,as_of:view.as_of,source_revision:p.revision,
  pass:{id:p.id,pass_number:p.pass_number,customer:p.customer,size:p.size,pets:p.pets.map(d=>({id:d.id,name:d.name,photo_consent:!!d.photo_consent})),status:p.status,purchase_at:p.purchase_at,expires_at_ms:Date.parse(p.expires_at),remaining_units:p.remaining_units,reserved_units:p.reserved_units,refund_held_units:p.refund_held_units,available_units:p.available_units},
  purchase:{...p.snapshot},totals:view.totals,policy:{version:view.policy.version,th:view.policy.content_th,en:view.policy.content_en},
  refunded_cents:view.payments.filter(r=>r.purpose==='refund').reduce((n,r)=>n+r.amount_cents,0),
  recent:recent?{operation_id:recent.operation_id,recorded_at:recent.recorded_at,kind:recent.kind,reason:recent.reason,booking_id:recent.booking_id,delta_units:group.reduce((n,r)=>n+r.delta_units,0),delta_reserved:group.reduce((n,r)=>n+r.delta_reserved,0),...(checkout?{checkin_at:checkout.timing.checkin_at,checkout_at:checkout.timing.actual_checkout_at,restored_units:checkout.settlement.restored_units,extra_units:checkout.settlement.extra_covered_units}:{} )}:null};
 if(template.config.show_pet_photos){try{const photos=await db.prepare('SELECT d.id,p.object_key FROM dogs d JOIN dog_photos p ON p.dog_id=d.id WHERE d.customer_id=? AND d.archived=0').bind(view.pass.customer_id).all();for(const pet of s.pass.pets){const photo=photos.results.find(p=>p.id===pet.id);if(pet.photo_consent&&photo)pet.photo_key=photo.object_key;}}catch(error){if(!/no such table.*dog_photos/i.test(String(error)))throw error;}}
 // No customer phone, address or payment evidence enters the image snapshot.
 if(new TextEncoder().encode(JSON.stringify(s)).length>200000)fail('image_data_too_large');
 const {as_of,...binding}=s,hash=await digest(binding);
 return {status:'ready',snapshot:s,quote_hash:hash,pages:imagePageSpecs(s).map((p,i)=>({index:i,type:p.type,language:p.language||s.language}))};
}
const historyResult=row=>({status:'saved',imageId:row.id,passId:row.pass_id,pageCount:row.page_count,kind:row.kind,language:row.language,createdAt:row.created_at});
async function replay(db,key,hash,actor){const row=await db.prepare(`SELECT * FROM stay_pass_generated_images WHERE actor_id=? AND request_key=? AND ${adminGuard}`).bind(actor.id,key,...actorArgs(actor)).first();if(!row)return null;if(row.request_hash!==hash)fail('idempotency_conflict');return {...historyResult(row),replayed:true};}
export function imageDimensions(bytes,format){
 if(format==='png'){
  if(bytes.length<33||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')fail('image_render_failed');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {width:v.getUint32(16),height:v.getUint32(20)};
 }
 if(bytes[0]!==255||bytes[1]!==216)fail('image_render_failed');
 let i=2;while(i+4<bytes.length){if(bytes[i++]!==255)fail('image_render_failed');while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const n=bytes[i]*256+bytes[i+1];if(n<2||i+n>bytes.length)fail('image_render_failed');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(n<8)fail('image_render_failed');return {height:bytes[i+3]*256+bytes[i+4],width:bytes[i+5]*256+bytes[i+6]};}i+=n;}fail('image_render_failed');
}
async function render(env,html,format){
 if(!env.BROWSER||!env.MEDIA)fail('image_renderer_unavailable');
 let response;try{response=await env.BROWSER.quickAction('screenshot',{html,viewport:{width:1080,height:1350,deviceScaleFactor:1},screenshotOptions:{type:format==='jpg'?'jpeg':'png',...(format==='jpg'?{quality:95}:{}),fullPage:true},gotoOptions:{waitUntil:'networkidle0'},waitForSelector:{selector:'html[data-image-ready="1"]',timeout:15000},rejectRequestPattern:['^https?://']});}catch(error){if(error.status===429||error.code===429||/\b429\b|rate limit|time limit exceeded/i.test(String(error.message)))fail('image_quota_limit');throw error;}
 if(response.status===429){await response.body?.cancel?.();fail('image_quota_limit');}
 const type=format==='jpg'?'image/jpeg':'image/png';if(!response.ok||response.headers.get('Content-Type')?.split(';')[0]!==type){await response.body?.cancel?.();fail('image_render_failed');}
 const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>16*1024*1024)fail('image_render_failed');const size=imageDimensions(bytes,format);if(size.width!==1080||size.height<1350||size.height>12000)fail('image_render_failed');return {bytes,type,...size};
}
export async function generateImage(env,input,actor,now=new Date()){
 validate(input,true);await authorize(env.DB,actor);const key=actor.id+':image:'+input.key,hash=await digest(input),prior=await replay(env.DB,key,hash,actor);if(prior)return prior;
 const prepared=await prepareImage(env.DB,{passId:input.passId,kind:input.kind,language:input.language},actor,now);if(prepared.quote_hash!==input.quoteHash)fail('image_confirmation_required');
 const assets=await imageAssets(env,prepared.snapshot),id=crypto.randomUUID(),pages=[],uploaded=[];let databaseAttempted=false;
 async function cleanup(){if(uploaded.length)try{await env.MEDIA.delete(uploaded);}catch{/* Private orphan objects can be reconciled later; never delete another request's objects. */}}
 try{
  for(const page of prepared.pages){const html=imageHtml(prepared.snapshot,assets,page.index),out=await render(env,html,input.format),htmlKey='stay-pass-images/'+id+'/'+page.index+'.html',fileKey='stay-pass-images/'+id+'/'+page.index+'.'+input.format;
   const htmlHash=await bytesHash(new TextEncoder().encode(html)),fileHash=await bytesHash(out.bytes);
   uploaded.push(htmlKey);await env.MEDIA.put(htmlKey,html,{httpMetadata:{contentType:'text/html; charset=utf-8'},customMetadata:{sha256:htmlHash,image_id:id}});
   uploaded.push(fileKey);await env.MEDIA.put(fileKey,out.bytes,{httpMetadata:{contentType:out.type},customMetadata:{sha256:fileHash,image_id:id}});
   pages.push({index:page.index,htmlKey,fileKey,htmlHash,fileHash,width:out.width,height:out.height,bytes:out.bytes.length,format:input.format});
  }
  const snapshot=JSON.stringify({...prepared.snapshot,...(assets.petPhotos?.length?{photo_hashes:assets.petPhotos.map(({id,hash})=>({id,hash}))}:{})}),at=now.toISOString();databaseAttempted=true;
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO stay_pass_generated_images(id,pass_id,actor_id,request_key,request_hash,kind,language,template_version,policy_version,price_version,source_revision,snapshot,snapshot_hash,created_at,page_count)
    SELECT ?,p.id,?,?,?,?,?,?,?,?,?,?,?,?,? FROM stay_passes p WHERE p.id=? AND p.revision=? AND ${adminGuard} ON CONFLICT(actor_id,request_key) DO NOTHING`)
    .bind(id,actor.id,key,hash,input.kind,input.language,prepared.snapshot.template_version,prepared.snapshot.policy.version,String(prepared.snapshot.purchase.price_version),prepared.snapshot.source_revision,snapshot,await digest(JSON.parse(snapshot)),at,pages.length,input.passId,prepared.snapshot.source_revision,...actorArgs(actor)),
   ...pages.map(p=>env.DB.prepare(`INSERT INTO stay_pass_generated_image_pages(image_id,page_index,html_key,html_hash,file_key,file_hash,format,width,height,byte_length) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stay_pass_generated_images WHERE id=?)`)
    .bind(id,p.index,p.htmlKey,p.htmlHash,p.fileKey,p.fileHash,p.format,p.width,p.height,p.bytes,id)),
   env.DB.prepare(`INSERT INTO stay_pass_audit_logs(id,subject_type,subject_id,action,actor_id,recorded_at,reason,after_data) SELECT ?,'image',id,'image_generated',actor_id,created_at,'Created immutable customer image snapshot',? FROM stay_pass_generated_images WHERE id=?`)
    .bind(crypto.randomUUID(),JSON.stringify({pass_id:input.passId,kind:input.kind,language:input.language,page_count:pages.length,source_revision:prepared.snapshot.source_revision,template_version:prepared.snapshot.template_version}),id)
  ]);
  if(result[0].meta.changes!==1){await cleanup();const previous=await replay(env.DB,key,hash,actor);if(previous)return previous;fail('image_data_changed');}
  return {status:'saved',imageId:id,passId:input.passId,pageCount:pages.length,kind:input.kind,language:input.language,createdAt:at};
 }catch(error){
  if(!databaseAttempted)await cleanup();else{
   // A timeout can occur after D1 commits. Confirm ownership before removing files.
   try{const committed=await env.DB.prepare('SELECT id FROM stay_pass_generated_images WHERE id=?').bind(id).first();if(!committed)await cleanup();}catch{/* Keep private files if commit status is uncertain. */}
  }
  throw error;
 }
}
export async function imageHistory(db,passId,actor){await authorize(db,actor);if(typeof passId!=='string'||!passId||passId.length>100)fail('invalid_image_request');const {results}=await db.prepare(`SELECT id,pass_id,kind,language,template_version,policy_version,price_version,source_revision,created_at,page_count FROM stay_pass_generated_images WHERE pass_id=? AND ${adminGuard} ORDER BY created_at DESC,id DESC LIMIT 100`).bind(passId,...actorArgs(actor)).all();return {status:'ready',images:results};}
export async function storedImageFile(env,imageId,pageIndex,format,actor,{download=false}={}){
 await authorize(env.DB,actor);if(typeof imageId!=='string'||imageId.length>100||!Number.isSafeInteger(pageIndex)||pageIndex<0||!['html','png','jpg'].includes(format))fail('invalid_image_request');
 const row=await env.DB.prepare(`SELECT f.*,g.kind,g.language,g.snapshot FROM stay_pass_generated_image_pages f JOIN stay_pass_generated_images g ON g.id=f.image_id WHERE f.image_id=? AND f.page_index=? AND ${adminGuard}`).bind(imageId,pageIndex,...actorArgs(actor)).first();if(!row||format!=='html'&&format!==row.format)fail('not_found');
 const html=format==='html',key=html?row.html_key:row.file_key,object=await env.MEDIA?.get(key);if(!object)fail('image_file_unavailable');
 const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(await bytesHash(bytes)!==(html?row.html_hash:row.file_hash))fail('image_file_invalid');
 return new Response(bytes,{headers:{...headers,'Content-Type':html?'text/html; charset=utf-8':format==='jpg'?'image/jpeg':'image/png',...(html?{'Content-Security-Policy':"frame-ancestors 'self'; base-uri 'none'"}:{'Content-Disposition':`${download?'attachment':'inline'}; filename="little-paws-stay-pass-${row.kind}-${pageIndex+1}-${row.language}.${format}"`})}});
}
export async function previewImage(env,input,quoteHash,pageIndex,width,actor,now=new Date()){
 const prepared=await prepareImage(env.DB,input,actor,now);if(prepared.quote_hash!==quoteHash)fail('image_confirmation_required');const assets=await imageAssets(env,prepared.snapshot);
 return new Response(imageHtml(prepared.snapshot,assets,pageIndex,{previewWidth:width}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"frame-ancestors 'self'; base-uri 'none'"}});
}
export async function imageRecord(db,id,actor){
 await authorize(db,actor);if(typeof id!=='string'||!id||id.length>100)fail('invalid_image_request');
 const [record,pages]=await db.batch([db.prepare(`SELECT id,pass_id,kind,language,template_version,policy_version,price_version,source_revision,created_at,page_count,snapshot FROM stay_pass_generated_images WHERE id=? AND ${adminGuard}`).bind(id,...actorArgs(actor)),db.prepare(`SELECT page_index,format,width,height,byte_length FROM stay_pass_generated_image_pages WHERE image_id=? AND ${adminGuard} ORDER BY page_index`).bind(id,...actorArgs(actor))]);
 if(!record.results.length)fail('not_found');const {snapshot,...image}=record.results[0],s=JSON.parse(snapshot);return {status:'ready',image,pages:pages.results,summary:{pass_number:s.pass.pass_number,customer:s.pass.customer,pets:s.pass.pets.map(p=>p.name),remaining_units:s.pass.remaining_units,available_units:s.pass.available_units,reserved_units:s.pass.reserved_units,as_of:s.as_of,expires_at_ms:s.pass.expires_at_ms}};
}
