import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {db,sqlite,actor,staff,key} from './test_foundation.mjs';
import {initialPlan} from './pricing.mjs';
import {savePlan,savePrice} from './repository.mjs';
import {quoteSale,recordPaidSale} from './sales.mjs';
import {prepareImage,generateImage,imageHistory,storedImageFile,imageDimensions} from './images.mjs';
import {imageFontManifest,imageFontKey,bytesHash} from './image_assets.mjs';
import {imageHtml,guideChunks,imagePageSpecs} from './image_layout.mjs';
import {cloudSnapshot,backupMedia} from '../cloud_backup.mjs';
for(const name of ['007_refunds.sql','008_renewals.sql','009_images.sql']){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');sqlite.exec(sql);sqlite.exec(sql);}
const clock=new Date('2026-11-27T09:00:00+07:00');
sqlite.exec("INSERT INTO customers(id,name,archived) VALUES(99,'Image demo <script>alert(1)</script>',0);INSERT INTO dogs(id,name,customer_id,size,archived) VALUES(99,'Mali <Demo>',99,'small',0)");
const plan=await savePlan(db,{planId:null,code:'IMAGE-TEST',expectedRevision:0,config:{...initialPlan(),policy_version:'1.9.1'},reason:'Synthetic image plan',key:key()},actor,clock);
await savePrice(db,{planId:plan.planId,planVersionId:plan.id,expectedRevision:1,effectiveAt:null,reason:'Synthetic image price',key:key()},actor,clock);
const saleInput={planId:plan.planId,customerId:99,size:'small',dogIds:[99]},saleQuote=await quoteSale(db,saleInput,actor,clock),sold=await recordPaidSale(db,{...saleInput,key:key(),quoteHash:saleQuote.quote_hash,paidCents:510000,paymentMethod:'cash',reference:'PRIVATE PAYMENT REFERENCE',reason:'Synthetic image sale',acceptance:{confirmed:true,channel:'document',evidence:'PRIVATE CONSENT EVIDENCE',acceptedAt:clock.toISOString()}},actor,clock);
const files=new Map(),media={async get(key){const f=files.get(key);return f?{body:new Response(f.bytes).body,size:f.bytes.length,customMetadata:f.options?.customMetadata}:null;},async put(key,value,options){files.set(key,{bytes:typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value),options});return {};},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}};
for(const entry of imageFontManifest){const bytes=new Uint8Array(await readFile(new URL('./prototype_assets/'+entry[1],import.meta.url)));assert.equal(await bytesHash(bytes),entry[2]);await media.put(imageFontKey(entry),bytes);}
// Renderer stub exercises orchestration and byte validation, NOT actual Cloudflare font/pixel rendering.
const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10],0);png.set([73,72,68,82],12);new DataView(png.buffer).setUint32(16,1080);new DataView(png.buffer).setUint32(20,1350);
let renders=0,seenHtml='';const env={DB:db,MEDIA:media,BROWSER:{async quickAction(action,options){renders++;assert.equal(action,'screenshot');assert.equal(options.waitForSelector.selector,'html[data-image-ready="1"]');assert.equal(options.viewport.width,1080);assert.deepEqual(options.rejectRequestPattern,['^https?://']);seenHtml=options.html;return new Response(png,{headers:{'Content-Type':'image/png'}});}}};
const input={passId:sold.passId,kind:'card',language:'th'},prepared=await prepareImage(db,input,actor,clock);assert.equal(prepared.snapshot.pass.remaining_units,60);assert.equal(prepared.pages.length,4);assert(!JSON.stringify(prepared.snapshot).includes('PRIVATE PAYMENT'));assert(!JSON.stringify(prepared.snapshot).includes('PRIVATE CONSENT'));
const before={cash:sqlite.prepare('SELECT count(*) n FROM transactions').get().n,ledger:sqlite.prepare('SELECT count(*) n FROM stay_pass_credit_transactions').get().n,revision:sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(sold.passId).revision};
const limitedFiles=files.size;await assert.rejects(()=>generateImage({...env,BROWSER:{async quickAction(){throw Object.assign(Error('Rate limit exceeded'),{status:429});}}},{...input,key:key(),format:'png',quoteHash:prepared.quote_hash},actor,clock),e=>e.code==='image_quota_limit');assert.equal(files.size,limitedFiles);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,before.cash);assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_credit_transactions').get().n,before.ledger);
const form={...input,format:'png',key:key(),quoteHash:prepared.quote_hash},saved=await generateImage(env,form,actor,clock);assert.equal(saved.status,'saved');assert.equal(saved.pageCount,4);assert.equal(renders,4);assert.equal((await generateImage(env,form,actor,clock)).imageId,saved.imageId);assert.equal(renders,4);
assert(!seenHtml.includes('Image demo <script>'));assert(seenHtml.includes('&lt;script&gt;'));assert(seenHtml.includes('font-family:WalletThai'));assert(seenHtml.includes("style-src-attr 'unsafe-inline'"));
assert.deepEqual({cash:sqlite.prepare('SELECT count(*) n FROM transactions').get().n,ledger:sqlite.prepare('SELECT count(*) n FROM stay_pass_credit_transactions').get().n,revision:sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(sold.passId).revision},before);
const file=await storedImageFile(env,saved.imageId,0,'png',actor);assert.equal(file.headers.get('Cache-Control'),'private, no-store');assert.equal(new Uint8Array(await file.arrayBuffer()).length,png.length);
await assert.rejects(()=>storedImageFile(env,saved.imageId,0,'jpg',actor),e=>e.code==='not_found');await assert.rejects(()=>storedImageFile(env,saved.imageId,0,'png',staff),e=>e.code==='forbidden');
await assert.rejects(()=>generateImage(env,{...form,language:'en'},actor,clock),e=>e.code==='idempotency_conflict');
// Original files/snapshot survive customer rename and template-independent later reads.
const originalHtml=await (await storedImageFile(env,saved.imageId,0,'html',actor)).text();sqlite.prepare('UPDATE customers SET name=? WHERE id=99').run('Changed current name');const oldHtml=await (await storedImageFile(env,saved.imageId,0,'html',actor)).text();assert.equal(oldHtml,originalHtml);assert(!oldHtml.includes('Changed current name'));
await assert.rejects(()=>generateImage(env,{...form,key:key()},actor,clock),e=>e.code==='image_confirmation_required');
const current=await prepareImage(db,input,actor,clock),nextForm={...form,key:key(),quoteHash:current.quote_hash};
sqlite.exec("CREATE TRIGGER image_failure BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='image_generated' BEGIN SELECT RAISE(ABORT,'image_failure'); END");const filesBefore=files.size;
await assert.rejects(()=>generateImage(env,nextForm,actor,clock),/image_failure/);assert.equal(files.size,filesBefore);assert.equal((await imageHistory(db,sold.passId,actor)).images.length,1);sqlite.exec('DROP TRIGGER image_failure');
const concurrent={...nextForm,key:key()},outcomes=await Promise.all([generateImage(env,concurrent,actor,clock),generateImage(env,concurrent,actor,clock)]);assert.equal(outcomes[0].imageId,outcomes[1].imageId);assert.equal((await imageHistory(db,sold.passId,actor)).images.length,2);
// Mid-render quota revision change invalidates the fresh image, leaving old history intact.
let changed=false;const racing={...env,BROWSER:{async quickAction(...args){if(!changed){changed=true;sqlite.prepare('UPDATE stay_passes SET revision=revision+1 WHERE id=?').run(sold.passId);}return env.BROWSER.quickAction(...args);}}};
await assert.rejects(()=>generateImage(racing,{...nextForm,key:key()},actor,clock),e=>e.code==='image_data_changed');assert.equal((await imageHistory(db,sold.passId,actor)).images.length,2);
const snapshot=await cloudSnapshot(db);assert.equal(snapshot.rows.stay_pass_generated_images.length,2);assert.equal(snapshot.required_media.filter(k=>k.startsWith('stay-pass-images/')).length,16);assert(await backupMedia(env,snapshot.required_media.find(k=>k.startsWith('stay-pass-images/'))));assert.equal(await backupMedia(env,'stay-pass-images/not-owned/0.png'),null);
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_generated_images SET snapshot=? WHERE id=?').run('{}',saved.imageId),/stay_pass_immutable/);
const corruptKey=sqlite.prepare('SELECT file_key FROM stay_pass_generated_image_pages WHERE image_id=? AND page_index=0').get(saved.imageId).file_key,original=files.get(corruptKey);files.set(corruptKey,{bytes:new Uint8Array([1,2,3])});await assert.rejects(()=>storedImageFile(env,saved.imageId,0,'png',actor),e=>e.code==='image_file_invalid');files.set(corruptKey,original);
const text='ข้อกำหนด ภาษาไทย 🐾\n'.repeat(100);assert.equal(guideChunks(text).join(''),text);const guide={...prepared.snapshot,kind:'guide',language:'bi',policy:{version:'1.9.1',th:text,en:'English terms '.repeat(100)}};assert(imagePageSpecs(guide).length>2);
assert.deepEqual(imageDimensions(png,'png'),{width:1080,height:1350});assert.throws(()=>imageDimensions(new Uint8Array(33),'png'));
await assert.rejects(()=>prepareImage(db,{...input,remaining_units:999},actor,clock),e=>e.code==='invalid_image_request');
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Image orchestration passed (stub renderer): immutable snapshots/files, hash-checked original fonts/logo, no credit/cash effects, replay/concurrency, rollback cleanup, revision-race rejection, private access, backup inclusion and complete TH/EN guide pagination. Real browser pixel rendering remains separate.');
const {stayPassRoute}=await import('./routes.mjs'),admin={...actor,is_admin:true},httpEnv={...env,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development',STAY_PASS_IMAGE_WRITES:'1'};
const http=(path,body,origin='https://staff.test')=>new Request('https://staff.test/api/stay-pass'+path,body?{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
assert.equal((await stayPassRoute(http('/images/generate',form),{...httpEnv,STAY_PASS_IMAGE_WRITES:'0'},admin)).status,404);
assert.equal((await stayPassRoute(http('/images/generate',form),{...httpEnv,STAY_PASS_ENVIRONMENT:'production'},admin)).status,404);
assert.equal((await stayPassRoute(http('/images/generate',form,'https://other.test'),httpEnv,admin)).status,403);
assert.equal((await stayPassRoute(http('/images/'+saved.imageId+'/0.png'),httpEnv,{...staff,is_admin:true})).status,403);
const fresh=await prepareImage(db,input,actor,clock),previewQuery=new URLSearchParams({pass:sold.passId,kind:'card',language:'th',quote:fresh.quote_hash,width:'390',page:'0'});
let response=await stayPassRoute(http('/images/preview?'+previewQuery),httpEnv,admin);assert.equal(response.status,200);assert((await response.text()).includes('width:390px'));
previewQuery.set('quote','0'.repeat(64));assert.equal((await stayPassRoute(http('/images/preview?'+previewQuery),httpEnv,admin)).status,400);
response=await stayPassRoute(http('/images/'+saved.imageId),httpEnv,admin);const record=await response.json();assert.equal(record.pages.length,4);assert(record.summary.customer.includes('<script>'));assert(!JSON.stringify(record).includes('PRIVATE CONSENT'));
response=await stayPassRoute(http('/images/'+saved.imageId+'/0.png?download=1'),httpEnv,admin);assert(response.headers.get('Content-Disposition').startsWith('attachment;'));
await assert.rejects(()=>prepareImage(db,{...input,kind:'renewal'},actor,clock),e=>e.code==='image_renewal_required');
console.log('Image HTTP boundaries passed: write/production/origin/fresh-admin gates, safe current preview, saved page metadata, private download and real-renewal requirement.');
// A lost D1 response after commit must not delete files referenced by that commit.
const uncertainDb={prepare(sql){const stmt=db.prepare(sql);stmt.imageSql=sql;return stmt;},async batch(stmts){const out=await db.batch(stmts);if(stmts[0].imageSql?.includes('INSERT INTO stay_pass_generated_images'))throw Error('simulated_commit_timeout');return out;}};
const uncertainForm={...form,key:key(),quoteHash:fresh.quote_hash};await assert.rejects(()=>generateImage({...env,DB:uncertainDb},uncertainForm,actor,clock),/simulated_commit_timeout/);
const recovered=await generateImage(env,uncertainForm,actor,clock);assert.equal(recovered.replayed,true);assert.equal((await storedImageFile(env,recovered.imageId,0,'png',actor)).status,200);
// Object upload failure cleans only that generation, never historical image objects.
const countBeforeUploadFailure=files.size,failedUpload={...media,async put(k,v,opts){if(k.endsWith('.png'))throw Error('upload_failure');return media.put(k,v,opts);}};
await assert.rejects(()=>generateImage({...env,MEDIA:failedUpload},{...form,key:key(),quoteHash:fresh.quote_hash},actor,clock),/upload_failure/);assert.equal(files.size,countBeforeUploadFailure);
// JPG protocol/quality uses the same immutable history path. This is a renderer stub.
const jpg=Uint8Array.from([255,216,255,192,0,17,8,5,70,4,56,3,1,17,0,2,17,0,3,17,0,255,217]);
assert.deepEqual(imageDimensions(jpg,'jpg'),{width:1080,height:1350});
const jpegEnv={...env,BROWSER:{async quickAction(action,options){assert.equal(options.screenshotOptions.type,'jpeg');assert.equal(options.screenshotOptions.quality,95);return new Response(jpg,{headers:{'Content-Type':'image/jpeg'}});}}};
const jpegImage=await generateImage(jpegEnv,{...form,key:key(),format:'jpg',quoteHash:fresh.quote_hash},actor,clock);assert.equal((await storedImageFile(jpegEnv,jpegImage.imageId,0,'jpg',actor)).headers.get('Content-Type'),'image/jpeg');
console.log('Image failure/JPG protocol passed: uncertain commit preserves referenced files and replays; failed upload cleans its own objects; JPG quality/dimensions/MIME/history are consistent. Actual JPG pixels remain to be verified.');
// Image backups include both immutable HTML (with original fonts) and actual file bytes.
const {storedArchive}=await import('../portable_archive.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
const recovery=await mkdtemp(join(tmpdir(),'pass-image-recovery-'));
try{
 const snapshot=await cloudSnapshot(db),objects=[],entries={'snapshot.json':JSON.stringify(snapshot)};
 for(const key of snapshot.required_media){const bytes=files.get(key)?.bytes;assert(bytes,key);objects.push({key,bytes:bytes.length,sha256:await bytesHash(bytes)});entries['objects/'+key]=bytes;}
 entries['objects.json']=JSON.stringify(objects);const archive=join(recovery,'images.zip');await writeFile(archive,new Uint8Array(await storedArchive(entries).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(recovery,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys,pathlib,hashlib; root=pathlib.Path(sys.argv[1]); d=sqlite3.connect(root/'cloud-recovery.sqlite3'); rows=d.execute('SELECT html_key,html_hash,file_key,file_hash FROM stay_pass_generated_image_pages').fetchall(); assert len(rows)==16; assert d.execute('PRAGMA foreign_key_check').fetchall()==[]; assert all(hashlib.sha256((root/'objects'/key).read_bytes()).hexdigest()==digest for row in rows for key,digest in [(row[0],row[1]),(row[2],row[3])])",join(recovery,'restored')]);
}finally{await rm(recovery,{recursive:true,force:true});}
console.log('Image recovery passed: snapshots, sixteen original HTML/image pairs, embedded fonts, file hashes, protective schema and foreign keys survive portable restore.');
// A balanced but not yet classified restoration must not produce a misleading progress bar.
const purchaseLot=sqlite.prepare("SELECT * FROM stay_pass_credit_lots WHERE pass_id=? AND source_kind='purchase'").get(sold.passId);
for(const [kind,delta] of [['stay_consumption',-1],['credit_restoration',1]]){
 const lot=sqlite.prepare('SELECT * FROM stay_pass_credit_lots WHERE id=?').get(purchaseLot.id),revision=sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(sold.passId).revision,op=crypto.randomUUID();
 sqlite.prepare('INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?)').run(op,sold.passId,key(),'fixture',revision,kind,'Synthetic restoration review',clock.toISOString());
 sqlite.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at) VALUES(?,?,?,?,?,?,0,0,?,?,0,0,0,0,?)`).run(crypto.randomUUID(),op,sold.passId,lot.id,kind,delta,lot.remaining_units,lot.remaining_units+delta,clock.toISOString());
 sqlite.prepare("UPDATE stay_pass_operations SET result='{}' WHERE id=?").run(op);sqlite.prepare('UPDATE stay_passes SET revision=revision+1 WHERE id=?').run(sold.passId);
}
await assert.rejects(()=>prepareImage(db,input,actor,clock),e=>e.code==='image_credit_review_required');assert.equal((await storedImageFile(env,saved.imageId,0,'png',actor)).status,200);
console.log('Image conservation guard passed: unclassified restorations require review; original images remain accessible and unchanged.');
