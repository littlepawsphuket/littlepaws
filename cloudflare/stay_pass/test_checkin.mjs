import {initialPlan} from './pricing.mjs';
import {savePlan,savePrice} from './repository.mjs';
import {quoteSale,recordPaidSale} from './sales.mjs';
import assert from 'node:assert/strict';
import {sqlite,db,actor,staff,key,bookingPass,matchDog} from './test_foundation.mjs';
import {quotePassBooking,convertPassBooking} from './booking.mjs';
import {quotePassCheckin,checkInPassBooking} from './checkin.mjs';
import {checkInTerms} from '../check_in.mjs';
import {balances} from './credits.mjs';
const clock=new Date('2027-03-01T07:00:00Z');
// Extend the synthetic legacy fixture with the actual check-in fields.
for(const [table,fields] of Object.entries({appointments:["note TEXT DEFAULT ''","rounding_cents INTEGER DEFAULT 0"],stays:["agreed_total REAL DEFAULT 0","charged_nights INTEGER DEFAULT 1","note TEXT DEFAULT ''","discount_cents INTEGER DEFAULT 0","rounding_cents INTEGER DEFAULT 0","intake TEXT DEFAULT '{}'","payment_tracking INTEGER DEFAULT 0","create_key TEXT","stay_number TEXT"],stay_dogs:['nightly_rate_cents INTEGER']}))for(const field of fields)sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${field}`);
sqlite.exec('CREATE UNIQUE INDEX synthetic_stay_number ON stays(stay_number); CREATE UNIQUE INDEX synthetic_stay_create ON stays(create_key); CREATE TABLE stay_consents(id INTEGER PRIMARY KEY,stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en)');
sqlite.prepare("INSERT INTO appointments(id,booking_number,customer_id,checkin,checkout,charged_nights,service_type,agreed_total,cloud_revision) VALUES(7,'OLD007',1,'2027-03-01','2027-03-17',16,'overnight',9000,'old-booking-revision')").run();
sqlite.prepare('INSERT INTO appointment_dogs(appointment_id,dog_id,nightly_rate_cents) VALUES(7,?,50000)').run(matchDog);
sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(7,?)').run(JSON.stringify({version:1,checkin_time:'13:00',checkout_time:'16:00'}));
sqlite.exec("INSERT INTO transactions(id,kind,amount,customer_id,deposit_appointment_id,payment_type,payment_key) VALUES(9100,'income',100,1,7,'deposit','original-deposit')");
const input={passId:bookingPass,bookingId:7,convert:true};let quote=await quotePassBooking(db,input,actor,clock);assert.equal(quote.settlement.cash_cents,62500);assert.equal(quote.payment_preview.cash_due_cents,52500);assert.ok(!quote.blockers.includes('existing_payment_review_required'));
const request={...input,key:key(),reason:'Synthetic conversion of existing booking',quoteHash:quote.quote_hash};
const before=await balances(db,bookingPass),cashBefore=sqlite.prepare('SELECT count(*) n FROM transactions').get().n;
sqlite.exec("CREATE TRIGGER synthetic_conversion_failure BEFORE INSERT ON stay_pass_booking_links BEGIN SELECT RAISE(ABORT,'conversion_simulated_failure'); END");
await assert.rejects(()=>convertPassBooking(db,request,actor,clock),/conversion_simulated_failure/);assert.deepEqual(await balances(db,bookingPass),before);assert.equal(sqlite.prepare('SELECT agreed_total FROM appointments WHERE id=7').get().agreed_total,9000);sqlite.exec('DROP TRIGGER synthetic_conversion_failure');
const converted=await convertPassBooking(db,request,actor,clock);assert.equal(converted.status,'saved');assert.equal((await convertPassBooking(db,request,actor,clock)).replayed,true);
assert.equal(sqlite.prepare('SELECT agreed_total FROM appointments WHERE id=7').get().agreed_total,625);assert.equal(sqlite.prepare('SELECT original_total_cents FROM stay_pass_booking_links WHERE booking_id=7').get().original_total_cents,900000);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,cashBefore);
assert.throws(()=>sqlite.exec('UPDATE appointments SET agreed_total=100 WHERE id=7'),/stay_pass_booking_locked/);assert.throws(()=>sqlite.exec('UPDATE appointment_dogs SET nightly_rate_cents=1 WHERE appointment_id=7'),/stay_pass_booking_locked/);
const ready=await quotePassCheckin(db,7,actor,clock);assert.equal(ready.balance_cents,52500);assert.equal(ready.credit_units,60);
const form={accepted:true,language:'th',version:checkInTerms('th').version,signature:[[[10,10],[70,70]]],revision:ready.booking_revision,
 arrivalDay:'2027-03-01',arrivalTime:'13:00',pickupDay:'2027-03-17',pickupTime:'16:00',quantity100:1600,pricingVersion:1,
 expectedBalance:52500,amountCents:20000,paymentDate:'2027-03-01',receivedTime:'14:01',key:key(),intake:{},passQuoteHash:ready.quote_hash};
await assert.rejects(()=>checkInPassBooking(db,7,form,staff,clock),/forbidden/);
assert.equal((await checkInPassBooking(db,7,{...form,arrivalTime:'14:00'},actor,clock)).status,'pass_timing_review_required');
assert.equal((await checkInPassBooking(db,7,{...form,amountCents:52600},actor,clock)).status,'invalid');
sqlite.exec("CREATE TRIGGER synthetic_checkin_failure BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='booking_checkin' BEGIN SELECT RAISE(ABORT,'checkin_simulated_failure'); END");
const held=await balances(db,bookingPass);await assert.rejects(()=>checkInPassBooking(db,7,form,actor,clock),/checkin_simulated_failure/);assert.deepEqual(await balances(db,bookingPass),held);assert.equal(sqlite.prepare('SELECT stay_id FROM appointments WHERE id=7').get().stay_id,null);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,cashBefore);sqlite.exec('DROP TRIGGER synthetic_checkin_failure');
let depositRace=false;
const racedDb={prepare(sql){const stmt=db.prepare(sql);stmt.testSql=sql;return stmt;},batch(stmts){if(!depositRace&&stmts[0].testSql?.includes('INSERT INTO stay_pass_operations')){depositRace=true;sqlite.exec("INSERT INTO transactions(id,kind,amount,customer_id,deposit_appointment_id,payment_type) VALUES(9110,'income',10,1,7,'deposit')");}return db.batch(stmts);}};
assert.equal((await checkInPassBooking(racedDb,7,form,actor,clock)).status,'conflict');assert.ok(depositRace);assert.deepEqual(await balances(db,bookingPass),held);assert.equal(sqlite.prepare('SELECT stay_id FROM appointments WHERE id=7').get().stay_id,null);sqlite.exec('DELETE FROM transactions WHERE id=9110');
const checked=await checkInPassBooking(db,7,form,actor,clock);assert.equal(checked.status,'created');assert.equal((await checkInPassBooking(db,7,form,actor,clock)).replayed,true);
assert.equal(sqlite.prepare('SELECT status FROM stay_passes WHERE id=?').get(bookingPass).status,'fully_used');assert.equal((await balances(db,bookingPass)).remaining_units,0);assert.equal((await balances(db,bookingPass)).reserved_units,0);
assert.equal(sqlite.prepare('SELECT agreed_total FROM stays WHERE id=?').get(checked.stayId).agreed_total,625);
assert.equal(sqlite.prepare('SELECT SUM(amount) paid FROM transactions WHERE stay_id=?').get(checked.stayId).paid,300);
assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions WHERE stay_id=? AND payment_type=\'checkin\'').get(checked.stayId).n,1);
assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_consents WHERE stay_id=?').get(checked.stayId).n,1);
assert.equal(sqlite.prepare('SELECT amount FROM transactions WHERE id=9100').get().amount,100);
assert.equal(sqlite.prepare('SELECT 625-SUM(amount) balance FROM transactions WHERE stay_id=?').get(checked.stayId).balance,325);
await assert.rejects(()=>checkInPassBooking(db,7,{...form,amountCents:10000},actor,clock),/idempotency_conflict/);
assert.throws(()=>sqlite.prepare('UPDATE stays SET agreed_total=500 WHERE id=?').run(checked.stayId),/stay_pass_booking_locked/);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Pass conversion/check-in passed: existing booking and deposit preserved, cash total + hold atomic, locked legacy edits, consent, partial cash receipt, exact consumption, rollback and retry once.');

const zeroClock=new Date('2027-03-02T07:00:00Z');
const zeroPlan=await savePlan(db,{planId:null,code:'ZERO-CASH',expectedRevision:0,config:{...initialPlan(),policy_version:sqlite.prepare("SELECT version FROM stay_pass_policy_versions WHERE status='approved' LIMIT 1").get().version},key:key(),reason:'Synthetic no-cash check-in'},actor,zeroClock);
await savePrice(db,{planId:zeroPlan.planId,planVersionId:zeroPlan.id,expectedRevision:1,effectiveAt:null,key:key(),reason:'Synthetic prices'},actor,zeroClock);
const zeroBase={planId:zeroPlan.planId,customerId:1,size:'small',dogIds:[4]},zeroQuote=await quoteSale(db,zeroBase,actor,zeroClock);
const zeroPass=await recordPaidSale(db,{...zeroBase,key:key(),quoteHash:zeroQuote.quote_hash,paidCents:510000,paymentMethod:'cash',reference:'Synthetic',reason:'Synthetic zero-cash test',acceptance:{confirmed:true,channel:'document',evidence:'Synthetic only',acceptedAt:zeroClock.toISOString()}},actor,zeroClock);
sqlite.exec("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights,service_type,agreed_total,cloud_revision) VALUES(8,1,'2027-03-02','2027-03-03',1,'overnight',400,'zero-original');INSERT INTO appointment_dogs(appointment_id,dog_id,nightly_rate_cents) VALUES(8,4,40000)");
sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(8,?)').run(JSON.stringify({version:1,checkin_time:'14:00',checkout_time:'14:00'}));
const zq=await quotePassBooking(db,{passId:zeroPass.passId,bookingId:8,convert:true},actor,zeroClock);assert.equal(zq.settlement.cash_cents,0);
assert.equal((await convertPassBooking(db,{passId:zeroPass.passId,bookingId:8,key:key(),quoteHash:zq.quote_hash,reason:'Synthetic fully covered conversion'},actor,zeroClock)).status,'saved');
const zc=await quotePassCheckin(db,8,actor,zeroClock),zf={...form,key:key(),revision:zc.booking_revision,passQuoteHash:zc.quote_hash,arrivalDay:'2027-03-02',arrivalTime:'14:00',pickupDay:'2027-03-03',pickupTime:'14:00',quantity100:100,expectedBalance:0,amountCents:0,paymentDate:'2027-03-02'};
const noCashBefore=sqlite.prepare('SELECT count(*) n FROM transactions').get().n,zeroStay=await checkInPassBooking(db,8,zf,actor,zeroClock);assert.equal(zeroStay.status,'created');assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,noCashBefore);assert.equal((await balances(db,zeroPass.passId)).remaining_units,56);
console.log('Fully covered check-in passed: credits consumed once, zero cash due, no zero-value or duplicate cash receipt.');

// Recovery must preserve the converted contract, cash receipts and consent, not just the quota ledger.
const {cloudSnapshot}=await import('../cloud_backup.mjs'),{storedArchive}=await import('../portable_archive.mjs');
const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
const recovery=await mkdtemp(join(tmpdir(),'pass-conversion-recovery-'));
try{
 const data=await cloudSnapshot(db);assert.equal(data.rows.stay_pass_checkin_commits.length,2);const archive=join(recovery,'fixture.zip');
 await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(data),'objects.json':'[]'}).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(recovery,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); assert db.execute('SELECT count(*) FROM stay_pass_checkin_commits').fetchone()[0]==2; assert db.execute('SELECT original_total_cents,cash_cents FROM stay_pass_booking_links WHERE booking_id=7').fetchone()==(900000,62500); assert db.execute('SELECT count(*) FROM stay_consents').fetchone()[0]==2; assert db.execute('PRAGMA foreign_key_check').fetchall()==[]",join(recovery,'restored','cloud-recovery.sqlite3')]);
}finally{await rm(recovery,{recursive:true,force:true});}
console.log('Converted booking recovery passed: immutable original total, check-in link, cash/deposit records, consent and foreign keys survive restore.');

// Synthetic renewal lots exercise the approved carry-first order without adding cash.
async function freshPass(){const q=await quoteSale(db,zeroBase,actor,zeroClock);return (await recordPaidSale(db,{...zeroBase,key:key(),quoteHash:q.quote_hash,paidCents:510000,paymentMethod:'cash',reference:'Synthetic',reason:'Synthetic multi-lot check-in',acceptance:{confirmed:true,channel:'document',evidence:'Synthetic only',acceptedAt:zeroClock.toISOString()}},actor,zeroClock)).passId;}
const oldSource=await freshPass(),renewed=await freshPass();
const purchaseLot=id=>sqlite.prepare("SELECT * FROM stay_pass_credit_lots WHERE pass_id=? AND source_kind='purchase'").get(id);
const oldLot=purchaseLot(oldSource),carryId=crypto.randomUUID();
function settledFixture(passId,lotId,kind,delta){const lot=sqlite.prepare('SELECT * FROM stay_pass_credit_lots WHERE id=?').get(lotId),rev=sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(passId).revision,op=crypto.randomUUID();
 sqlite.prepare('INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?)').run(op,passId,key(),'synthetic',rev,kind,'Synthetic approved renewal state',zeroClock.toISOString());
 sqlite.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at) VALUES(?,?,?,?,?,?,0,0,?,?,0,0,0,0,?)`).run(crypto.randomUUID(),op,passId,lotId,kind,delta,lot.remaining_units,lot.remaining_units+delta,zeroClock.toISOString());
 sqlite.prepare("UPDATE stay_pass_operations SET result='{}' WHERE id=?").run(op);sqlite.prepare('UPDATE stay_passes SET revision=revision+1 WHERE id=?').run(passId);
}
settledFixture(oldSource,oldLot.id,'renewal_transfer_out',-12);
sqlite.prepare("INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,source_lot_id,issued_units,origin_value_cents,expires_at,created_at) SELECT ?,id,'carry_forward',?,12,102000,expires_at,? FROM stay_passes WHERE id=?").run(carryId,oldLot.id,zeroClock.toISOString(),renewed);
settledFixture(renewed,carryId,'renewal_carry_forward',12);
sqlite.exec("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights,service_type,agreed_total,cloud_revision) VALUES(20,1,'2027-07-01','2027-07-05',4,'overnight',1700,'carry-original');INSERT INTO appointment_dogs(appointment_id,dog_id,nightly_rate_cents) VALUES(20,4,40000)");
sqlite.prepare('INSERT INTO boarding_charges(appointment_id,details) VALUES(20,?)').run(JSON.stringify({version:1,checkin_time:'14:00',checkout_time:'17:00'}));
const carryClock=new Date('2027-07-01T07:00:00Z'),cq=await quotePassBooking(db,{passId:renewed,bookingId:20,convert:true},actor,carryClock);
assert.equal(cq.settlement.covered_units,17);assert.deepEqual(cq.credit_allocation.map(l=>[l.lotId,l.units]),[[carryId,12],[purchaseLot(renewed).id,5]]);
assert.equal((await convertPassBooking(db,{passId:renewed,bookingId:20,key:key(),quoteHash:cq.quote_hash,reason:'Synthetic carry-first conversion'},actor,carryClock)).status,'saved');
const cc=await quotePassCheckin(db,20,actor,carryClock),cf={...zf,key:key(),revision:cc.booking_revision,passQuoteHash:cc.quote_hash,arrivalDay:'2027-07-01',pickupDay:'2027-07-05',pickupTime:'17:00',quantity100:400,paymentDate:'2027-07-01'};
const carryHeld=await balances(db,renewed),carryCash=sqlite.prepare('SELECT count(*) n FROM transactions').get().n;
sqlite.exec("CREATE TRIGGER multilot_fail BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='booking_checkin' BEGIN SELECT RAISE(ABORT,'multilot_failure');END");
await assert.rejects(()=>checkInPassBooking(db,20,cf,actor,carryClock),/multilot_failure/);assert.deepEqual(await balances(db,renewed),carryHeld);sqlite.exec('DROP TRIGGER multilot_fail');
assert.equal((await checkInPassBooking(db,20,cf,actor,carryClock)).status,'created');assert.equal((await checkInPassBooking(db,20,cf,actor,carryClock)).replayed,true);
assert.equal(sqlite.prepare('SELECT remaining_units FROM stay_pass_credit_lots WHERE id=?').get(carryId).remaining_units,0);assert.equal(purchaseLot(renewed).remaining_units,55);assert.equal((await balances(db,renewed)).reserved_units,0);
assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,carryCash);assert.equal(sqlite.prepare('SELECT remaining_units FROM stay_pass_credit_lots WHERE id=?').get(oldLot.id).remaining_units,48);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Multi-lot booking/check-in passed: carried credits first, purchase top-up, exact late units, per-lot consumption, atomic rollback, replay and no new cash receipt. Renewal sale workflow remains separate.');
