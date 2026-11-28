import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {extensionPrice,quoteStayExtension,extendStay} from './stay_extensions.mjs';
import {overnightPricing} from './boarding_pricing.mjs';
const sql=new DatabaseSync(':memory:');sql.exec(`
CREATE TABLE app_users(id INTEGER PRIMARY KEY,active);CREATE TABLE staff_access_identities(user_id,email);
INSERT INTO app_users VALUES(1,1);INSERT INTO staff_access_identities VALUES(1,'staff@example.test');
CREATE TABLE stays(id INTEGER PRIMARY KEY,customer_id,checkin,checkout,charged_nights,agreed_total,status,cancelled_at,cloud_revision,intake,payment_tracking,actual_checkin_at,actual_checkout_at);
CREATE TABLE stay_dogs(stay_id,dog_id,nightly_rate_cents);
CREATE TABLE transactions(id INTEGER PRIMARY KEY,occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,payment_type,payment_key UNIQUE,received_time);
CREATE TABLE system_settings(key,value);CREATE TABLE shop_holidays(id,starts_on,ends_on);
CREATE TABLE appointments(id INTEGER PRIMARY KEY,checkin,checkout,status,stay_id);CREATE TABLE appointment_dogs(appointment_id,dog_id);
`);sql.exec(await readFile(new URL('./boarding_charges.sql',import.meta.url),'utf8'));
const db={prepare(text){return {bind:(...values)=>({first:async()=>sql.prepare(text).get(...values),all:async()=>({results:sql.prepare(text).all(...values)}),run:()=>{const r=sql.prepare(text).run(...values);return {meta:{changes:r.changes}};}})};},async batch(rows){sql.exec('BEGIN IMMEDIATE');try{const result=rows.map(r=>r.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const actor={id:1,email:'staff@example.test'},now=new Date().toISOString().slice(0,10);
const price=overnightPricing({pricingVersion:1,service:'overnight',checkin:'2026-01-01',checkout:'2026-01-03',checkinTime:'14:00',checkoutTime:'17:00',quantity100:200,dogs:[{id:1,rate:50000}]});
sql.prepare('INSERT INTO stays VALUES(1,1,?,?,?,?,?,NULL,?,?,1,NULL,NULL)').run('2026-01-01','2026-01-03',2,1000,'checked_in',crypto.randomUUID(),JSON.stringify({service_type:'overnight',arrival_time:'14:00',pickup_time:'17:00'}));
sql.exec('INSERT INTO stay_dogs VALUES(1,1,50000)');sql.prepare('INSERT INTO boarding_charges(stay_id,details) VALUES(1,?)').run(JSON.stringify(price));
sql.prepare("INSERT INTO transactions(stay_id,amount,payment_type,kind,payment_key) VALUES(1,600,'checkin','income','old')").run();
const input={checkout:'2026-01-04',checkoutTime:'14:00'};
let quote=await quoteStayExtension(db,1,input,actor);
assert.equal(quote.status,'ready');assert.equal(quote.added_cents,37500);assert.equal(quote.total_cents,137500);assert.equal(quote.due_cents,77500);
assert.equal((await quoteStayExtension(db,1,{...input,checkout:'2026-01-03',checkoutTime:'17:00'},actor)).status,'invalid');
assert.equal((await quoteStayExtension(db,1,input,{id:1,email:'other'})).status,'not_found');
const form={...input,quoteHash:quote.quote_hash,key:'a'.repeat(32),reason:'Customer requested extra night',payment:{amountCents:20000,paymentDate:now,receivedTime:'09:00'}};
assert.equal((await extendStay(db,1,{...form,payment:{...form.payment,amountCents:80000}},actor)).status,'payment_exceeds');
// Failure after the stay update must restore dates, money and audit history.
sql.exec("CREATE TRIGGER fail_extension BEFORE INSERT ON transactions WHEN NEW.payment_key='"+'a'.repeat(32)+"' BEGIN SELECT RAISE(ABORT,'injected');END");
await assert.rejects(()=>extendStay(db,1,form,actor),/injected/);
assert.equal(sql.prepare('SELECT checkout FROM stays').get().checkout,'2026-01-03');assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);
sql.exec('DROP TRIGGER fail_extension');
const result=await extendStay(db,1,form,actor);assert.equal(result.status,'saved');assert.equal(result.due_cents,57500);
assert.equal((await extendStay(db,1,form,actor)).duplicate,true);
assert.equal((await extendStay(db,1,{...form,reason:'Changed retry'},actor)).status,'conflict');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,2);
const saved=JSON.parse(sql.prepare('SELECT details FROM boarding_charges WHERE stay_id=1').get().details);assert.equal(saved.extensions[0].before.total_cents,100000);assert.equal(saved.extensions[0].payment_cents,20000);
// Extending within the existing free grace window changes the appointment,
// keeps the charge unchanged and does not create a zero-value receipt.
let freeQuote=await quoteStayExtension(db,1,{checkout:'2026-01-04',checkoutTime:'15:00'},actor);
assert.equal(freeQuote.added_cents,0);
assert.equal((await extendStay(db,1,{checkout:'2026-01-04',checkoutTime:'15:00',reason:'Grace window',key:'d'.repeat(32),quoteHash:freeQuote.quote_hash},actor)).status,'saved');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,2);
assert.equal(JSON.parse(sql.prepare('SELECT details FROM boarding_charges WHERE stay_id=1').get().details).extensions.length,2);
// Any intervening payment invalidates the displayed quote.
quote=await quoteStayExtension(db,1,{checkout:'2026-01-05',checkoutTime:'14:00'},actor);
sql.exec("INSERT INTO transactions(stay_id,amount,payment_type,kind,payment_key) VALUES(1,1,'additional','income','concurrent')");
assert.equal((await extendStay(db,1,{...form,checkout:'2026-01-05',key:'b'.repeat(32),quoteHash:quote.quote_hash},actor)).status,'conflict');
// Expanding into occupied dates cannot silently override capacity.
sql.exec("INSERT INTO system_settings VALUES('capacity','1');INSERT INTO stays(id,checkin,checkout,status,payment_tracking) VALUES(2,'2026-01-05','2026-01-06','checked_in',1);INSERT INTO stay_dogs VALUES(2,2,50000)");
quote=await quoteStayExtension(db,1,{checkout:'2026-01-05',checkoutTime:'14:00'},actor);assert(quote.warnings.includes('capacity'));
assert.equal((await extendStay(db,1,{...form,checkout:'2026-01-05',key:'c'.repeat(32),quoteHash:quote.quote_hash},actor)).status,'capacity_review_required');
const fake={service_type:'overnight',checkin:'2026-01-01',checkout:'2026-01-03',charged_nights:2,total_cents:100000,intake:{}};
assert.equal(extensionPrice(fake,{...price,stay_pass:{}},[{id:1,nightly_rate_cents:50000}],input).status,'pass_review_required');
assert.equal(extensionPrice(fake,null,[{id:1,nightly_rate_cents:50000}],input).status,'missing_original_time');
sql.exec("UPDATE stays SET status='completed' WHERE id=1");assert.equal((await quoteStayExtension(db,1,input,actor)).status,'stay_closed');
console.log('Stay extensions passed: preserved agreed total, late-fee delta, partial cash, atomic rollback, replay, changed retry, stale payment, capacity and Pass safeguards.');
