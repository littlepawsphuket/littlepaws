import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {bookingForecast,pendingBookings,bookingCalendar} from './bookings.mjs';
import {careTemplates,validCareTemplates,defaultCareTemplates,englishCareTemplates} from './care_templates.mjs';
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE appointments(id INTEGER PRIMARY KEY,booking_number,customer_id,checkin,checkout,charged_nights,agreed_total,status,stay_id);
CREATE TABLE customers(id INTEGER PRIMARY KEY,name);CREATE TABLE dogs(id INTEGER PRIMARY KEY,name,customer_id,archived);
CREATE TABLE dog_photos(dog_id);CREATE TABLE appointment_dogs(appointment_id,dog_id,nightly_rate_cents);
CREATE TABLE boarding_charges(appointment_id,stay_id,details);
CREATE TABLE transactions(deposit_appointment_id,payment_type,amount);CREATE TABLE shop_holidays(id,name,starts_on,ends_on);
INSERT INTO customers VALUES(1,'Test');INSERT INTO dogs VALUES(1,'Dog',1,0);`);
for(let i=1;i<=30;i++){
 sql.prepare(`INSERT INTO appointments VALUES(?,?,1,'2026-11-01','2026-11-04',3,1000,'pending',NULL)`).run(i,'TEST'+i);
 sql.prepare('INSERT INTO appointment_dogs VALUES(?,1,30000)').run(i);
}
sql.exec(`INSERT INTO transactions VALUES(1,'deposit',200);
INSERT INTO appointments VALUES(31,'UNPRICED',1,'2026-12-01','2026-12-04',3,0,'pending',NULL),
(32,'CANCEL',1,'2026-11-01','2026-11-04',3,9999,'cancelled',NULL),
(33,'CHECKED',1,'2026-11-01','2026-11-04',3,9999,'pending',9);`);
const db={prepare:query=>({bind:(...args)=>({first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)})})})};
db.batch=async queries=>Promise.all(queries.map(q=>q.all()));
const summary=await bookingForecast(db);
assert.deepEqual({...summary},{booking_count:31,unpriced_count:1,total_cents:3000000,deposit_cents:20000,balance_cents:2980000});
const first=await pendingBookings(db,0,'');assert.equal(first.bookings.length,25);assert.deepEqual(first.forecast,summary);
const filtered=await pendingBookings(db,0,'nothing');assert.equal(filtered.bookings.length,0);assert.deepEqual(filtered.forecast,summary);
assert.deepEqual((await bookingCalendar(db,'2026-11-01','2026-11-30')).forecast,summary);
const options={food:'Food',rest:'Rest','activity:ถ่ายรูป':'ถ่ายรูป'};
for(const list of Object.values(defaultCareTemplates))assert.equal(list.length,10);
const templates=careTemplates(null,options);assert.equal(templates['activity:ถ่ายรูป'].length,10);
assert.ok(templates['activity:ถ่ายรูป'].every(text=>text.includes('ถ่ายรูป')));
assert.equal(validCareTemplates(templates,options),true);
assert.equal(validCareTemplates({food:['a'.repeat(501)]},options),false);
assert.equal(validCareTemplates({unknown:['Hi']},options),false);
assert.deepEqual(careTemplates(JSON.stringify({food:[]}),options).food,[]);
console.log('Booking forecast passed: all pages, filters, cancelled/checked-in exclusions, unpriced totals; template defaults and validation passed.');
const {systemSettings,saveSystemSetting}=await import('./system_settings.mjs');
sql.exec(`CREATE TABLE system_settings(key PRIMARY KEY,value);CREATE TABLE app_users(id PRIMARY KEY,active,is_admin);CREATE TABLE staff_access_identities(user_id,email);
INSERT INTO app_users VALUES(1,1,1),(2,1,0);INSERT INTO staff_access_identities VALUES(1,'admin@example.test'),(2,'staff@example.test');`);
const settingsDb={prepare:query=>({bind:(...args)=>({first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})})})};
settingsDb.batch=async queries=>Promise.all(queries.map(q=>q.all()));
const original=await systemSettings(settingsDb);
assert.equal(original.templates.food.length,10);
const form={section:'templates',templates:{...original.templates,food:['A warm message 🩷']},revisions:original.revisions};
assert.equal(await saveSystemSetting(settingsDb,form,{id:2,email:'staff@example.test'}),'conflict');
assert.equal(await saveSystemSetting(settingsDb,form,{id:1,email:'admin@example.test'}),'saved');
assert.equal(await saveSystemSetting(settingsDb,form,{id:1,email:'admin@example.test'}),'conflict');
assert.deepEqual((await systemSettings(settingsDb)).templates.food,['A warm message 🩷']);
assert.equal(await saveSystemSetting(settingsDb,{...form,templates:{food:['x'.repeat(501)]}},{id:1,email:'admin@example.test'}),'invalid');
console.log('Settings round trip passed: admin-only, conflict protection, persistence, invalid text rejected.');

for(const list of Object.values(englishCareTemplates))assert.equal(list.length,10);
const current=await systemSettings(settingsDb);
const bilingual={section:'templates',templates:{en:{food:['English draft 🩷']}},revisions:current.revisions};
assert.equal(await saveSystemSetting(settingsDb,bilingual,{id:1,email:'admin@example.test'}),'saved');
const saved=await systemSettings(settingsDb);assert.deepEqual(saved.templates.food,['A warm message 🩷']);assert.deepEqual(saved.templates_en.food,['English draft 🩷']);
assert.equal(saved.templates_en.rest.length,10);
assert.equal(validCareTemplates({th:{en:{food:['bad']}}},options),false);
console.log('Bilingual templates passed: ten per category/language, independent editing, legacy drafts retained.');
