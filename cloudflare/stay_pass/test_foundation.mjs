import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {quotePassBooking,reservePassBooking,bookingCreditUnits,passBookingOptions,passOptionsForBooking} from './booking.mjs';
import {quoteSale,recordPaidSale,salesCustomers,salesPets} from './sales.mjs';
import {units,days,cents,cancellationQuote,oneYearExpiry,withinValidity,valueSlice,releaseGates} from './rules.mjs';
import {initialPlan,pricePreview,effectivePrice} from './pricing.mjs';
import {savePlan,savePrice,savePolicyDraft,catalog} from './repository.mjs';
import {applyCreditOperation,balances} from './credits.mjs';
import {stayPassRoute,previewEnabled,bookingWritesEnabled} from './routes.mjs';
import {cloudSnapshot} from '../cloud_backup.mjs';
import {storedArchive} from '../portable_archive.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const sql=await readFile(new URL('./migrations/001_foundation.sql',import.meta.url),'utf8');
const sqlite=new DatabaseSync(':memory:');sqlite.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS boarding_charges(appointment_id INTEGER UNIQUE,stay_id INTEGER UNIQUE,details);
 CREATE TABLE system_settings(key PRIMARY KEY,value);CREATE TABLE shop_holidays(id INTEGER PRIMARY KEY,starts_on,ends_on);
 CREATE TABLE app_users(id INTEGER PRIMARY KEY,active,is_admin); INSERT INTO app_users VALUES(1,1,1),(2,1,0),(3,0,1);
 CREATE TABLE staff_access_identities(user_id,email); INSERT INTO staff_access_identities VALUES(1,'admin@example.test'),(2,'staff@example.test'),(3,'off@example.test');
 CREATE TABLE customers(id INTEGER PRIMARY KEY,name,archived INTEGER DEFAULT 0); INSERT INTO customers(id,name) VALUES(1,'Synthetic owner'),(2,'Other owner');
 CREATE TABLE dogs(id INTEGER PRIMARY KEY,customer_id,name,size,archived);INSERT INTO dogs VALUES(1,1,'Test dog','small',0),(2,2,'Other','small',0),(3,1,'Large dog','large',0);
 CREATE TABLE stays(id INTEGER PRIMARY KEY,customer_id,status,cancelled_at,checkin DEFAULT '2026-01-01',checkout DEFAULT '2026-01-03',actual_checkin_at,actual_checkout_at);INSERT INTO stays(id,customer_id,status,cancelled_at) VALUES(1,1,'checked_in',NULL);
 CREATE TABLE appointments(id INTEGER PRIMARY KEY,customer_id,stay_id,status DEFAULT 'pending',checkin,checkout,charged_nights,service_type,discount_cents DEFAULT 0,cloud_revision);INSERT INTO appointments(id,customer_id,stay_id) VALUES(1,1,1);
 CREATE TABLE appointment_dogs(appointment_id,dog_id,nightly_rate_cents INTEGER DEFAULT 40000);INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(1,1),(1,3);
 CREATE TABLE stay_dogs(stay_id,dog_id);INSERT INTO stay_dogs VALUES(1,1);
 CREATE TABLE transactions(id INTEGER PRIMARY KEY,kind,amount,customer_id,receipt TEXT DEFAULT '',occurred_on TEXT,category TEXT,description TEXT,stay_id INTEGER,payment_method TEXT,reference TEXT,payment_type TEXT DEFAULT '',payment_key TEXT,received_time TEXT,deposit_appointment_id INTEGER);INSERT INTO transactions(id,kind,amount,customer_id) VALUES(1,'income',5100,1);
`);
sqlite.exec(sql);sqlite.exec(sql);const salesSql=await readFile(new URL('./migrations/002_sales.sql',import.meta.url),'utf8');sqlite.exec(salesSql);sqlite.exec(salesSql);const allocationSql=await readFile(new URL('./migrations/003_booking_allocations.sql',import.meta.url),'utf8');sqlite.exec(allocationSql);sqlite.exec(allocationSql);const integerSql=await readFile(new URL('./migrations/004_integer_guards.sql',import.meta.url),'utf8');sqlite.exec(integerSql);sqlite.exec(integerSql);sqlite.exec('ALTER TABLE appointments ADD COLUMN booking_number TEXT; ALTER TABLE appointments ADD COLUMN agreed_total REAL DEFAULT 2000');const settlementSql=await readFile(new URL('./migrations/005_booking_settlements.sql',import.meta.url),'utf8');sqlite.exec(settlementSql);sqlite.exec(settlementSql);const conversionSql=await readFile(new URL('./migrations/006_booking_conversion.sql',import.meta.url),'utf8');sqlite.exec(conversionSql);sqlite.exec(conversionSql);assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_schema_versions').get().n,6);
const db={prepare(sql){let args=[];const stmt={bind(...values){args=values;return stmt;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)?{results:sqlite.prepare(sql).all(...args)}:{results:[],meta:{changes:sqlite.prepare(sql).run(...args).changes}};},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};return stmt;},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const stmt of stmts)results.push(await stmt.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const rawBatch=db.batch.bind(db);let batchTail=Promise.resolve();db.batch=stmts=>{const work=batchTail.then(()=>rawBatch(stmts));batchTail=work.catch(()=>{});return work;};
const actor={id:1,email:'admin@example.test'},staff={id:2,email:'staff@example.test'},off={id:3,email:'off@example.test'};
const now=new Date('2026-11-26T05:00:00Z');let count=0;const key=()=> (++count).toString(16).padStart(32,'0');
for(const [value,want] of [['0',0],['0.25',1],['0.5',2],['11.75',47],['15',60]]){assert.equal(units(value),want);assert.equal(units(days(want)),want);}
for(const bad of ['0.1','-1','Infinity','NaN','1.125','1e2',null])assert.throws(()=>units(bad));assert.equal(cents('5100'),510000);assert.throws(()=>cents('1.001'));
const preview=pricePreview(initialPlan());assert.deepEqual(Object.values(preview.prices).map(p=>p.sale_cents),[510000,637500,765000]);
const manual={...initialPlan(),pricing_mode:'manual',manual_prices_cents:{small:500000,medium:600000,large:700000}};assert.equal(pricePreview(manual).prices.small.saved_cents,100000);
assert.throws(()=>pricePreview({...initialPlan(),credit_units:-1}));assert.throws(()=>pricePreview({...initialPlan(),discount_bps:10000}));
assert.throws(()=>pricePreview({...initialPlan(),daily_reference_cents:{small:40001,medium:50000,large:60000}}),/rounding/);
assert.equal(cancellationQuote({units:2,arrival:'2026-12-08T00:01:00+07:00',notified:'2026-12-01T23:59:00+07:00',cause:'customer'}).deduct_units,0);
assert.equal(cancellationQuote({units:2,arrival:'2026-12-07T00:01:00+07:00',notified:'2026-12-01T23:59:00+07:00',cause:'customer'}).deduct_units,1);
assert.equal(cancellationQuote({units:12,arrival:'2026-12-07T00:00:00+07:00',notified:'2026-12-07T12:00:00+07:00',cause:'no_show'}).deduct_units,12);
assert.throws(()=>cancellationQuote({units:1,arrival:'2026-12-07T00:00:00+07:00',notified:'2026-12-01T12:00:00+07:00',cause:'customer'}),/precision/);
assert.equal(oneYearExpiry('2026-11-26T12:00:00+07:00').last_valid_day,'2027-11-25');assert.throws(()=>oneYearExpiry('2024-02-29T12:00:00+07:00'),/approval/);
assert.equal(withinValidity('2027-11-25T23:59:59+07:00','2027-11-26T00:00:00+07:00'),true);assert.equal(withinValidity('2027-11-26T00:00:00+07:00','2027-11-26T00:00:00+07:00'),false);
assert.equal(Array.from({length:60},(_,i)=>valueSlice(510001,60,i,i+1)).reduce((a,b)=>a+b,0),510001);
assert.equal(releaseGates.sales,false);assert.equal(releaseGates.imageGenerator,false);
const create={planId:null,code:'LP-SP-15',expectedRevision:0,config:initialPlan(),reason:'Initial draft',key:key()};
let saved=await savePlan(db,create,actor,now);assert.equal(saved.status,'saved');const planId=saved.planId,versionId=saved.id;
assert.equal((await savePlan(db,create,actor,now)).replayed,true);await assert.rejects(()=>savePlan(db,{...create,reason:'Different payload'},actor,now),/idempotency/);
assert.equal((await savePlan(db,{...create,code:'BAD-ROLE',key:key()},staff,now)).status,'conflict');assert.equal((await savePlan(db,{...create,code:'INACTIVE',key:key()},off,now)).status,'conflict');
const firstPrice={planId,planVersionId:versionId,expectedRevision:1,effectiveAt:null,key:key(),reason:'Initial exact price'};
let priced=await savePrice(db,firstPrice,actor,now);assert.equal(priced.status,'saved');assert.equal((await savePrice(db,firstPrice,actor,now)).replayed,true);
let amended=await savePlan(db,{...create,planId,expectedRevision:2,config:manual,key:key(),reason:'New future quote config'},actor,now);assert.equal(amended.status,'saved');
const future={planId,planVersionId:amended.id,expectedRevision:3,effectiveAt:'2026-12-01T00:00:00+07:00',reason:'Scheduled price',key:key()};assert.equal((await savePrice(db,future,actor,now)).status,'saved');
let cat=await catalog(db);assert.equal(cat.versions.length,2);assert.equal(cat.prices.length,2);
assert.equal(effectivePrice(cat.prices,now.toISOString()).plan_version_id,versionId);assert.equal(effectivePrice(cat.prices,'2026-12-02T00:00:00+07:00').plan_version_id,amended.id);
assert.equal(cat.prices.find(v=>v.plan_version_id===versionId).effective_until,'2026-11-30T17:00:00.000Z');
assert.equal((await savePrice(db,{...future,expectedRevision:4,key:key()},actor,now)).status,'conflict');
await assert.rejects(()=>savePrice(db,{...future,effectiveAt:'2026-01-01T00:00:00Z',key:key()},actor,now),/backdated/);
let restored=await savePrice(db,{planId,planVersionId:versionId,expectedRevision:4,effectiveAt:'2026-12-10T00:00:00+07:00',copiedFrom:priced.id,key:key(),reason:'Restore by new version'},actor,now);assert.equal(restored.status,'saved');
assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_price_versions').get().n,3);
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_price_versions SET prices=? WHERE id=?').run('{}',priced.id),/immutable/);
assert.throws(()=>sqlite.prepare('DELETE FROM stay_pass_plan_versions WHERE id=?').run(versionId),/immutable/);
sqlite.prepare(`INSERT INTO stay_pass_policy_versions(id,version,content_th,content_en,content_hash,status,created_at,actor_id) VALUES('policy','1.5','','','draft-hash','draft',?,1)`).run(now.toISOString());
sqlite.prepare(`INSERT INTO stay_passes(id,pass_number,customer_id,plan_version_id,price_version_id,policy_version_id,size,snapshot,purchase_at,expires_at,status)
 VALUES('pass','TEST-PASS',1,?,?,'policy','small',?,?,?,'active')`).run(versionId,priced.id,JSON.stringify({paid_cents:510000}),now.toISOString(),'2027-11-25T17:00:00.000Z');
sqlite.exec("INSERT INTO stay_pass_pets VALUES('pass',1,0,'2026-11-26'); INSERT INTO stay_pass_pets VALUES('pass',3,0,'2026-11-26');");
sqlite.prepare(`INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,issued_units,origin_value_cents,expires_at,created_at) VALUES('lot','pass','purchase',60,510000,?,?)`).run('2027-11-25T17:00:00.000Z',now.toISOString());
const purchase={passId:'pass',expectedRevision:0,key:key(),kind:'purchase',reason:'Synthetic paid purchase',lines:[{lotId:'lot',units:60}]};
assert.equal((await applyCreditOperation(db,purchase,actor,now)).status,'conflict');assert.equal((await balances(db,'pass')).remaining_units,0);
sqlite.prepare("INSERT INTO stay_pass_payment_links VALUES('payment','pass',1,'sale',510000,NULL,?)").run(now.toISOString());
assert.equal((await applyCreditOperation(db,purchase,actor,now)).status,'saved');assert.equal((await applyCreditOperation(db,purchase,actor,now)).replayed,true);
await assert.rejects(()=>applyCreditOperation(db,{...purchase,reason:'Changed'},actor,now),/idempotency/);
assert.throws(()=>sqlite.exec('UPDATE transactions SET amount=1 WHERE id=1'),/managed/);assert.throws(()=>sqlite.exec('DELETE FROM transactions WHERE id=1'),/managed/);
assert.throws(()=>sqlite.exec("UPDATE stay_pass_credit_lots SET remaining_units=59 WHERE id='lot'"),/ledger_required/);
const hold={passId:'pass',expectedRevision:1,key:key(),kind:'reservation_hold',reason:'Reserve 3 days',checkoutAt:'2026-12-05T12:00:00+07:00',lines:[{lotId:'lot',units:12,bookingId:1,dogId:1}]};
assert.equal((await applyCreditOperation(db,hold,actor,now)).status,'saved');let balance=await balances(db,'pass');assert.equal(balance.remaining_units,60);assert.equal(balance.reserved_units,12);assert.equal(balance.available_units,48);
assert.equal((await applyCreditOperation(db,{...hold,key:key(),expectedRevision:2,lines:[{...hold.lines[0],units:49}]},actor,now)).status,'conflict');
await assert.rejects(()=>applyCreditOperation(db,{...hold,key:key(),expectedRevision:2,lines:[{...hold.lines[0],dogId:3}]},actor,now),/ineligible_pet/);
let consumption=await applyCreditOperation(db,{...hold,key:key(),expectedRevision:2,kind:'stay_consumption',reason:'Check in',lines:[{...hold.lines[0],stayId:1}]},actor,now);assert.equal(consumption.status,'saved');balance=await balances(db,'pass');assert.equal(balance.remaining_units,48);assert.equal(balance.reserved_units,0);
const consumed=sqlite.prepare("SELECT id FROM stay_pass_credit_transactions WHERE kind='stay_consumption'").get();
const reversal={passId:'pass',expectedRevision:3,key:key(),kind:'reversal',reason:'Undo synthetic check in',lines:[{lotId:'lot',reversalOf:consumed.id}]};assert.equal((await applyCreditOperation(db,reversal,actor,now)).status,'saved');
assert.equal((await balances(db,'pass')).reserved_units,12);assert.equal((await applyCreditOperation(db,{...reversal,expectedRevision:4,key:key()},actor,now)).status,'conflict');
assert.equal((await balances(db,'pass')).remaining_units,60);assert.equal(sqlite.prepare('SELECT revision FROM stay_passes').get().revision,4); // failed reversal rolled back all writes
assert.throws(()=>sqlite.exec('DELETE FROM stay_pass_credit_transactions'),/immutable/);
const release={...hold,key:key(),expectedRevision:4,kind:'reservation_release',reason:'Release reservation'};assert.equal((await applyCreditOperation(db,release,actor,now)).status,'saved');
const beforeOps=sqlite.prepare('SELECT count(*) n FROM stay_pass_operations').get().n;
sqlite.exec("CREATE TRIGGER test_fail_audit BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='reservation_hold' BEGIN SELECT RAISE(ABORT,'simulated_audit_failure'); END;");
await assert.rejects(()=>applyCreditOperation(db,{...hold,key:key(),expectedRevision:5},actor,now),/simulated_audit_failure/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_operations').get().n,beforeOps);assert.equal((await balances(db,'pass')).reserved_units,0);assert.equal(sqlite.prepare('SELECT revision FROM stay_passes').get().revision,5);
sqlite.exec('DROP TRIGGER test_fail_audit');
const race={...hold,key:key(),expectedRevision:5,lines:[{...hold.lines[0],units:60}]};
const raced=await Promise.all([applyCreditOperation(db,race,actor,now),applyCreditOperation(db,{...race,key:key()},actor,now)]);assert.deepEqual(raced.map(x=>x.status).sort(),['conflict','saved']);assert.equal((await balances(db,'pass')).available_units,0);
assert.equal(sqlite.prepare('SELECT amount FROM transactions WHERE id=1').get().amount,5100);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,1);
console.log('Stay Pass foundation passed: repeatable additive migration; exact cents/quarter-days; approved Thai calendar rules; unresolved gates; automatic/manual/scheduled/reverted prices; immutable snapshots; admin CAS/idempotency; cash-linked purchase; holds/consumption/reversal; ledger-only balances; concurrent stale revision; rollback and legacy cash isolation.');

const env={DB:db,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development'};
assert.equal(previewEnabled({...env,STAY_PASS_ENVIRONMENT:'production'}),false);assert.equal(previewEnabled({...env,STAY_PASS_ENVIRONMENT:undefined}),false);
const route=(path,method='GET',body,who={...actor,is_admin:1},overrides={})=>stayPassRoute(new Request('https://staff.example.test'+path,{method,...(body?{headers:{Origin:'https://staff.example.test','Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),{...env,...overrides},who);
assert.equal((await route('/api/stay-pass/catalog','GET',undefined,{...actor,is_admin:0})).status,403);
assert.equal((await route('/api/stay-pass/catalog','GET',undefined,{...actor,is_admin:1},{STAY_PASS_ENVIRONMENT:'production'})).status,404);
assert.equal((await route('/api/stay-pass/sales','POST',{})).status,404);
assert.equal(bookingWritesEnabled({...env,STAY_PASS_BOOKING_WRITES:'1',STAY_PASS_ENVIRONMENT:'production'}),false);assert.equal((await route('/api/stay-pass/booking-convert','POST',{})).status,404);assert.equal((await route('/api/stay-pass/booking-convert','POST',{}, {...actor,is_admin:1},{STAY_PASS_BOOKING_WRITES:'1',STAY_PASS_ENVIRONMENT:'production'})).status,404);assert.equal((await route('/api/stay-pass/booking-convert','POST',{}, {...actor,is_admin:0},{STAY_PASS_BOOKING_WRITES:'1'})).status,403);
assert.equal((await route('/api/stay-pass/credits','POST',{})).status,404);
assert.equal((await stayPassRoute(new Request('https://staff.example.test/api/stay-pass/plans',{method:'POST',headers:{Origin:'https://evil.example.test'}}),env,{...actor,is_admin:1})).status,403);
assert.equal((await route('/api/stay-pass/catalog')).status,200);assert.equal((await route('/api/stay-pass/preview','POST',{config:initialPlan()})).status,200);
const page=await route('/stay-pass');const markup=await page.text();assert.equal(page.status,200);assert.ok(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));assert.ok(markup.includes('ยังไม่เปิดขาย'));
const snapshot=await cloudSnapshot(db);assert.ok(snapshot.rows.stay_pass_credit_transactions.length>0);assert.equal(snapshot.rows.stay_pass_price_versions.length,3);
const backupDir=await mkdtemp(join(tmpdir(),'stay-pass-restore-'));
try{
 const archive=join(backupDir,'fixture.zip');await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(snapshot),'objects.json':'[]'}).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(backupDir,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); assert db.execute('SELECT COUNT(*) FROM stay_pass_price_versions').fetchone()[0]==3; assert db.execute('PRAGMA foreign_key_check').fetchall()==[]",join(backupDir,'restored','cloud-recovery.sqlite3')]);
}finally{await rm(backupDir,{recursive:true,force:true});}
console.log('Stay Pass API/backup passed: production flag lock, admin/origin checks, no sale-write/credit-write API, private page CSP, round-trip portable restore with ledger and protective triggers.');

// Draft terms are immutable, audited and never self-approved by a client.
const draft={version:'1.9.1',content_th:'ร่างทดสอบเท่านั้น',content_en:'Synthetic draft only',reason:'Test immutable draft',key:key()};
const savedDraft=await savePolicyDraft(db,draft,actor,now);assert.equal(savedDraft.status,'saved');
assert.equal((await savePolicyDraft(db,draft,actor,now)).replayed,true);
assert.equal((await savePolicyDraft(db,{...draft,key:key()},actor,now)).status,'conflict');
await assert.rejects(()=>savePolicyDraft(db,{...draft,status:'approved',key:key()},actor,now),/invalid_policy/);
await assert.rejects(()=>savePolicyDraft(db,{...draft,content_en:'Changed'},actor,now),/idempotency_conflict/);
assert.equal((await savePolicyDraft(db,{...draft,version:'1.9.2',key:key()},staff,now)).status,'conflict');
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_policy_versions SET content_th=? WHERE id=?').run('changed',savedDraft.id));
assert.equal(sqlite.prepare('SELECT status FROM stay_pass_policy_versions WHERE id=?').get(savedDraft.id).status,'draft');
console.log('Stay Pass policy drafts passed: immutable content, audit, idempotency, admin-only, no self-approval.');

// Sales preparation is read-only and always gated; prices come from immutable effective versions.
const saleInput={planId,customerId:1,size:'small',dogIds:[1]};
const beforeSales=JSON.stringify(sqlite.prepare('SELECT * FROM transactions').all());
const beforePasses=sqlite.prepare('SELECT count(*) n FROM stay_passes').get().n;
const sale=await quoteSale(db,saleInput,actor,now);assert.equal(sale.snapshot.paid_cents,510000);assert.equal(sale.snapshot.credit_units,60);assert.equal(sale.snapshot.last_valid_day,'2027-11-25');assert.equal(sale.paid_sales_recorded,1);assert.equal(sale.can_sell,false);assert.equal(sale.can_receive_payment,false);assert.ok(sale.blockers.includes('policy_not_approved'));
assert.equal((await quoteSale(db,saleInput,actor,now)).quote_hash,sale.quote_hash);
assert.equal((await quoteSale(db,saleInput,actor,new Date('2026-12-02T05:00:00Z'))).snapshot.paid_cents,500000);
assert.equal((await quoteSale(db,saleInput,actor,new Date('2026-12-11T05:00:00Z'))).snapshot.paid_cents,510000);
assert.equal((await quoteSale(db,saleInput,actor,new Date('2028-02-29T05:00:00Z'))).snapshot.expires_at,null);
assert.ok((await quoteSale(db,saleInput,actor,new Date('2028-02-29T05:00:00Z'))).blockers.includes('leap_day_approval_required'));
for(const bad of [{...saleInput,dogIds:[1,1]},{...saleInput,dogIds:[2]},{...saleInput,dogIds:[1,3]},{...saleInput,dogIds:[]},{...saleInput,customerId:2}])await assert.rejects(()=>quoteSale(db,bad,actor,now));
await assert.rejects(()=>quoteSale(db,saleInput,staff,now),/forbidden/);await assert.rejects(()=>quoteSale(db,saleInput,off,now),/forbidden/);
assert.equal((await salesCustomers(db,actor)).length,2);assert.equal((await salesCustomers(db,staff)).length,0);assert.equal((await salesPets(db,1,actor)).length,2);
sqlite.prepare('UPDATE customers SET archived=1 WHERE id=1').run();await assert.rejects(()=>quoteSale(db,saleInput,actor,now),/invalid_customer/);assert.equal((await salesPets(db,1,actor)).length,0);sqlite.prepare('UPDATE customers SET archived=0 WHERE id=1').run();
assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_passes').get().n,beforePasses);assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM transactions').all()),beforeSales);
assert.equal((await route('/api/stay-pass/sales/quote','POST',saleInput)).status,200);assert.equal((await route('/api/stay-pass/sales/commit','POST',saleInput)).status,404);
console.log('Stay Pass sales preparation passed: effective/versioned price, immutable quote, eligibility/admin/privacy, expiry gate, and no payment/pass/credit side effects.');

// Only synthetic fixtures are approved here; no policy-approval API exists.
sqlite.prepare("UPDATE stay_pass_policy_versions SET status='approved',approved_at=?,approved_by=1 WHERE id=?").run(now.toISOString(),savedDraft.id);
const saleConfig={...initialPlan(),policy_version:'1.9.1',sales_limit:2};
const salePlan=await savePlan(db,{...create,code:'SYNTH-SALES',config:saleConfig,key:key()},actor,now);
await savePrice(db,{planId:salePlan.planId,planVersionId:salePlan.id,expectedRevision:1,effectiveAt:null,key:key(),reason:'Synthetic sale price'},actor,now);
const saleBase={planId:salePlan.planId,customerId:1,size:'small',dogIds:[1]};
const quoted=await quoteSale(db,saleBase,actor,now);
assert.equal((await quoteSale(db,saleBase,actor,new Date(now.valueOf()+60000))).quote_hash,quoted.quote_hash);
const pay={...saleBase,key:key(),quoteHash:quoted.quote_hash,paidCents:510000,paymentMethod:'transfer',reference:'SYNTHETIC-REFERENCE',reason:'Synthetic sale; not a real payment',acceptance:{confirmed:true,channel:'document',evidence:'Synthetic acceptance only',acceptedAt:now.toISOString()}};
await assert.rejects(()=>recordPaidSale(db,{...pay,paidCents:500000},actor,now),/full_payment_required/);
await assert.rejects(()=>recordPaidSale(db,{...pay,quoteHash:'a'.repeat(64)},actor,now),/price_confirmation_required/);
await assert.rejects(()=>recordPaidSale(db,{...pay,acceptance:{...pay.acceptance,confirmed:false}},actor,now),/invalid_sale/);
await assert.rejects(()=>recordPaidSale(db,pay,staff,now),/forbidden/);
const paid=await recordPaidSale(db,pay,actor,new Date(now.valueOf()+60000));assert.equal(paid.status,'saved');assert.match(paid.passNumber,/^LP-SP-[A-HJ-NP-Z2-9]{6}$/);
assert.equal((await recordPaidSale(db,pay,actor,new Date(now.valueOf()+120000))).replayed,true);
await assert.rejects(()=>recordPaidSale(db,{...pay,reference:'different'},actor,now),/idempotency_conflict/);
assert.equal((await balances(db,paid.passId)).available_units,60);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM transactions WHERE payment_type='stay_pass'").get().n,1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM stay_pass_policy_acceptances WHERE pass_id=?').get(paid.passId).n,1);
assert.throws(()=>sqlite.prepare('DELETE FROM stay_pass_policy_acceptances WHERE pass_id=?').run(paid.passId),/immutable/);
assert.throws(()=>sqlite.prepare('UPDATE transactions SET amount=1 WHERE payment_type=?').run('stay_pass'),/stay_pass_managed_payment/);
// Late failure after the cash insert must remove every row, not leave an unpaid active pass.
const rowCounts=()=>Object.fromEntries(['stay_passes','stay_pass_sales','stay_pass_credit_lots','stay_pass_credit_transactions','stay_pass_policy_acceptances','transactions'].map(t=>[t,sqlite.prepare('SELECT COUNT(*) n FROM '+t).get().n]));
const beforeFail=rowCounts();sqlite.exec("CREATE TRIGGER test_sale_audit_failure BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='paid_sale' BEGIN SELECT RAISE(ABORT,'sale_audit_failure'); END;");
await assert.rejects(()=>recordPaidSale(db,{...pay,key:key()},actor,now),/sale_audit_failure/);assert.deepEqual(rowCounts(),beforeFail);sqlite.exec('DROP TRIGGER test_sale_audit_failure');
// Competing sales for the final slot, across sizes, cannot exceed the shared limit.
const largeBase={...saleBase,size:'large',dogIds:[3]};const largeQuote=await quoteSale(db,largeBase,actor,now);
const competition=await Promise.all([recordPaidSale(db,{...pay,key:key()},actor,now),recordPaidSale(db,{...pay,...largeBase,quoteHash:largeQuote.quote_hash,paidCents:765000,key:key()},actor,now)]);
assert.deepEqual(competition.map(r=>r.status).sort(),['conflict','saved']);
assert.equal((await quoteSale(db,saleBase,actor,now)).paid_sales_recorded,2);
sqlite.prepare("UPDATE stay_passes SET status='refunded' WHERE id=?").run(paid.passId);
assert.equal((await quoteSale(db,saleBase,actor,now)).paid_sales_recorded,2);
assert.equal((await recordPaidSale(db,{...pay,key:key()},actor,now)).status,'conflict');
// A newly effective price must be confirmed again; existing sold snapshot remains 5100.
const updatedSale=await savePlan(db,{...create,planId:salePlan.planId,code:'SYNTH-SALES',expectedRevision:2,config:{...saleConfig,sales_limit:3,pricing_mode:'manual',manual_prices_cents:{small:500000,medium:600000,large:700000}},key:key()},actor,now);
await savePrice(db,{planId:salePlan.planId,planVersionId:updatedSale.id,expectedRevision:3,effectiveAt:'2026-11-26T13:00:00+07:00',key:key(),reason:'New price'},actor,now);
await assert.rejects(()=>recordPaidSale(db,{...pay,key:key()},actor,new Date('2026-11-26T07:00:00Z')),/price_confirmation_required/);
assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot FROM stay_passes WHERE id=?').get(paid.passId).snapshot).paid_cents,510000);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Stay Pass atomic sales passed: full payment + policy evidence + cash + pass + ledger in one batch; replay once; failed audit rolls back; shared cumulative cap; refunded slots stay consumed; changed prices require reconfirmation; sold snapshot stays fixed.');

const paidBackup=await mkdtemp(join(tmpdir(),'stay-pass-paid-restore-'));
try{
 const data=await cloudSnapshot(db);assert.equal(data.rows.stay_pass_sales.length,2);assert.equal(data.rows.stay_pass_policy_acceptances.length,2);
 const archive=join(paidBackup,'paid-fixture.zip');await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(data),'objects.json':'[]'}).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(paidBackup,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); assert db.execute('SELECT COUNT(*) FROM stay_pass_sales').fetchone()[0]==2; assert db.execute('SELECT COUNT(*) FROM stay_pass_policy_acceptances').fetchone()[0]==2; assert db.execute(\"SELECT COUNT(*) FROM transactions WHERE payment_type='stay_pass'\").fetchone()[0]==2; assert db.execute('PRAGMA foreign_key_check').fetchall()==[]",join(paidBackup,'restored','cloud-recovery.sqlite3')]);
}finally{await rm(paidBackup,{recursive:true,force:true});}
console.log('Paid Stay Pass backup restore passed: sales, acceptance evidence, legacy cash rows, ledger and foreign keys preserved.');

// Booking preview preserves manual quantities and existing financial data.
assert.equal(bookingCreditUnits('overnight',3,2),24);assert.equal(bookingCreditUnits('daycare',1,2),4);assert.throws(()=>bookingCreditUnits('monthly',1,1));assert.throws(()=>bookingCreditUnits('overnight',1.4,1));
sqlite.exec("CREATE TABLE IF NOT EXISTS system_settings(key PRIMARY KEY,value);INSERT INTO system_settings VALUES('capacity','6');CREATE TABLE IF NOT EXISTS shop_holidays(id INTEGER PRIMARY KEY,starts_on,ends_on);CREATE TABLE IF NOT EXISTS boarding_charges(appointment_id INTEGER UNIQUE,stay_id INTEGER UNIQUE,details);");
sqlite.prepare("INSERT INTO appointments(id,customer_id,stay_id,checkin,checkout,charged_nights,service_type,cloud_revision) VALUES(2,1,NULL,'2026-12-01','2026-12-05',3,'overnight','synthetic-revision')").run();
sqlite.prepare('INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(2,1)').run();
sqlite.prepare("INSERT INTO stays(id,customer_id,status,cancelled_at,checkin,checkout) VALUES(2,1,'cancelled','2026-01-01','2026-12-01','2026-12-05')").run();
const bookingPass=competition.find(r=>r.status==='saved').passId;
// Both contenders were valid same-family packages; select the matching registered dog.
const matchDog=sqlite.prepare('SELECT dog_id FROM stay_pass_pets WHERE pass_id=? LIMIT 1').get(bookingPass).dog_id;sqlite.prepare('UPDATE appointment_dogs SET dog_id=? WHERE appointment_id=2').run(matchDog);
const timing={version:1,checkin_time:'10:00',checkout_time:'12:00'};
sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(2,?)').run(JSON.stringify(timing));
let bookedQuote=await quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now);
assert.equal(bookedQuote.credit_units,16);assert.equal(bookedQuote.declared_quantity,3);assert.equal(bookedQuote.can_reserve,false);assert.equal(bookedQuote.late_checkout.percent,100);assert.equal(bookedQuote.late_checkout.cash_only,false);
// Date span is four days, but the manually agreed quantity is three and is preserved.
sqlite.prepare("UPDATE appointments SET checkout='2026-12-04' WHERE id=2").run();bookedQuote=await quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now);assert.equal(bookedQuote.late_checkout.percent,0);assert.equal(bookedQuote.credit_units,12);
sqlite.prepare("INSERT INTO shop_holidays VALUES(1,'2026-12-02','2026-12-02')").run();assert.ok((await quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now)).warning_codes.includes('holiday'));sqlite.exec('DELETE FROM shop_holidays');
sqlite.prepare("UPDATE appointments SET service_type='daycare',charged_nights=1,checkout='2026-12-01' WHERE id=2").run();bookedQuote=await quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now);assert.equal(bookedQuote.credit_units,2);assert.ok(!bookedQuote.blockers.includes('daycare_duration_approval_required'));assert.equal(bookedQuote.daycare.units_per_dog,2);
sqlite.prepare("UPDATE appointments SET service_type='monthly' WHERE id=2").run();await assert.rejects(()=>quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now),/invalid_pass_booking/);
sqlite.prepare("UPDATE appointments SET service_type='overnight',charged_nights=100,checkout='2028-01-01' WHERE id=2").run();bookedQuote=await quotePassBooking(db,{passId:bookingPass,bookingId:2},actor,now);assert.ok(bookedQuote.blockers.includes('stay_crosses_expiry'));assert.ok(bookedQuote.blockers.includes('mixed_payment_integration_required'));
await assert.rejects(()=>quotePassBooking(db,{passId:bookingPass,bookingId:2},staff,now),/forbidden/);
assert.equal((await route('/api/stay-pass/reserve','POST',{})).status,404);
console.log('Stay Pass booking preparation passed: registered family/size, manual quantities, overnight/daycare units, shared capacity/holiday warnings, expiry/credit checks and late-credit/cash-shortfall split. No booking, cash or credit writes.');

// Family sharing records each dog's allocation without duplicating the shared lot debit.
sqlite.prepare("UPDATE stay_passes SET status='active' WHERE id=?").run(paid.passId); // Reset synthetic refund-status fixture only.
sqlite.prepare("UPDATE appointments SET status='cancelled' WHERE id=2").run();
sqlite.prepare("INSERT INTO dogs(id,customer_id,name,size,archived) VALUES(4,1,'Second small dog','small',0)").run();
sqlite.prepare('INSERT INTO stay_pass_pets VALUES(?,4,0,?)').run(paid.passId,now.toISOString());
sqlite.prepare("INSERT INTO appointments(id,customer_id,stay_id,checkin,checkout,charged_nights,service_type,cloud_revision) VALUES(3,1,NULL,'2026-12-05','2026-12-08',3,'overnight','family-revision')").run();
sqlite.exec('INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(3,1),(3,4)');sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(3,?)').run(JSON.stringify({...timing,checkin_time:'00:10',checkout_time:'02:10'}));
const familyQuote=await quotePassBooking(db,{passId:paid.passId,bookingId:3},actor,now);assert.equal(familyQuote.credit_units,24);
const reservation={passId:paid.passId,bookingId:3,quoteHash:familyQuote.quote_hash,key:key(),reason:'Synthetic family booking'};
const heldFamily=await reservePassBooking(db,reservation,actor,now);assert.equal(heldFamily.status,'saved');assert.equal((await reservePassBooking(db,reservation,actor,now)).replayed,true);
assert.equal((await balances(db,paid.passId)).reserved_units,24);assert.equal((await balances(db,paid.passId)).remaining_units,60);assert.equal((await balances(db,paid.passId)).available_units,36);
let attribution=sqlite.prepare('SELECT * FROM stay_pass_booking_allocations WHERE booking_id=3 ORDER BY dog_id').all();assert.deepEqual(attribution.map(a=>a.reserved_units),[12,12]);
const secondQuote=await quotePassBooking(db,{passId:paid.passId,bookingId:3},actor,now);assert.equal((await reservePassBooking(db,{...reservation,key:key(),quoteHash:secondQuote.quote_hash},actor,now)).status,'conflict');
assert.throws(()=>sqlite.prepare('DELETE FROM stay_pass_booking_credit_events WHERE booking_id=3').run(),/immutable/);
// Consume and reverse exactly once with both dog attributions kept in sync.
sqlite.prepare("INSERT INTO stays(id,customer_id,status,cancelled_at) VALUES(3,1,'checked_in',NULL)").run();sqlite.exec('INSERT INTO stay_dogs VALUES(3,1),(3,4)');sqlite.prepare('UPDATE appointments SET stay_id=3 WHERE id=3').run();
const familyConsumed=await applyCreditOperation(db,{passId:paid.passId,kind:'stay_consumption',key:key(),expectedRevision:2,reason:'Synthetic family check-in',lines:[{lotId:attribution[0].lot_id,units:24,bookingId:3,stayId:3,dogIds:[1,4]}]},actor,now);assert.equal(familyConsumed.status,'saved');
attribution=sqlite.prepare('SELECT * FROM stay_pass_booking_allocations WHERE booking_id=3').all();assert.deepEqual(attribution.map(a=>a.reserved_units),[0,0]);assert.deepEqual(attribution.map(a=>a.consumed_units),[12,12]);assert.equal((await balances(db,paid.passId)).remaining_units,36);
const familyLedger=sqlite.prepare("SELECT id FROM stay_pass_credit_transactions WHERE operation_id=?").get(familyConsumed.operationId);
assert.equal((await applyCreditOperation(db,{passId:paid.passId,kind:'reversal',key:key(),expectedRevision:3,reason:'Synthetic reverse check-in',lines:[{lotId:attribution[0].lot_id,reversalOf:familyLedger.id}]},actor,now)).status,'saved');
attribution=sqlite.prepare('SELECT * FROM stay_pass_booking_allocations WHERE booking_id=3').all();assert.deepEqual(attribution.map(a=>a.reserved_units),[12,12]);assert.deepEqual(attribution.map(a=>a.consumed_units),[0,0]);assert.equal((await balances(db,paid.passId)).remaining_units,60);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Family allocation passed: one shared credit hold, exact per-dog attribution, no duplicate booking holds, aggregate consumption and exact reversal; available and total balance stay separate.');

assert.throws(()=>sqlite.prepare('DELETE FROM stay_pass_operations WHERE id=?').run(heldFamily.operationId),/immutable/);
assert.throws(()=>sqlite.prepare("UPDATE stay_pass_operations SET result='{}' WHERE id=?").run(heldFamily.operationId),/immutable/);
// A different booking must never consume another booking's reserved quota.
sqlite.prepare("INSERT INTO appointments(id,customer_id,stay_id,status) VALUES(99,1,3,'pending')").run();sqlite.exec('INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(99,1),(99,4)');
const beforeTheft=await balances(db,paid.passId);
await assert.rejects(()=>applyCreditOperation(db,{passId:paid.passId,kind:'stay_consumption',key:key(),expectedRevision:4,reason:'Synthetic wrong-booking test',lines:[{lotId:attribution[0].lot_id,units:24,bookingId:99,stayId:3,dogIds:[1,4]}]},actor,now),/allocation_balance/);
assert.deepEqual(await balances(db,paid.passId),beforeTheft);
// Concurrent normal-booking changes invalidate a quoted hold inside the atomic write.
sqlite.prepare("INSERT INTO appointments(id,customer_id,stay_id,checkin,checkout,charged_nights,service_type,cloud_revision) VALUES(4,1,NULL,'2026-12-15','2026-12-16',1,'overnight','race-revision')").run();
sqlite.exec('INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(4,1),(4,4)');sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(4,?)').run(JSON.stringify(timing));
const raceQuote=await quotePassBooking(db,{passId:paid.passId,bookingId:4},actor,now);
let injected=false;const capacityRaceDb={prepare(sql){const stmt=db.prepare(sql);stmt.testSql=sql;return stmt;},batch(stmts){if(!injected&&stmts[0].testSql?.includes('INSERT INTO stay_pass_operations')){injected=true;sqlite.exec("INSERT INTO appointments(id,customer_id,stay_id,status,checkin,checkout,charged_nights,service_type) VALUES(5,1,NULL,'pending','2026-12-15','2026-12-16',1,'overnight');INSERT INTO appointment_dogs(appointment_id,dog_id) VALUES(5,1);");}return db.batch(stmts);}};
const beforeCapacityRace=await balances(db,paid.passId);
assert.equal((await reservePassBooking(capacityRaceDb,{passId:paid.passId,bookingId:4,quoteHash:raceQuote.quote_hash,key:key(),reason:'Synthetic concurrent capacity change'},actor,now)).status,'conflict');assert.ok(injected);assert.deepEqual(await balances(db,paid.passId),beforeCapacityRace);
sqlite.exec('DELETE FROM appointment_dogs WHERE appointment_id=5;DELETE FROM appointments WHERE id=5;');
let revised=false;const revisionRaceDb={prepare(sql){const stmt=db.prepare(sql);stmt.testSql=sql;return stmt;},batch(stmts){if(!revised&&stmts[0].testSql?.includes('INSERT INTO stay_pass_operations')){revised=true;sqlite.exec("UPDATE appointments SET cloud_revision='new-race-revision',charged_nights=2 WHERE id=4;");}return db.batch(stmts);}};
assert.equal((await reservePassBooking(revisionRaceDb,{passId:paid.passId,bookingId:4,quoteHash:raceQuote.quote_hash,key:key(),reason:'Synthetic concurrent quantity change'},actor,now)).status,'conflict');assert.ok(revised);assert.deepEqual(await balances(db,paid.passId),beforeCapacityRace);
console.log('Booking race guards passed: concurrent capacity/overlap changes and edited manual quantity cannot commit a stale credit hold.');

assert.throws(()=>sqlite.prepare("INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,issued_units,origin_value_cents,expires_at,created_at) VALUES('fractional-lot',?,'purchase',1.5,100,?,?)").run(paid.passId,'2027-11-26T17:00:00.000Z',now.toISOString()),/integer_required/);
assert.throws(()=>sqlite.prepare("INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,issued_units,origin_value_cents,expires_at,created_at) VALUES('fractional-money',?,'purchase',4,100.5,?,?)").run(paid.passId,'2027-11-26T17:00:00.000Z',now.toISOString()),/integer_required/);
console.log('Database integer guards passed: fractional credit units and fractional satang are rejected.');

// Mixed payment reserves only covered credits and freezes the cash quote in the same atomic batch.
sqlite.prepare("INSERT INTO appointments(id,customer_id,stay_id,checkin,checkout,charged_nights,service_type,cloud_revision) VALUES(6,1,NULL,'2027-01-10','2027-01-15',5,'overnight','mixed-revision')").run();
sqlite.exec('INSERT INTO appointment_dogs(appointment_id,dog_id,nightly_rate_cents) VALUES(6,1,40000),(6,4,50000)');
sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(6,?)').run(JSON.stringify({version:1,checkin_time:'10:00',checkout_time:'13:00'}));
const mixedBase={passId:paid.passId,bookingId:6};
const notChosen=await quotePassBooking(db,mixedBase,actor,now);assert.ok(notChosen.blockers.includes('per_pet_credit_allocation_required'));
await assert.rejects(()=>reservePassBooking(db,{...mixedBase,key:key(),reason:'Missing allocation',quoteHash:notChosen.quote_hash},actor,now),/per_pet_credit_allocation_required/);
const mixedInput={...mixedBase,allocations:[{dog_id:1,credit_units:21},{dog_id:4,credit_units:15}]};
const mixedQuote=await quotePassBooking(db,mixedInput,actor,now);assert.equal(mixedQuote.settlement.covered_units,36);assert.equal(mixedQuote.settlement.cash_cents,75000);assert.equal(mixedQuote.settlement.late_units,2);
const cashBefore=sqlite.prepare('SELECT * FROM transactions ORDER BY id').all(),creditBefore=await balances(db,paid.passId);
sqlite.exec("INSERT INTO transactions(id,kind,amount,customer_id,deposit_appointment_id,payment_type) VALUES(9001,'income',100,1,6,'deposit')");
const withDeposit=await quotePassBooking(db,mixedInput,actor,now);assert.equal(withDeposit.payment_preview.existing_deposit_cents,10000);assert.equal(withDeposit.payment_preview.cash_due_cents,65000);
sqlite.exec('UPDATE transactions SET amount=1000 WHERE id=9001');const excessDeposit=await quotePassBooking(db,mixedInput,actor,now);assert.equal(excessDeposit.payment_preview.cash_due_cents,0);assert.equal(excessDeposit.payment_preview.deposit_excess_cents,25000);assert.ok(excessDeposit.blockers.includes('deposit_excess_review_required'));sqlite.exec('DELETE FROM transactions WHERE id=9001');
const mixedRequest={...mixedInput,key:key(),quoteHash:mixedQuote.quote_hash,reason:'Synthetic mixed boarding'};
let depositInserted=false;
const depositRaceDb={prepare(sql){const stmt=db.prepare(sql);stmt.testSql=sql;return stmt;},batch(stmts){if(!depositInserted&&stmts[0].testSql?.includes('INSERT INTO stay_pass_operations')){depositInserted=true;sqlite.exec("INSERT INTO transactions(id,kind,amount,customer_id,deposit_appointment_id,payment_type) VALUES(9000,'income',100,1,6,'deposit')");}return db.batch(stmts);}};
assert.equal((await reservePassBooking(depositRaceDb,mixedRequest,actor,now)).status,'conflict');assert.ok(depositInserted);assert.deepEqual(await balances(db,paid.passId),creditBefore);sqlite.exec('DELETE FROM transactions WHERE id=9000');
sqlite.exec("CREATE TRIGGER synthetic_settlement_failure BEFORE INSERT ON stay_pass_booking_settlements BEGIN SELECT RAISE(ABORT,'settlement_simulated_failure'); END;");
await assert.rejects(()=>reservePassBooking(db,mixedRequest,actor,now),/settlement_simulated_failure/);assert.deepEqual(await balances(db,paid.passId),creditBefore);sqlite.exec('DROP TRIGGER synthetic_settlement_failure');
const mixedHold=await reservePassBooking(db,mixedRequest,actor,now);assert.equal(mixedHold.status,'saved');assert.equal((await reservePassBooking(db,mixedRequest,actor,now)).replayed,true);
const frozen=sqlite.prepare('SELECT * FROM stay_pass_booking_settlements WHERE id=?').get(mixedHold.operationId);assert.equal(frozen.cash_cents,75000);assert.equal(frozen.covered_units,36);
assert.deepEqual(sqlite.prepare('SELECT reserved_units FROM stay_pass_booking_allocations WHERE booking_id=6 ORDER BY dog_id').all().map(r=>r.reserved_units),[21,15]);
assert.deepEqual(sqlite.prepare('SELECT * FROM transactions ORDER BY id').all(),cashBefore);assert.equal((await balances(db,paid.passId)).available_units,0);
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_booking_settlements SET cash_cents=0 WHERE id=?').run(mixedHold.operationId),/immutable/);
assert.throws(()=>sqlite.prepare('DELETE FROM stay_pass_booking_settlements WHERE id=?').run(mixedHold.operationId),/immutable/);
sqlite.exec("INSERT INTO stays(id,customer_id,status,cancelled_at) VALUES(6,1,'checked_in',NULL);INSERT INTO stay_dogs VALUES(6,1),(6,4);UPDATE appointments SET stay_id=6 WHERE id=6;");
const mixedLot=sqlite.prepare('SELECT lot_id FROM stay_pass_booking_allocations WHERE booking_id=6 LIMIT 1').get().lot_id;
const mixedConsumed=await applyCreditOperation(db,{passId:paid.passId,kind:'stay_consumption',key:key(),expectedRevision:mixedHold.revision,reason:'Synthetic uneven mixed check-in',lines:[{lotId:mixedLot,units:36,bookingId:6,stayId:6,dogIds:[1,4],dogUnits:[{dog_id:1,units:21},{dog_id:4,units:15}]}]},actor,now);assert.equal(mixedConsumed.status,'saved');
assert.deepEqual(sqlite.prepare('SELECT consumed_units FROM stay_pass_booking_allocations WHERE booking_id=6 ORDER BY dog_id').all().map(r=>r.consumed_units),[21,15]);
assert.deepEqual(sqlite.prepare('SELECT * FROM transactions ORDER BY id').all(),cashBefore);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Mixed booking passed: per-dog unequal allocation, exact late credits, frozen cash quote, rollback on settlement failure, retry once, immutable snapshot and consumption without new cash receipt.');

const bookingsList=await passBookingOptions(db,{search:'Synthetic'},actor,now);assert.ok(bookingsList.bookings.length>0);
assert.ok((await passBookingOptions(db,{search:'% OR 1=1'},actor,now)).bookings.length===0);
await assert.rejects(()=>passBookingOptions(db,{search:''},staff,now),/forbidden/);
assert.ok((await passOptionsForBooking(db,4,actor,new Date(now.valueOf()+120000))).passes.some(p=>p.id===paid.passId));
await assert.rejects(()=>passOptionsForBooking(db,4,staff,now),/forbidden/);
assert.equal((await route('/api/stay-pass/booking-search?search=Synthetic')).status,200);
assert.equal((await route('/api/stay-pass/booking-options?booking=4')).status,200);
assert.equal((await route('/api/stay-pass/booking-quote','POST',{passId:paid.passId,bookingId:4})).status,200);
assert.equal((await route('/api/stay-pass/reserve','POST',{})).status,404);
console.log('Booking preview API passed: scoped search/eligibility, literal search terms, admin guard, read-only allocation quote, no reservation-write endpoint.');
const mixedBackup=await mkdtemp(join(tmpdir(),'stay-pass-mixed-restore-'));
try{
 const data=await cloudSnapshot(db);assert.ok(data.rows.stay_pass_booking_settlements.some(s=>s.id===mixedHold.operationId));
 const archive=join(mixedBackup,'fixture.zip');await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(data),'objects.json':'[]'}).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(mixedBackup,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); assert db.execute('SELECT cash_cents,covered_units FROM stay_pass_booking_settlements WHERE booking_id=6').fetchone()==(75000,36); assert db.execute('PRAGMA foreign_key_check').fetchall()==[]; assert db.execute(\"SELECT count(*) FROM sqlite_master WHERE name='stay_pass_settlement_guard'\").fetchone()[0]==1",join(mixedBackup,'restored','cloud-recovery.sqlite3')]);
}finally{await rm(mixedBackup,{recursive:true,force:true});}
console.log('Mixed-settlement backup restore passed: cash snapshot, dog allocations, foreign keys and protective triggers preserved.');

export {sqlite,db,actor,staff,now,key,bookingPass,matchDog};
