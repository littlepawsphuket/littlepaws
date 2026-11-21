import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {overnightPricing,savedBoardingPrice} from './boarding_pricing.mjs';
import {bookingValues,saveBooking} from './booking_writes.mjs';
import {checkInBooking,checkInDirect,previewDirectStay,previewCheckInCoupon,checkInTerms} from './check_in.mjs';
import {stayPaymentSnapshot,editStay} from './stay_edits.mjs';
import {documentHtml} from './document_layout.mjs';
import {booking as fixture} from './test_customer_image_fixtures.mjs';
const base={pricingVersion:1,customerId:1,service:'overnight',checkin:'2026-01-01',checkout:'2026-01-03',
 checkinTime:'14:00',checkoutTime:'17:00',quantity100:200,discountCents:0,dogs:[{id:1,rate:50000}],note:'',wholeBaht:true};
assert.equal(bookingValues(base).netCents,112500); // Poster: M, 51 hours, 2 days +25%.
for(const [time,percent] of [['16:00',0],['16:01',25],['20:00',25],['20:01',50]])assert.equal(overnightPricing({...base,checkoutTime:time}).percent,percent);
assert.equal(overnightPricing({...base,checkinTime:'08:00',checkoutTime:'20:00'}).percent,50);
assert.equal(overnightPricing({...base,checkinTime:'08:00',checkoutTime:'20:01'}).percent,100);
assert.equal(overnightPricing({...base,quantity100:300}).extra_minutes,0);
assert.equal(overnightPricing({...base,service:'monthly'}).fee_cents,0);
assert.equal(overnightPricing({...base,service:'daycare'}).fee_cents,0);
assert.equal(overnightPricing({...base,checkout:'2025-12-31'}),null);
assert.equal(overnightPricing({...base,checkinTime:'24:00'}),null);
assert.equal(overnightPricing({...base,dogs:[{id:1,rate:49999}]}).fee_cents,12400);
assert.equal(overnightPricing({...base,dogs:[{id:1,rate:40000},{id:2,rate:60000}]}).fee_cents,25000);
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE customers(id INTEGER PRIMARY KEY,name,archived DEFAULT 0);INSERT INTO customers VALUES(1,'Owner',0);
CREATE TABLE dogs(id INTEGER PRIMARY KEY,customer_id,name,archived DEFAULT 0);INSERT INTO dogs VALUES(1,1,'Dog',0);
CREATE TABLE app_users(id INTEGER PRIMARY KEY,active);INSERT INTO app_users VALUES(1,1),(2,0);
CREATE TABLE staff_access_identities(user_id,email);INSERT INTO staff_access_identities VALUES(1,'staff@example.test'),(2,'off@example.test');
CREATE TABLE system_settings(key PRIMARY KEY,value);CREATE TABLE shop_holidays(id,name,starts_on,ends_on);
CREATE TABLE appointments(id INTEGER PRIMARY KEY,customer_id,checkin,checkout,charged_nights,agreed_total,note,discount_cents DEFAULT 0,
 rounding_cents DEFAULT 0,service_type DEFAULT 'overnight',create_key UNIQUE,booking_number UNIQUE,booked_at,cloud_revision,status DEFAULT 'pending',stay_id);
CREATE TABLE appointment_dogs(appointment_id,dog_id,nightly_rate_cents);
CREATE TABLE stays(id INTEGER PRIMARY KEY,customer_id,checkin,checkout,charged_nights,agreed_total,status,note,discount_cents DEFAULT 0,
 rounding_cents DEFAULT 0,actual_checkin_at,actual_checkout_at,intake,payment_tracking,create_key UNIQUE,stay_number UNIQUE,direct_checkin_key UNIQUE,cancelled_at,cloud_revision);
CREATE TABLE stay_dogs(stay_id,dog_id,nightly_rate_cents);
CREATE TABLE stay_consents(id INTEGER PRIMARY KEY,stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en);
CREATE TABLE transactions(id INTEGER PRIMARY KEY,occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,payment_type DEFAULT '',payment_key,received_time,deposit_appointment_id,auto_stay DEFAULT 0);
CREATE TABLE care_share_links(stay_id,dog_id);
CREATE TABLE coupons(id INTEGER PRIMARY KEY,code,kind,value,minimum_cents,max_uses,expires_on,archived);
CREATE TABLE coupon_uses(stay_id,coupon_id,discount_cents,used_at);
INSERT INTO coupons VALUES(1,'123456','percent',1000,0,100,'2099-01-01',0);
`);
sqlite.exec(await readFile(new URL('./boarding_charges.sql',import.meta.url),'utf8'));
const db={prepare(sql){return {bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),
 run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})})};},async batch(statements){sqlite.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
// D1 batch supports mixed read/write statements and reports changes for each write.
db.batch=async statements=>{sqlite.exec('BEGIN');try{const rows=[];for(const s of statements){const rowsPart=await s.all();rows.push(rowsPart);}sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
// all() on SQLite writes does not expose changes; use total_changes() difference like D1's metadata.
const prepare=db.prepare;db.prepare=sql=>{const entry=prepare(sql);return {bind:(...args)=>{const bound=entry.bind(...args);return {...bound,all:async()=>{const before=sqlite.prepare('SELECT total_changes() n').get().n;const result=sqlite.prepare(sql).all(...args);return {results:result,meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};}};}};};
const actor={id:1,email:'staff@example.test'};
let booking=await saveBooking(db,null,{...base,key:'1'.repeat(32)},actor);assert.equal(booking.status,'created');
const id=booking.id;assert.equal(sqlite.prepare('SELECT agreed_total FROM appointments WHERE id=?').get(id).agreed_total,1125);
assert.equal((await savedBoardingPrice(db,'booking',id)).fee_cents,12500);
const revision=sqlite.prepare('SELECT cloud_revision FROM appointments WHERE id=?').get(id).cloud_revision;
const timing={bookingId:id,revision,pricingVersion:1,arrivalDay:base.checkin,arrivalTime:'14:00',pickupDay:base.checkout,pickupTime:'17:00',quantity100:200};
assert.equal((await previewDirectStay(db,timing,actor)).total_cents,112500);
assert.equal((await previewDirectStay(db,{...timing,pickupTime:'21:00'},actor)).total_cents,125000);
assert.equal((await previewDirectStay(db,timing,{id:2,email:'off@example.test'})).status,'not_found');
sqlite.prepare("INSERT INTO transactions(deposit_appointment_id,amount,payment_type) VALUES(?,400,'deposit')").run(id);
const coupon=await previewCheckInCoupon(db,{...timing,code:'123456'},actor);assert.equal(coupon.total_cents,101200);assert.equal(coupon.balance_cents,61200);
const consent={revision:null,language:'th',version:checkInTerms('th').version,accepted:true,signature:[[[0,0],[100,100]]],
 paymentDate:'2026-01-01',receivedTime:'14:00',key:'2'.repeat(32),intake:{},amountCents:20000};
let stay=await checkInBooking(db,id,{...consent,...timing,expectedBalance:61200,couponCode:'123456'},actor);
assert.equal(stay.status,'created');assert.equal(sqlite.prepare('SELECT agreed_total FROM stays WHERE id=?').get(stay.stayId).agreed_total,1012);
assert.equal((await savedBoardingPrice(db,'stay',stay.stayId)).fee_cents,12500);
assert.equal(sqlite.prepare('SELECT SUM(amount) total FROM transactions WHERE stay_id=?').get(stay.stayId).total,600);
assert.equal((await checkInBooking(db,id,{...consent,...timing,expectedBalance:61200,couponCode:'123456'},actor)).status,'saved');
// A pre-existing reservation has no policy snapshot and must keep its agreed amount, even with a later pickup.
sqlite.exec("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights,agreed_total,note,cloud_revision) VALUES(100,1,'2026-01-01','2026-01-03',2,1000,'',NULL); INSERT INTO appointment_dogs VALUES(100,1,50000);");
const old={...timing,bookingId:100,revision:null,pickupTime:'23:00'};
const oldPreview=await previewDirectStay(db,old,actor);assert.equal(oldPreview.total_cents,100000);assert.equal(oldPreview.pricing.grandfathered,true);assert.equal(oldPreview.pricing.fee_cents,0);
const oldStay=await checkInBooking(db,100,{...consent,...old,key:'3'.repeat(32),amountCents:100000,expectedBalance:100000},actor);
assert.equal(oldStay.status,'created');assert.equal(sqlite.prepare('SELECT agreed_total FROM stays WHERE id=?').get(oldStay.stayId).agreed_total,1000);
assert.equal((await savedBoardingPrice(db,'stay',oldStay.stayId)).grandfathered,true);
// A checked-in legacy stay keeps its agreed total when timing/quantity are edited.
const legacyStayId=oldStay.stayId;
const snapshot=sqlite.prepare('SELECT ('+stayPaymentSnapshot+') snapshot FROM stays s WHERE id=?').get(legacyStayId).snapshot;
const editForm={...base,checkin:'2026-01-01',checkout:'2026-01-05',checkoutTime:'23:00',quantity100:100,
  revision:sqlite.prepare('SELECT cloud_revision FROM stays WHERE id=?').get(legacyStayId).cloud_revision,intake:{},couponCode:'',paymentSnapshot:snapshot};
let edit=await editStay(db,legacyStayId,editForm,actor);
if(edit.status==='warning')edit=await editStay(db,legacyStayId,{...editForm,warningToken:edit.token},actor);
assert.equal(edit.status,'saved');
assert.equal(sqlite.prepare('SELECT agreed_total FROM stays WHERE id=?').get(legacyStayId).agreed_total,1000);
assert.equal(sqlite.prepare('SELECT SUM(amount) amount FROM transactions WHERE stay_id=?').get(legacyStayId).amount,1000);
// Editing a legacy booking must also retain its original agreed price.
sqlite.exec("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights,agreed_total,note,cloud_revision) VALUES(101,1,'2026-03-01','2026-03-03',2,777,'',NULL); INSERT INTO appointment_dogs VALUES(101,1,50000);");
let legacyEdit=await saveBooking(db,101,{...base,checkin:'2026-03-01',checkout:'2026-03-03',checkoutTime:'23:00',revision:null},actor);
if(legacyEdit.status==='warning')legacyEdit=await saveBooking(db,101,{...base,checkin:'2026-03-01',checkout:'2026-03-03',checkoutTime:'23:00',revision:null,warningToken:legacyEdit.token},actor);
assert.equal(legacyEdit.status,'saved');
assert.equal(sqlite.prepare('SELECT agreed_total FROM appointments WHERE id=101').get().agreed_total,777);
assert.equal((await savedBoardingPrice(db,'booking',101)).grandfathered,true);
// Direct check-in calculates from the current submitted timing, with full backend recalculation.
const directDraft={...base,checkin:'2026-02-01',checkout:'2026-02-03'};
const direct=await checkInDirect(db,{...consent,pricingVersion:1,arrivalDay:directDraft.checkin,arrivalTime:'14:00',pickupDay:directDraft.checkout,pickupTime:'17:00',quantity100:200,
 amountCents:112500,expectedBalance:112500,key:'4'.repeat(32),draft:directDraft},actor);
assert.equal(direct.status,'created');assert.equal((await savedBoardingPrice(db,'stay',direct.stayId)).fee_cents,12500);
for(const format of ['pdf','png'])for(const lang of ['th','en']){
 const html=documentHtml({...fixture,format,lang,pricing:overnightPricing(base),kind:'booking'});
 assert.ok(html.includes('17:00'));assert.ok(html.includes('125.00'));assert.ok(html.includes('25%'));assert.ok(html.includes(lang==='th'?'รับกลับล่าช้า':'Late check-out'));
}
console.log('Boarding pricing passed: poster example, exact thresholds, per-dog/whole-baht fees, edited days, legacy prices, D1 booking/check-in snapshots, deposits/coupons/partial payments, TH/EN PDF/PNG.');
