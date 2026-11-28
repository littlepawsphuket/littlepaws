import assert from 'node:assert/strict';
import {checkoutTiming,checkoutSettlement,quotePassCheckout} from './checkout.mjs';
const base={checkinAt:'2027-03-01T14:00:00+07:00',scheduledCheckoutAt:'2027-03-04T14:00:00+07:00',originalQuantity100:300};
for(const [end,quantity,percent] of [['2027-03-01T15:00:00+07:00',100,0],['2027-03-02T16:00:00+07:00',100,0],['2027-03-02T16:01:00+07:00',100,25],['2027-03-02T20:00:00+07:00',100,25],['2027-03-02T20:01:00+07:00',100,50],['2027-03-03T02:00:00+07:00',100,50],['2027-03-03T02:01:00+07:00',100,100],['2027-03-04T14:00:00+07:00',300,0],['2027-03-05T17:00:00+07:00',400,25]]){
 const t=checkoutTiming({...base,actualCheckoutAt:end});assert.equal(t.suggested_quantity100,quantity);assert.equal(t.late_percent,percent);
}
assert.equal(checkoutTiming({...base,originalQuantity100:500,actualCheckoutAt:base.scheduledCheckoutAt}).quantity100,500);
assert.equal(checkoutTiming({...base,originalQuantity100:500,actualCheckoutAt:'2027-03-04T17:00:00+07:00'}).quantity100,500);
assert.equal(checkoutTiming({...base,actualCheckoutAt:'2027-03-02T17:00:00+07:00',quantity100:200}).quantity_overridden,true);
assert.throws(()=>checkoutTiming({...base,actualCheckoutAt:'2027-03-01T13:59:00+07:00'}),/invalid_checkout_time/);
assert.throws(()=>checkoutTiming({...base,actualCheckoutAt:'2027-02-30T14:00:00+07:00'}),/invalid_checkout_time/);
for(const quantity100 of [0,50,101,125,Infinity,'100'])assert.throws(()=>checkoutTiming({...base,actualCheckoutAt:base.scheduledCheckoutAt,quantity100}),/invalid_checkout_quantity/);
const lot=(id,kind,remaining=0,expires='2028-01-01T00:00:00.000Z')=>({id,source_kind:kind,remaining_units:remaining,reserved_units:0,refund_held_units:0,issued_units:60,expires_at:expires});
const row=(id,rate,total,covered)=>({dog_id:id,name:'Dog '+id,regular_rate_cents:rate,total_units:total,covered_units:covered,cash_cents:(total-covered)*rate/4});
const allocation=(lot_id,dog_id,units)=>({lot_id,dog_id,consumed_units:units,reserved_units:0});
const timing=checkoutTiming({...base,actualCheckoutAt:'2027-03-02T14:00:00+07:00'});
const original={rows:[row(1,40000,12,12)]},lots=[lot('carry','carry_forward'),lot('buy','purchase')],allocations=[allocation('carry',1,6),allocation('buy',1,6)];
let q=checkoutSettlement({timing,original,lots,allocations,nowAt:'2027-03-02T07:00:00.000Z',passStatus:'fully_used',paidCents:0});
assert.equal(q.restored_units,8);assert.deepEqual(q.restore_lines.map(r=>[r.lot_id,r.units]),[['buy',6],['carry',2]]);assert.equal(q.remaining_after_units,8);assert.equal(q.cash_cents,0);
// Cash-only overpayment is reviewed separately. Keep existing credit coverage before returning unused credits.
q=checkoutSettlement({timing,original:{rows:[row(1,40000,12,4)]},lots:[lot('buy','purchase')],allocations:[allocation('buy',1,4)],nowAt:'2027-03-02T07:00:00.000Z',passStatus:'active',paidCents:80000});
assert.equal(q.restored_units,0);assert.equal(q.refund_review_cents,80000);assert.equal(q.balance_cents,0);
q=checkoutSettlement({timing,original,lots:[lot('carry','carry_forward',0,'2027-03-02T00:00:00.000Z'),lot('buy','purchase')],allocations,nowAt:'2027-03-02T07:00:00.000Z',passStatus:'expired',paidCents:0});assert.equal(q.expired_restored_units,2);
const extended={...timing,units_per_dog:16,actual_checkout_at:'2027-03-05T07:00:00.000Z'};
q=checkoutSettlement({timing:extended,original,lots:[lot('buy','purchase',3)],allocations:[allocation('buy',1,12)],nowAt:'2027-03-05T07:00:00.000Z',passStatus:'active',paidCents:0});assert.equal(q.extra_covered_units,3);assert.equal(q.cash_cents,10000);assert.equal(q.balance_cents,10000);
// Another booking's hold and refund suspension cannot fund additional days.
q=checkoutSettlement({timing:extended,original,lots:[{...lot('buy','purchase',8),reserved_units:5,refund_held_units:2}],allocations:[allocation('buy',1,12)],nowAt:'2027-03-05T07:00:00.000Z',passStatus:'active',paidCents:0});assert.equal(q.extra_covered_units,1);assert.equal(q.cash_cents,30000);assert.equal(q.reserved_units,5);
const family={rows:[row(1,40000,12,12),row(2,50000,12,12)]},familyAlloc=[allocation('buy',1,12),allocation('buy',2,12)];
q=checkoutSettlement({timing:extended,original:family,lots:[lot('buy','purchase',3)],allocations:familyAlloc,nowAt:'2027-03-05T07:00:00.000Z',passStatus:'active',paidCents:0});assert.deepEqual(q.blockers,['per_pet_credit_allocation_required']);assert.equal(q.cash_cents,null);
q=checkoutSettlement({timing:extended,original:family,lots:[lot('buy','purchase',3)],allocations:familyAlloc,nowAt:'2027-03-05T07:00:00.000Z',passStatus:'active',paidCents:0,extraAllocations:[{dog_id:1,credit_units:0},{dog_id:2,credit_units:3}]});assert.equal(q.cash_cents,52500);assert.equal(q.rows[1].extra_covered_units,3);
// Do not use newly available credit to silently replace cash already agreed for the original period.
q=checkoutSettlement({timing:{...timing,units_per_dog:12},original:{rows:[row(1,40000,12,4)]},lots:[lot('buy','purchase',40)],allocations:[allocation('buy',1,4)],nowAt:'2027-03-02T07:00:00.000Z',passStatus:'active',paidCents:0});assert.equal(q.cash_cents,80000);assert.equal(q.extra_covered_units,0);
console.log('Checkout calculation: shared grace/tier boundaries, actual 24-hour suggestion, manual original days, carry-first restoration, expired provenance, saved dog rates, held credit exclusion, mixed cash and explicit family allocation passed.');

// Exercise genuine converted/check-in records; no financial or credit writes are permitted by this quote.
const {db,sqlite,actor,staff}=await import('./test_foundation.mjs');await import('./test_checkin.mjs');
const stay=sqlite.prepare('SELECT stay_id FROM appointments WHERE id=7').get().stay_id;
const before=JSON.stringify(await db.batch(['stays','transactions','stay_pass_credit_transactions','stay_pass_operations','stay_pass_credit_lots'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid'))));
const input={stayId:stay,actualCheckoutAt:'2027-03-03T13:00:00+07:00'};
const quoted=await quotePassCheckout(db,input,actor,new Date('2027-03-03T06:00:00Z'));
assert.equal(quoted.read_only,true);assert.equal(quoted.timing.quantity100,200);assert.equal(quoted.settlement.restored_units,52);assert.equal(quoted.settlement.cash_cents,0);assert.equal(quoted.settlement.refund_review_cents,30000);
assert.equal(JSON.stringify(await db.batch(['stays','transactions','stay_pass_credit_transactions','stay_pass_operations','stay_pass_credit_lots'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid')))),before);
await assert.rejects(()=>quotePassCheckout(db,input,staff),/forbidden/);
await assert.rejects(()=>quotePassCheckout(db,{...input,cashCents:0},actor),/invalid_request/);
assert.equal((await quotePassCheckout(db,input,actor,new Date('2027-03-03T06:00:00Z'))).quote_hash,quoted.quote_hash);
const {stayPassRoute}=await import('./routes.mjs'),env={DB:db,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development'},url='https://staff.test/api/stay-pass/checkout-quote';
const request=origin=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
assert.equal((await stayPassRoute(request('https://staff.test'),{...env,STAY_PASS_ENVIRONMENT:'production'},{...actor,is_admin:1})).status,404);
assert.equal((await stayPassRoute(request('https://else.test'),env,{...actor,is_admin:1})).status,403);
const response=await stayPassRoute(request('https://staff.test'),env,{...actor,is_admin:1});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).read_only,true);
console.log('Checkout review API: original check-in and deposit, deterministic quote, no writes, fresh-admin, strict input, origin and production isolation passed.');

const {readFile}=await import('node:fs/promises');const guard=await readFile(new URL('./migrations/010_checkout_review.sql',import.meta.url),'utf8');sqlite.exec(guard);sqlite.exec(guard);
assert.throws(()=>sqlite.prepare("UPDATE stays SET status='completed',actual_checkout_at='2027-03-03T06:00:00Z' WHERE id=?").run(stay),/stay_pass_checkout_review_required/);
assert.equal(sqlite.prepare('SELECT status FROM stays WHERE id=?').get(stay).status,'checked_in');sqlite.exec("INSERT INTO stays(id,customer_id,status) VALUES(9999,1,'checked_in'); UPDATE stays SET status='completed' WHERE id=9999");assert.equal(sqlite.prepare('SELECT status FROM stays WHERE id=9999').get().status,'completed');
console.log('Checkout migration safeguard passed: legacy closure of a linked Pass stay is blocked; ordinary checkout remains available; migration is repeatable.');

// Atomic confirmation: the actual checkout is saved only together with its exact dog/lot corrections.
const {confirmPassCheckout}=await import('./checkout.mjs'),{key}=await import('./test_foundation.mjs');
const sql11=await readFile(new URL('./migrations/011_checkout_commits.sql',import.meta.url),'utf8');sqlite.exec(sql11);sqlite.exec(sql11);
const clock=new Date('2027-03-03T06:00:00Z'),fresh=await quotePassCheckout(db,input,actor,clock);
const confirm={...input,key:key(),quoteHash:fresh.quote_hash,reason:'Synthetic early return confirmed by staff',confirmed:true,amountCents:0,paymentDate:'2027-03-03',receivedTime:'13:00'};
const oldCash=sqlite.prepare('SELECT count(*) n FROM transactions').get().n,oldBalance=sqlite.prepare('SELECT SUM(remaining_units) n FROM stay_pass_credit_lots WHERE pass_id=?').get(fresh.pass_id).n;
sqlite.exec("CREATE TRIGGER checkout_failure BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='checkout_reconciliation' BEGIN SELECT RAISE(ABORT,'checkout_simulated_failure');END");
await assert.rejects(()=>confirmPassCheckout(db,confirm,actor,clock),/checkout_simulated_failure/);
assert.equal(sqlite.prepare('SELECT status FROM stays WHERE id=?').get(stay).status,'checked_in');assert.equal(sqlite.prepare('SELECT SUM(remaining_units) n FROM stay_pass_credit_lots WHERE pass_id=?').get(fresh.pass_id).n,oldBalance);assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_checkout_commits').get().n,0);sqlite.exec('DROP TRIGGER checkout_failure');
let raced=false;const raceDb={prepare(sql){const stmt=db.prepare(sql);stmt.testSql=sql;return stmt;},batch(stmts){if(!raced&&stmts[0].testSql?.includes('INSERT INTO stay_pass_operations')){raced=true;sqlite.exec(`INSERT INTO transactions(kind,amount,customer_id,stay_id,payment_type) VALUES('income',1,1,${stay},'payment')`);}return db.batch(stmts);}};
assert.equal((await confirmPassCheckout(raceDb,confirm,actor,clock)).status,'conflict');assert.ok(raced);assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_checkout_commits').get().n,0);sqlite.prepare("DELETE FROM transactions WHERE stay_id=? AND payment_type='payment' AND amount=1").run(stay);
const completed=await confirmPassCheckout(db,confirm,actor,clock);assert.equal(completed.status,'completed');assert.equal(completed.restoredUnits,52);assert.equal(completed.refundReviewCents,30000);assert.equal((await confirmPassCheckout(db,confirm,actor,clock)).replayed,true);
const persistedReview=JSON.parse(sqlite.prepare('SELECT details FROM boarding_charges WHERE stay_id=?').get(stay).details).stay_pass.checkout_reconciliation;
for(const field of ['remaining_before_units','remaining_after_units','reserved_units','available_after_units'])assert.equal(persistedReview[field],fresh.settlement[field]);
assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,oldCash);assert.equal(sqlite.prepare('SELECT status,agreed_total,charged_nights FROM stays WHERE id=?').get(stay).status,'completed');assert.equal(sqlite.prepare('SELECT original_total_cents,total_cents FROM stay_pass_checkout_commits WHERE stay_id=?').get(stay).original_total_cents,62500);
assert.equal(sqlite.prepare('SELECT original_total_cents FROM stay_pass_booking_links WHERE booking_id=7').get().original_total_cents,900000);assert.equal(sqlite.prepare('SELECT SUM(consumed_units) n FROM stay_pass_booking_allocations WHERE booking_id=7').get().n,8);
const {passDetail}=await import('./read_models.mjs');const detail=await passDetail(db,fresh.pass_id,actor,clock);assert.equal(detail.ledger_consistent,true);assert.equal(detail.totals.used_units,8);
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_checkout_commits SET total_cents=1 WHERE stay_id=?').run(stay),/immutable/);
await assert.rejects(()=>confirmPassCheckout(db,{...confirm,reason:'Changed retry'},actor,clock),/idempotency_conflict/);
const flags={...env,STAY_PASS_BOOKING_WRITES:'1',STAY_PASS_CHECKOUT_WRITES:'1'},confirmUrl='https://staff.test/api/stay-pass/checkout-confirm',confirmRequest=()=>new Request(confirmUrl,{method:'POST',headers:{Origin:'https://staff.test','Content-Type':'application/json'},body:JSON.stringify(confirm)});
assert.equal((await stayPassRoute(confirmRequest(),env,{...actor,is_admin:1})).status,404);assert.equal((await stayPassRoute(confirmRequest(),{...flags,STAY_PASS_ENVIRONMENT:'production'},{...actor,is_admin:1})).status,404);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Atomic checkout confirmation passed: exact restoration, net service-use attribution, immutable original contract, separate cash refund review, rollback on audit failure, stale-payment race, replay and production/write gates.');

const longStay=sqlite.prepare('SELECT stay_id FROM appointments WHERE id=8').get().stay_id,longClock=new Date('2027-03-20T10:00:00Z'),longInput={stayId:longStay,actualCheckoutAt:'2027-03-20T17:00:00+07:00'};
const longQuote=await quotePassCheckout(db,longInput,actor,longClock);assert.equal(longQuote.settlement.extra_covered_units,56);assert.equal(longQuote.settlement.cash_cents,130000);
const longForm={...longInput,key:key(),quoteHash:longQuote.quote_hash,reason:'Synthetic late return and partial cash receipt',confirmed:true,amountCents:50000,paymentDate:'2027-03-20',receivedTime:'17:00',paymentMethod:'cash'};
const competitorsSecond={...longForm,key:key()},competitors=await Promise.allSettled([confirmPassCheckout(db,longForm,actor,longClock),confirmPassCheckout(db,competitorsSecond,actor,longClock)]);if(competitors[1].status==='fulfilled'&&['saved','completed'].includes(competitors[1].value.status))longForm.key=competitorsSecond.key;assert.equal(competitors.filter(r=>r.status==='fulfilled'&&r.value.status==='completed').length,1);
assert.equal(sqlite.prepare("SELECT count(*) n FROM transactions WHERE stay_id=? AND payment_type='checkout'").get(longStay).n,1);assert.equal(sqlite.prepare('SELECT SUM(amount) amount FROM transactions WHERE stay_id=?').get(longStay).amount,500);assert.equal(sqlite.prepare('SELECT agreed_total FROM stays WHERE id=?').get(longStay).agreed_total,1300);
const price=JSON.parse(sqlite.prepare('SELECT details FROM boarding_charges WHERE stay_id=?').get(longStay).details);assert.equal(price.stay_pass.credit_units,60);assert.equal(price.stay_pass.settlement.cash_cents,130000);assert.equal(price.stay_pass.settlement.late_units,1);assert.equal(price.stay_pass.settlement.late_cash_cents,10000);
console.log('Additional-credit/cash checkout passed: saved regular rate, late tier, partial receipt, outstanding balance, competing confirmations recorded once and customer-document price snapshot updated.');

const {cloudSnapshot}=await import('../cloud_backup.mjs'),{storedArchive}=await import('../portable_archive.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
const recovery=await mkdtemp(join(tmpdir(),'pass-checkout-recovery-'));
try{const data=await cloudSnapshot(db);assert.equal(data.rows.stay_pass_checkout_commits.length,2);const archive=join(recovery,'fixture.zip');await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(data),'objects.json':'[]'}).arrayBuffer()));execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(recovery,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});execFileSync('python3',['-c',"import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);assert d.execute('select count(*) from stay_pass_checkout_commits').fetchone()[0]==2;assert not d.execute('pragma foreign_key_check').fetchall();assert d.execute(\"select count(*) from sqlite_master where name='stay_pass_checkout_finalize_guard'\").fetchone()[0]==1",join(recovery,'restored','cloud-recovery.sqlite3')],{stdio:'pipe'});console.log('Checkout recovery passed: original/reconciled contract, credit events, cash receipt, immutable commit, protective triggers and foreign keys preserved.');}finally{await rm(recovery,{recursive:true,force:true});}
const {checkoutHistory}=await import('./checkout.mjs');const past=await checkoutHistory(db,fresh.pass_id,actor);assert.equal(past.checkouts.length,1);assert.equal(past.checkouts[0].refund_review_at_checkout_cents,30000);assert.equal(past.checkouts[0].remaining_units,52);await assert.rejects(()=>checkoutHistory(db,fresh.pass_id,staff),/forbidden/);
const {prepareImage}=await import('./images.mjs');const afterImage=await prepareImage(db,{passId:fresh.pass_id,kind:'usage',language:'th'},actor,clock);assert.equal(afterImage.snapshot.pass.remaining_units,52);assert.equal(afterImage.snapshot.totals.used_units,8);assert.equal(afterImage.snapshot.recent.delta_units,52);
console.log('Checkout follow-up passed: private immutable history and usage-image snapshot reconcile restored credits with net service use.');
