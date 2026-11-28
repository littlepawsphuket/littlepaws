import {quotePassCheckout,confirmPassCheckout} from '../checkout.mjs';
import {quoteCancellation,confirmCancellation} from '../cancellations.mjs';
import {quotePassBooking,convertPassBooking} from '../booking.mjs';
import {imageFontManifest,imageFontKey} from '../image_assets.mjs';
import {virtualCardPage} from '../virtual_prototype.mjs';
import {overnightPricing} from '../../boarding_pricing.mjs';
import {quoteStayExtension,extendStay} from '../../stay_extensions.mjs';
import {bookingDetails,pendingBookings} from '../../bookings.mjs';
import {outstandingPage} from '../../staff_ui.mjs';
import {checkInTerms} from '../../check_in.mjs';
import {linkedPassBooking,quotePassCheckin,checkInPassBooking} from '../checkin.mjs';
import {thaiDay} from '../rules.mjs';
// LOCAL SYNTHETIC PREVIEW ONLY. Not a production Worker or authentication replacement.
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {stayPassRoute} from '../routes.mjs';
import {recordPaidSale,quoteSale} from '../sales.mjs';
import {initialPlan} from '../pricing.mjs';
import {savePlan,savePrice} from '../repository.mjs';
import {staffAsset} from '../../staff_assets.mjs';
import {prototypePage} from '../prototype.mjs';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE app_users(id INTEGER PRIMARY KEY,active,is_admin);INSERT INTO app_users VALUES(1,1,1);
CREATE TABLE staff_access_identities(user_id,email);INSERT INTO staff_access_identities VALUES(1,'preview@example.test');
CREATE TABLE customers(id INTEGER PRIMARY KEY,name,archived DEFAULT 0,owner_phone DEFAULT '',line_id DEFAULT '',contact DEFAULT '');INSERT INTO customers(id,name) VALUES(1,'Demo family');CREATE TABLE dogs(id INTEGER PRIMARY KEY,name,customer_id,size,archived DEFAULT 0);INSERT INTO dogs(id,name,customer_id,size) VALUES(1,'Mali (Demo)',1,'small'),(2,'Cocoa (Demo)',1,'small'),(3,'Mochi (Demo)',1,'large');
CREATE TABLE appointments(id INTEGER PRIMARY KEY,booking_number,customer_id,stay_id,status DEFAULT 'pending',checkin,checkout,charged_nights,service_type,discount_cents DEFAULT 0,cloud_revision);CREATE TABLE appointment_dogs(appointment_id,dog_id,nightly_rate_cents);CREATE TABLE stays(id INTEGER PRIMARY KEY,customer_id,status,cancelled_at,checkin,checkout,actual_checkin_at,actual_checkout_at);CREATE TABLE stay_dogs(stay_id,dog_id);CREATE TABLE system_settings(key PRIMARY KEY,value);INSERT INTO system_settings VALUES('capacity','6');CREATE TABLE shop_holidays(id INTEGER PRIMARY KEY,starts_on,ends_on);CREATE TABLE boarding_charges(appointment_id UNIQUE,stay_id UNIQUE,details);
CREATE TABLE transactions(id INTEGER PRIMARY KEY,occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,reference,payment_type DEFAULT '',payment_key,received_time,deposit_appointment_id);
`);sqlite.exec(await readFile(new URL('../migrations/001_foundation.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/002_sales.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/003_booking_allocations.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/004_integer_guards.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/005_booking_settlements.sql',import.meta.url),'utf8'));
sqlite.exec('ALTER TABLE appointments ADD COLUMN agreed_total REAL DEFAULT 7200');sqlite.exec(await readFile(new URL('../migrations/006_booking_conversion.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/007_refunds.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/008_renewals.sql',import.meta.url),'utf8'));
sqlite.exec(await readFile(new URL('../migrations/009_images.sql',import.meta.url),'utf8'));
const db={prepare(sql){let args=[];const stmt={bind(...values){args=values;return stmt;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)?{results:sqlite.prepare(sql).all(...args)}:{results:[],meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};return stmt;},async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.all());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const rawBatch=db.batch.bind(db);let batchTail=Promise.resolve();db.batch=stmts=>{const task=batchTail.then(()=>rawBatch(stmts));batchTail=task.catch(()=>{});return task;};
const actor={id:1,email:'preview@example.test',is_admin:1,display_name:'Local preview · ข้อมูลจำลอง'},now=(process.env.STAY_PASS_CHECKOUT_DEMO==='1'||process.env.STAY_PASS_DAYCARE_DEMO==='1')?new Date(thaiDay(new Date(Date.now()-86400000).toISOString())+'T12:00:00+07:00'):new Date();
const plan=await savePlan(db,{planId:null,code:'LP-SP-15',expectedRevision:0,config:initialPlan(),reason:'Local synthetic preview only',key:'a'.repeat(32)},actor,now);
await savePrice(db,{planId:plan.planId,planVersionId:plan.id,expectedRevision:1,effectiveAt:null,reason:'Synthetic initial prices',key:'b'.repeat(32)},actor,now);
if(process.env.STAY_PASS_DEMO_ROWS==='1'){
 sqlite.prepare("INSERT INTO stay_pass_policy_versions(id,version,content_th,content_en,content_hash,status,created_at,actor_id,approved_at,approved_by) VALUES('demo-policy','1.5','DEMO ONLY - NOT CUSTOMER TERMS','DEMO ONLY - NOT CUSTOMER TERMS','demo','approved',?,1,?,1)").run(now.toISOString(),now.toISOString());
 const base={planId:plan.planId,customerId:1,size:'small',dogIds:[1,2]},quote=await quoteSale(db,base,actor,now);
 await recordPaidSale(db,{...base,key:'c'.repeat(32),quoteHash:quote.quote_hash,paidCents:510000,paymentMethod:'cash',reference:'DEMO',reason:'Synthetic local preview',acceptance:{confirmed:true,channel:'document',evidence:'DEMO ONLY',acceptedAt:now.toISOString()}},actor,now);
 const first=new Date(Date.parse(thaiDay(now.toISOString())+'T12:00:00Z')+(process.env.STAY_PASS_PARTIAL_CASH_DEMO==='1'?3:process.env.STAY_PASS_CANCELLATION_DEMO==='1'?10:0)*86400000).toISOString().slice(0,10),last=new Date(Date.parse(first+'T12:00:00Z')+(process.env.STAY_PASS_PARTIAL_CASH_DEMO==='1'?8:process.env.STAY_PASS_CANCELLATION_DEMO==='1'?3:8)*86400000).toISOString().slice(0,10);
 sqlite.prepare("INSERT INTO appointments(id,booking_number,customer_id,checkin,checkout,charged_nights,service_type,cloud_revision) VALUES(1,'DEMO01',1,?,?,?,'overnight','demo-booking')").run(first,last,process.env.STAY_PASS_PARTIAL_CASH_DEMO==='1'?8:process.env.STAY_PASS_CANCELLATION_DEMO==='1'?3:8);
 sqlite.exec(process.env.STAY_PASS_PARTIAL_CASH_DEMO==='1'?'INSERT INTO appointment_dogs VALUES(1,1,40000),(1,2,40000)':'INSERT INTO appointment_dogs VALUES(1,1,40000),(1,2,50000)');sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(1,?)').run(JSON.stringify({version:1,checkin_time:'14:00',checkout_time:process.env.STAY_PASS_CANCELLATION_DEMO==='1'?'14:00':'17:00'}));
}
for(const [table,fields] of Object.entries({appointments:["note TEXT DEFAULT ''","rounding_cents INTEGER DEFAULT 0"],stays:["cloud_revision TEXT","agreed_total REAL DEFAULT 0","charged_nights INTEGER DEFAULT 1","note TEXT DEFAULT ''","discount_cents INTEGER DEFAULT 0","rounding_cents INTEGER DEFAULT 0","intake TEXT DEFAULT '{}'","payment_tracking INTEGER DEFAULT 0","create_key TEXT","stay_number TEXT"],stay_dogs:['nightly_rate_cents INTEGER']}))for(const field of fields)sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${field}`);
sqlite.exec('CREATE UNIQUE INDEX demo_stay_number ON stays(stay_number);CREATE UNIQUE INDEX demo_stay_create ON stays(create_key);CREATE TABLE stay_consents(id INTEGER PRIMARY KEY,stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en);CREATE TABLE dog_photos(dog_id,object_key)');
for(const name of ['010_checkout_review.sql','011_checkout_commits.sql','012_booking_cancellations.sql','013_stay_extensions.sql','014_cancelled_booking_cash.sql','015_partial_cancellation_cash.sql','016_stay_cash.sql','017_lifecycle.sql','018_image_template_settings.sql','019_transfers.sql','020_sale_windows.sql','021_pet_registration.sql','022_sale_drafts.sql','023_policy_approvals.sql'])sqlite.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
if(process.env.STAY_PASS_DEMO_ROWS==='1'&&process.env.STAY_PASS_CANCELLATION_DEMO!=='1'&&process.env.STAY_PASS_DAYCARE_DEMO!=='1')sqlite.prepare("INSERT INTO transactions(kind,amount,customer_id,deposit_appointment_id,payment_type,payment_key,occurred_on,received_time) VALUES('income',100,1,1,'deposit','demo-deposit',?,'06:00')").run(thaiDay(now.toISOString()));
if(process.env.STAY_PASS_DAYCARE_DEMO==='1'){
 if(process.env.STAY_PASS_DEMO_ROWS!=='1'||process.env.STAY_PASS_CHECKOUT_DEMO==='1')throw Error('Day Care fixture requires its own synthetic demo');
 const start=new Date(Date.now()-13*3600000);start.setUTCSeconds(0,0);const end=new Date(start.getTime()+12*3600000),local=d=>new Date(d.getTime()+7*3600000).toISOString(),a=local(start),b=local(end),passId=sqlite.prepare('SELECT id FROM stay_passes LIMIT 1').get().id;
 sqlite.prepare("UPDATE appointments SET checkin=?,checkout=?,charged_nights=1,service_type='daycare',agreed_total=200 WHERE id=1").run(a.slice(0,10),b.slice(0,10));sqlite.exec('DELETE FROM appointment_dogs WHERE appointment_id=1 AND dog_id=2;UPDATE appointment_dogs SET nightly_rate_cents=20000 WHERE appointment_id=1');sqlite.prepare('UPDATE boarding_charges SET details=? WHERE appointment_id=1').run(JSON.stringify({version:1,checkin_time:a.slice(11,16),checkout_time:b.slice(11,16)}));
 const h={passId,bookingId:1,convert:true},hq=await quotePassBooking(db,h,actor,now);const held=await convertPassBooking(db,{...h,key:'7'.repeat(32),quoteHash:hq.quote_hash,reason:'Synthetic twelve-hour Day Care booking'},actor,now);if(held.status!=='saved')throw Error('Day Care hold fixture failed');const c=await quotePassCheckin(db,1,actor,start),result=await checkInPassBooking(db,1,{accepted:true,language:'th',version:checkInTerms('th').version,signature:[[[10,10],[70,70]]],revision:c.booking_revision,arrivalDay:a.slice(0,10),arrivalTime:a.slice(11,16),pickupDay:b.slice(0,10),pickupTime:b.slice(11,16),quantity100:100,pricingVersion:1,expectedBalance:0,amountCents:0,paymentDate:a.slice(0,10),receivedTime:a.slice(11,16),key:'6'.repeat(32),intake:{},passQuoteHash:c.quote_hash},actor,start);if(result.status!=='created')throw Error('Day Care check-in fixture failed');
}
if(process.env.STAY_EXTENSION_DEMO==='1'){
 const first=thaiDay(now.toISOString()),last=new Date(Date.parse(first+'T12:00:00Z')+2*86400000).toISOString().slice(0,10);
 sqlite.prepare("INSERT INTO stays(id,customer_id,status,checkin,checkout,agreed_total,charged_nights,intake,payment_tracking,stay_number,cloud_revision) VALUES(10,1,'checked_in',?,?,1000,2,?,1,'EXT-DEMO',?)").run(first,last,JSON.stringify({service_type:'overnight',arrival_time:'14:00',pickup_time:'17:00'}),crypto.randomUUID());
 sqlite.exec('INSERT INTO stay_dogs VALUES(10,1,50000)');sqlite.prepare('INSERT INTO boarding_charges(stay_id,details) VALUES(10,?)').run(JSON.stringify(overnightPricing({pricingVersion:1,service:'overnight',checkin:first,checkout:last,checkinTime:'14:00',checkoutTime:'17:00',quantity100:200,dogs:[{id:1,rate:50000}]})));
 sqlite.prepare("INSERT INTO transactions(kind,amount,customer_id,stay_id,payment_type,payment_key,occurred_on,received_time) VALUES('income',600,1,10,'checkin','demo-extension-payment',?,'09:00')").run(first);
}
if(process.env.STAY_PASS_CHECKOUT_DEMO==='1'){
 if(process.env.STAY_PASS_DEMO_ROWS!=='1')throw Error('Checkout preview requires synthetic demo rows');
 const passId=sqlite.prepare('SELECT id FROM stay_passes LIMIT 1').get().id;
 const input={passId,bookingId:1,allocations:[{dog_id:1,credit_units:33},{dog_id:2,credit_units:27}]};
 const q=await quotePassBooking(db,input,actor,now);
 await convertPassBooking(db,{...input,key:'d'.repeat(32),quoteHash:q.quote_hash,reason:'Synthetic checkout review fixture'},actor,now);
 const c=await quotePassCheckin(db,1,actor,now),first=thaiDay(now.toISOString());
 const result=await checkInPassBooking(db,1,{accepted:true,language:'th',version:checkInTerms('th').version,signature:[[[10,10],[70,70]]],revision:c.booking_revision,arrivalDay:first,arrivalTime:'14:00',pickupDay:c.checkout,pickupTime:'17:00',quantity100:800,pricingVersion:1,expectedBalance:c.balance_cents,amountCents:20000,paymentDate:first,receivedTime:'14:01',key:'e'.repeat(32),intake:{},passQuoteHash:c.quote_hash},actor,now);
 if(result.status!=='created')throw Error('Synthetic checkout fixture failed: '+result.status);

}
if(process.env.STAY_PASS_CANCELLATION_DEMO==='1'){
 const passId=sqlite.prepare('SELECT id FROM stay_passes LIMIT 1').get().id,input={passId,bookingId:1,convert:true},q=await quotePassBooking(db,input,actor,now);const saved=await convertPassBooking(db,{...input,key:'f'.repeat(32),quoteHash:q.quote_hash,reason:'Synthetic cancellation fixture'},actor,now);if(saved.status!=='saved')throw Error('Cancellation fixture failed');
 if(process.env.STAY_PASS_PARTIAL_CASH_DEMO==='1')sqlite.prepare("INSERT INTO transactions(kind,amount,customer_id,deposit_appointment_id,payment_type) VALUES('income',?,1,1,'deposit')").run(['refund','partial_refund'].includes(process.env.STAY_PASS_BOOKING_CASH_DEMO)?400:100);
}
if(process.env.STAY_PASS_BOOKING_CASH_DEMO){
 if(!['receive','refund','partial_refund'].includes(process.env.STAY_PASS_BOOKING_CASH_DEMO)||process.env.STAY_PASS_CANCELLATION_DEMO!=='1'||process.env.STAY_PASS_PARTIAL_CASH_DEMO!=='1')throw Error('Booking cash preview requires the synthetic mixed cancellation fixture');
 const at=new Date(),input={bookingId:1,cause:'customer',notifiedAt:at.toISOString()};if(process.env.STAY_PASS_BOOKING_CASH_DEMO==='partial_refund')input.dogIds=[2];const q=await quoteCancellation(db,input,actor,at);const saved=await confirmCancellation(db,{...input,key:'9'.repeat(32),quoteHash:q.quote_hash,reason:'Synthetic cancelled-booking cash follow-up',confirmed:true},actor,at);if(saved.status!=='saved')throw Error('Synthetic cash cancellation failed');
}
if(process.env.STAY_PASS_STAY_CASH_DEMO==='1'){
 if(process.env.STAY_PASS_CHECKOUT_DEMO!=='1')throw Error('Cash preview requires synthetic checkout fixture');
 const stay=sqlite.prepare("SELECT id FROM stays WHERE status='checked_in' LIMIT 1").get();
 const at=new Date(),input={stayId:stay.id,actualCheckoutAt:at.toISOString()},q=await quotePassCheckout(db,input,actor,at);
 const result=await confirmPassCheckout(db,{...input,key:'8'.repeat(32),quoteHash:q.quote_hash,reason:'Synthetic checkout cash follow-up fixture',confirmed:true,amountCents:0,paymentDate:thaiDay(at.toISOString()),receivedTime:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at)},actor,at);
 if(result.status!=='completed')throw Error('Synthetic cash checkout failed');
}
const env={DB:db,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development',STAY_PASS_BOOKING_WRITES:process.env.STAY_PASS_BOOKING_WRITES||'0',STAY_PASS_SALES_WRITES:process.env.STAY_PASS_SALES_WRITES||'0',STAY_PASS_RENEWAL_WRITES:process.env.STAY_PASS_RENEWAL_WRITES||'0',STAY_PASS_IMAGE_WRITES:process.env.STAY_PASS_IMAGE_WRITES||'0',STAY_PASS_CANCELLATION_WRITES:process.env.STAY_PASS_CANCELLATION_WRITES||'0',STAY_PASS_PET_WRITES:process.env.STAY_PASS_PET_WRITES||'0',STAY_PASS_TRANSFER_WRITES:process.env.STAY_PASS_TRANSFER_WRITES||'0',STAY_PASS_TEMPLATE_WRITES:process.env.STAY_PASS_TEMPLATE_WRITES||'0',STAY_PASS_LIFECYCLE_WRITES:process.env.STAY_PASS_LIFECYCLE_WRITES||'0',STAY_PASS_STAY_CASH_WRITES:process.env.STAY_PASS_STAY_CASH_WRITES||'0',STAY_PASS_BOOKING_CASH_WRITES:process.env.STAY_PASS_BOOKING_CASH_WRITES||'0',STAY_PASS_EXTENSION_WRITES:process.env.STAY_PASS_EXTENSION_WRITES||'0',STAY_PASS_CHECKOUT_WRITES:process.env.STAY_PASS_CHECKOUT_WRITES||'0',STAY_PASS_REFUND_WRITES:process.env.STAY_PASS_REFUND_WRITES||'0'};
// Optional manual Chrome rendering bridge for synthetic local end-to-end tests only.
const imageObjects=new Map(),renderJobs=new Map();
if(env.STAY_PASS_IMAGE_WRITES==='1'){
 env.MEDIA={async get(key){const row=imageObjects.get(key);return row?{body:new Response(row.bytes).body,size:row.bytes.length,customMetadata:row.options?.customMetadata}:null;},async put(key,value,options){imageObjects.set(key,{bytes:typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value),options});return {};},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])imageObjects.delete(key);}};
 for(const entry of imageFontManifest)await env.MEDIA.put(imageFontKey(entry),await readFile(new URL('../prototype_assets/'+entry[1],import.meta.url)));
 if(process.env.STAY_PASS_IMAGE_RENDER_BRIDGE==='1')env.BROWSER={quickAction(action,options){if(action!=='screenshot'||options.screenshotOptions.type!=='png')throw Error('Local bridge supports PNG screenshots only');return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{renderJobs.delete(id);reject(Error('Local render bridge timed out'));},300000);renderJobs.set(id,{html:options.html,resolve,timer});});}};
}
const assets=(process.env.STAY_EXTENSION_DEMO==='1'||process.env.STAY_PASS_SKIP_PROTOTYPE_ASSETS==='1')?{}:{logo:(await readFile(new URL('../../../app/static/little-paws-logo.png',import.meta.url))).toString('base64'),thai:(await readFile(new URL('../prototype_assets/noto-sans-thai.ttf',import.meta.url))).toString('base64'),serif:(await readFile(new URL('../prototype_assets/cormorant-garamond.ttf',import.meta.url))).toString('base64')};
const port=Number(process.env.STAY_PASS_PREVIEW_PORT||18830);if(!Number.isSafeInteger(port)||port<18830||port>18839)throw Error('Invalid synthetic preview port');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);res.end();return;}
  if(process.env.STAY_PASS_IMAGE_RENDER_BRIDGE==='1'&&req.url.startsWith('/render')){
   if(req.url==='/render-complete'&&req.method==='POST'){
    let body='';for await(const c of req)body+=c;const values=new URLSearchParams(body),id=values.get('id'),job=renderJobs.get(id);if(!job){res.writeHead(404);res.end();return;}
    let bytes=Buffer.from(values.get('image')||'','base64');
    // The local CUA screenshot transport returns JPEG. Normalize its container for
    // the PNG-only test bridge; no pixels/text/logo are generated or changed by AI.
    if(bytes[0]===255&&bytes[1]===216)bytes=execFileSync(fileURLToPath(new URL('../../../.venv/bin/python',import.meta.url)),['-c',"import io,sys; from PIL import Image; image=Image.open(io.BytesIO(sys.stdin.buffer.read())); image.save(sys.stdout.buffer,format='PNG')"],{input:bytes,maxBuffer:32*1024*1024});
    if(bytes.length<33||bytes[0]!==137){res.writeHead(400);res.end('PNG required');return;}
    await writeFile('/private/tmp/stay-pass-render-'+id+'.png',bytes);clearTimeout(job.timer);renderJobs.delete(id);job.resolve(new Response(bytes,{headers:{'Content-Type':'image/png'}}));res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<p>Saved synthetic rendered PNG.</p><a href="/render-queue">Next render job</a>');return;
   }
   const match=/^\/render\/([a-f0-9-]{36})$/.exec(req.url);if(match){const job=renderJobs.get(match[1]);res.writeHead(job?200:404,{'Content-Type':'text/html; charset=utf-8'});res.end(job?.html||'No pending job');return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><h1>Synthetic image rendering queue</h1>'+[...renderJobs].map(([id])=>'<section><a href="/render/'+id+'">Render '+id+'</a><form method="post" action="/render-complete"><input type="hidden" name="id" value="'+id+'"><label>PNG screenshot<textarea name="image"></textarea></label><button>Save rendered PNG</button></form></section>').join(''));return;
  }
  if(req.url==='/proof'){
   if(req.method==='POST'){let body='';for await(const c of req)body+=c;const values=new URLSearchParams(body),name=values.get('name')||'development';if(!/^[a-z0-9-]{1,40}$/.test(name))throw Error('Invalid proof name');await writeFile('/private/tmp/stay-pass-'+name+'.png',Buffer.from(values.get('image'),'base64'));res.end('Saved');return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<form method="post" action="/proof"><label>Name<input name="name" value="development"></label><label>Image<textarea name="image"></textarea></label><button>Save screenshot</button></form>');return;
  }
  let body;if(req.method!=='GET'&&req.method!=='HEAD'){const chunks=[];for await(const c of req)chunks.push(c);body=Buffer.concat(chunks);}
  const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers,body});
  const url=new URL(request.url);let response;
  if(url.pathname==='/responsive'){
   const width=['320','375','390','430','768'].includes(url.searchParams.get('width'))?url.searchParams.get('width'):'390';const lang=url.searchParams.get('lang')==='en'?'en':'th';
   response=new Response('<!doctype html><meta charset="utf-8"><title>Synthetic responsive preview</title><style>body{margin:0;background:#ede7d9;font:16px system-ui;text-align:center}iframe{display:block;width:'+width+'px;height:1900px;margin:20px auto;border:1px solid #c4a36a;border-radius:14px;background:white}</style><h1>Stay Pass · '+width+'px · Synthetic data only</h1><iframe title="Stay Pass mobile preview" src="/stay-pass?lang='+lang+'"></iframe>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  }
  else if(/^\/api\/stays\/\d+\/extension(?:\/quote)?$/.test(url.pathname)){
   const result=await (url.pathname.endsWith('/quote')?quoteStayExtension:extendStay)(db,Number(url.pathname.split('/')[3]),await request.json(),actor);response=json(result,['ready','saved'].includes(result.status)?200:409);
  }
  else if(url.pathname==='/')response=outstandingPage(true,false,'japan','Synthetic admin',url.searchParams.get('lang')==='en'?'en':'th',true,env.STAY_PASS_BOOKING_WRITES==='1'&&env.STAY_PASS_CHECKOUT_WRITES==='1',env.STAY_PASS_BOOKING_WRITES==='1'&&env.STAY_PASS_EXTENSION_WRITES==='1');
  else if(url.pathname==='/api/bookings/pending')response=json(await pendingBookings(db,Number(url.searchParams.get('after')||0),(url.searchParams.get('q')||'').toLowerCase()));
  else if(['/api/stays/current','/api/stays/outstanding'].includes(url.pathname))response=json({stays:sqlite.prepare("SELECT s.*,c.name customer, 'Mali (Demo)' dogs,ROUND(s.agreed_total*100) total_cents,0 due_cents FROM stays s JOIN customers c ON c.id=s.customer_id WHERE s.status='checked_in'").all(),nextBefore:null});
  else if(url.pathname==='/api/care/notifications')response=json({unread_count:0,notifications:[]});
  else if(/^\/api\/bookings\/\d+\/check-in$/.test(url.pathname)){
   const id=Number(url.pathname.split('/')[3]);if(request.method==='GET')response=json(checkInTerms(url.searchParams.get('lang')));
   else{const value=await checkInPassBooking(db,id,await request.json(),actor).catch(e=>({status:e.code||'error'}));response=json(value,['created','saved','already_checked_in'].includes(value.status)?200:409);}
  }
  else if(/^\/api\/bookings\/\d+$/.test(url.pathname)){
   const id=Number(url.pathname.split('/')[3]),data=await bookingDetails(db,id);const link=await linkedPassBooking(db,id,actor);if(data&&link)data.stay_pass={pass_number:link.pass_number,credit_units:link.snapshot.settlement.covered_units,settlement:link.snapshot.settlement,...await quotePassCheckin(db,id,actor)};response=json(data);
  }
  else if(/^\/api\/customers\/\d+$/.test(url.pathname))response=json({customer:{id:1,name:'Demo family',owner_phone:'',line_id:''},dogs:sqlite.prepare('SELECT * FROM dogs WHERE customer_id=1').all()});
  else if(/^\/api\/stays\/\d+$/.test(url.pathname)){
   const id=Number(url.pathname.split('/')[3]),s=sqlite.prepare('SELECT s.*,c.name customer FROM stays s JOIN customers c ON c.id=s.customer_id WHERE s.id=?').get(id);
   if(!s)response=json({error:'not_found'},404);else{
    const payments=sqlite.prepare("SELECT *,ROUND(amount*100) amount_cents FROM transactions WHERE stay_id=? AND payment_type!=''").all(id),dogs=sqlite.prepare('SELECT d.*,sd.nightly_rate_cents FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=?').all(id),consent=sqlite.prepare('SELECT * FROM stay_consents WHERE stay_id=?').get(id),details=sqlite.prepare('SELECT details FROM boarding_charges WHERE stay_id=?').get(id);
    response=json({...s,total_cents:Math.round(s.agreed_total*100),due_cents:Math.round(s.agreed_total*100)-payments.reduce((n,t)=>n+t.amount_cents,0),service_type:'overnight',intake:JSON.parse(s.intake),dogs,payments,pricing:JSON.parse(details.details),consent,refunds:[],payment_deletions:[],timeline_views:[],refundable_cents:0,cancelled_at:null});
   }
  }
  else if(url.pathname.startsWith('/static/'))response=staffAsset(request,url.pathname.slice(8));
  else if(url.pathname==='/virtual-prototype'){
   const virtualAssets=assets.thai?assets:{logo:(await readFile(new URL('../../../app/static/little-paws-logo.png',import.meta.url))).toString('base64'),thai:(await readFile(new URL('../prototype_assets/noto-sans-thai.ttf',import.meta.url))).toString('base64'),serif:(await readFile(new URL('../prototype_assets/cormorant-garamond.ttf',import.meta.url))).toString('base64')};
   response=new Response(virtualCardPage(url.searchParams,virtualAssets),{headers:{'Content-Type':'text/html; charset=utf-8'}});
  }
  else if(url.pathname==='/prototype')response=new Response(prototypePage(url.searchParams,assets),{headers:{'Content-Type':'text/html; charset=utf-8'}});
  else response=await stayPassRoute(request,env,actor,{theme:'japan',lang:url.searchParams.get('lang')==='en'?'en':'th'});
  // Synthetic loopback harness only: allow same-origin responsive-test embedding.
  // The deployed page and its tested frame-ancestors 'none' policy remain unchanged.
  if(url.pathname==='/stay-pass'){const h=new Headers(response.headers);h.set('Content-Security-Policy',h.get('Content-Security-Policy').replace("frame-ancestors 'none'","frame-ancestors 'self'"));response=new Response(response.body,{status:response.status,headers:h});}
  if(url.pathname==='/'){const h=new Headers(response.headers);const html=(await response.text()).replace('<main>','<main><p role="status">ข้อมูลจำลองสำหรับทดสอบเท่านั้น · Synthetic data only</p>');response=new Response(html,{status:response.status,headers:h});}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Local preview error');}
}).listen(port,'127.0.0.1',()=>console.log('Synthetic Stay Pass preview http://127.0.0.1:'+port+'/stay-pass'));
