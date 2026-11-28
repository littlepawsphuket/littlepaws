import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {db,sqlite,actor,staff,key} from './test_foundation.mjs';
import {initialPlan} from './pricing.mjs';
import {savePlan,savePrice} from './repository.mjs';
import {quoteSale,recordPaidSale} from './sales.mjs';
import {quoteRenewal,recordRenewal} from './renewals.mjs';
import {balances} from './credits.mjs';
import {cloudSnapshot} from '../cloud_backup.mjs';
for(const name of ['007_refunds.sql','008_renewals.sql']){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');sqlite.exec(sql);sqlite.exec(sql);}
const bought=new Date('2026-11-27T09:00:00+07:00'),clock=new Date('2026-12-01T10:00:00+07:00');
sqlite.exec("INSERT INTO customers(id,name,archived) VALUES(99,'Renewal Demo',0);INSERT INTO dogs(id,name,customer_id,size,archived) VALUES(99,'Renewal dog',99,'small',0)");
const plan=await savePlan(db,{planId:null,code:'RENEWAL-TEST',expectedRevision:0,config:{...initialPlan(),policy_version:'1.9.1'},reason:'Synthetic renewal plan',key:key()},actor,bought);
await savePrice(db,{planId:plan.planId,planVersionId:plan.id,expectedRevision:1,effectiveAt:null,reason:'Synthetic renewal price',key:key()},actor,bought);
const base={planId:plan.planId,customerId:99,size:'small',dogIds:[99]};
const paid=(quote,at)=>({...base,key:key(),quoteHash:quote.quote_hash,paidCents:510000,paymentMethod:'cash',reference:'SYNTHETIC',reason:'Synthetic renewal transaction',acceptance:{confirmed:true,channel:'document',evidence:'DEMO only',acceptedAt:at.toISOString()}});
const first=await recordPaidSale(db,paid(await quoteSale(db,base,actor,bought),bought),actor,bought);assert.equal(first.status,'saved');
const oldBefore=await balances(db,first.passId),cashBefore=sqlite.prepare('SELECT count(*) n FROM transactions').get().n;
let q=await quoteRenewal(db,{...base,oldPassId:first.passId},actor,clock);assert.equal(q.carried_units,12);assert.equal(q.old_excess_units,48);assert.equal(q.origin_value_cents,102000);
const form={...paid(q,clock),oldPassId:first.passId};
sqlite.exec("CREATE TRIGGER renewal_test_fail BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='renewal_completed' BEGIN SELECT RAISE(ABORT,'renewal_failure');END");
await assert.rejects(()=>recordRenewal(db,form,actor,clock),/renewal_failure/);assert.deepEqual(await balances(db,first.passId),oldBefore);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,cashBefore);assert.equal(sqlite.prepare('SELECT count(*) n FROM stay_pass_renewals').get().n,0);sqlite.exec('DROP TRIGGER renewal_test_fail');
const result=await recordRenewal(db,form,actor,clock);assert.equal(result.status,'saved');assert.equal((await recordRenewal(db,form,actor,clock)).replayed,true);
assert.equal((await balances(db,first.passId)).remaining_units,48);assert.equal((await balances(db,result.passId)).remaining_units,72);assert.equal(sqlite.prepare('SELECT count(*) n FROM transactions').get().n,cashBefore+1);
const old=sqlite.prepare('SELECT * FROM stay_passes WHERE id=?').get(first.passId),fresh=sqlite.prepare('SELECT * FROM stay_passes WHERE id=?').get(result.passId);assert.equal(old.expires_at,'2027-11-26T17:00:00.000Z');assert.equal(fresh.purchase_at,clock.toISOString());assert.equal(fresh.expires_at,'2027-11-30T17:00:00.000Z');assert.equal(old.status,'active');
assert.equal(sqlite.prepare("SELECT origin_value_cents FROM stay_pass_credit_lots WHERE pass_id=? AND source_kind='carry_forward'").get(result.passId).origin_value_cents,102000);
await assert.rejects(()=>quoteRenewal(db,{...base,oldPassId:first.passId},actor,clock),e=>e.code==='already_renewed');await assert.rejects(()=>recordRenewal(db,{...form,reference:'CHANGED'},actor,clock),e=>e.code==='idempotency_conflict');
await assert.rejects(()=>quoteRenewal(db,{...base,oldPassId:result.passId},staff,clock),e=>e.code==='forbidden');await assert.rejects(()=>quoteRenewal(db,{...base,size:'medium',oldPassId:result.passId},actor,clock),e=>e.code==='cross_size_renewal_review_required');
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_renewals SET carried_units=0 WHERE id=?').run(result.renewalId),/stay_pass_immutable/);
// A second renewal carries prior carry first, preserving the originating lot and value.
q=await quoteRenewal(db,{...base,oldPassId:result.passId},actor,new Date('2026-12-02T03:00:00Z'));assert.equal(q.lines[0].source_kind,'carry_forward');assert.equal(q.origin_value_cents,102000);
const snapshot=await cloudSnapshot(db);assert.equal(snapshot.rows.stay_pass_renewals.length,1);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Renewal passed: one atomic sale + provenance-preserving carry, original excess/expiry retained, new purchase-date validity, failure rollback, replay, duplicate-source/cross-size/admin guards and backup inclusion.');

// A scheduled price change invalidates an unconfirmed renewal, never an old sale.
const nextClock=new Date('2026-12-02T03:00:00Z'),oldQuote=q,newVersion=await savePlan(db,{planId:plan.planId,code:'RENEWAL-TEST',expectedRevision:2,config:{...initialPlan(),policy_version:'1.9.1',pricing_mode:'manual',manual_prices_cents:{small:540000,medium:637500,large:765000}},reason:'Synthetic new price',key:key()},actor,nextClock);
await savePrice(db,{planId:plan.planId,planVersionId:newVersion.id,expectedRevision:3,effectiveAt:null,reason:'Synthetic new price',key:key()},actor,nextClock);
await assert.rejects(()=>recordRenewal(db,{...paid(oldQuote,nextClock),oldPassId:result.passId},actor,nextClock),e=>e.code==='renewal_confirmation_required');
q=await quoteRenewal(db,{...base,oldPassId:result.passId},actor,nextClock);assert.equal(q.sale.snapshot.paid_cents,540000);assert.equal(q.origin_value_cents,102000);
const next=await recordRenewal(db,{...paid(q,nextClock),oldPassId:result.passId,paidCents:540000},actor,nextClock);assert.equal(next.status,'saved');assert.equal((await balances(db,next.passId)).remaining_units,72);assert.equal((await balances(db,result.passId)).remaining_units,60);assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot FROM stay_passes WHERE id=?').get(first.passId).snapshot).paid_cents,510000);
// Fully used passes can renew before expiry; no invented carry or cash for carry.
const zeroQuote=await quoteSale(db,base,actor,nextClock),zero=await recordPaidSale(db,{...paid(zeroQuote,nextClock),paidCents:540000},actor,nextClock),zeroLot=sqlite.prepare("SELECT * FROM stay_pass_credit_lots WHERE pass_id=? AND source_kind='purchase'").get(zero.passId),zeroOp=crypto.randomUUID();
sqlite.prepare('INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) VALUES(?,?,1,?,?,1,?,?,?)').run(zeroOp,zero.passId,key(),'fixture','stay_consumption','Synthetic fully used pass',nextClock.toISOString());
sqlite.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at) VALUES(?,?,?,?,'stay_consumption',-60,0,0,60,0,0,0,0,0,?)`).run(crypto.randomUUID(),zeroOp,zero.passId,zeroLot.id,nextClock.toISOString());
sqlite.prepare("UPDATE stay_pass_operations SET result='{}' WHERE id=?").run(zeroOp);sqlite.prepare("UPDATE stay_passes SET revision=2,status='fully_used' WHERE id=?").run(zero.passId);
q=await quoteRenewal(db,{...base,oldPassId:zero.passId},actor,nextClock);assert.equal(q.carried_units,0);assert.equal(q.old_excess_units,0);const z=await recordRenewal(db,{...paid(q,nextClock),oldPassId:zero.passId,paidCents:540000},actor,nextClock);assert.equal(z.status,'saved');assert.equal((await balances(db,z.passId)).remaining_units,60);assert.equal((await balances(db,z.passId)).lots.length,1);
// Boundary and access checks are performed before any new sale write.
await assert.rejects(()=>quoteRenewal(db,{...base,oldPassId:z.passId},actor,new Date('2025-01-01T00:00:00Z')),e=>e.code==='renewal_not_eligible');
await assert.rejects(()=>quoteRenewal(db,{...base,oldPassId:z.passId},actor,new Date('2027-12-02T00:00:00+07:00')),e=>e.code==='renewal_not_eligible');
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Renewal boundaries passed: price reconfirmation, original value lock across repeat renewal, fully-used/zero-carry renewal and before-purchase/exact-expiry guards.');

const {stayPassRoute}=await import('./routes.mjs');
const admin={...actor,is_admin:true},env={DB:db,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development',STAY_PASS_SALES_WRITES:'1',STAY_PASS_RENEWAL_WRITES:'1'};
const http=(path,body,origin='https://staff.test')=>new Request('https://staff.test/api/stay-pass'+path,body?{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
for(const path of ['/renewals/quote','/renewals/record']){
 for(const disabled of [{...env,STAY_PASS_RENEWAL_WRITES:'0'},{...env,STAY_PASS_SALES_WRITES:'0'},{...env,STAY_PASS_ENVIRONMENT:'production'}])assert.equal((await stayPassRoute(http(path,{}),disabled,admin)).status,404);
 assert.equal((await stayPassRoute(http(path,{},'https://other.test'),env,admin)).status,403);
}
const history=await (await stayPassRoute(http('/renewals?'+new URLSearchParams({pass:result.passId})),env,admin)).json();assert.equal(history.renewals.length,2);
sqlite.prepare('UPDATE app_users SET active=0 WHERE id=?').run(actor.id);assert.equal((await stayPassRoute(http('/renewals?'+new URLSearchParams({pass:result.passId})),env,admin)).status,403);sqlite.prepare('UPDATE app_users SET active=1 WHERE id=?').run(actor.id);
console.log('Renewal HTTP boundaries passed: default and production locks, independent sale/renewal flags, same-origin and fresh administrator guard, scoped history.');
const {passDetail}=await import('./read_models.mjs');
const oldView=await passDetail(db,first.passId,actor,clock);assert.equal(oldView.totals.used_units,0);assert.equal(oldView.totals.transferred_units,12);assert.equal(oldView.ledger_consistent,true);
const newView=await passDetail(db,next.passId,actor,nextClock);assert.equal(newView.totals.carry_units,12);assert.equal(newView.totals.purchased_units,60);assert.equal(newView.ledger_consistent,true);
console.log('Renewal read totals passed: transferred credits are separate from service use, purchase and carry totals reconcile with the ledger.');

// The owner's carry-preservation refund policy also applies to an actual renewal.
const {quoteRefund,requestRefund,actOnRefund}=await import('./refunds.mjs'),refundClock=new Date('2026-12-03T03:00:00Z');
const refundInput={passId:next.passId,kind:'change_of_mind',units:60,requestedAt:refundClock.toISOString()},refundQuote=await quoteRefund(db,refundInput,actor,refundClock);assert.equal(refundQuote.amount_cents,540000);assert.equal(refundQuote.carry_preserved_units,12);
const refund=await requestRefund(db,{...refundInput,key:key(),quoteHash:refundQuote.quote_hash,reason:'Synthetic refund of new purchase only',evidence:'Synthetic customer notice'},actor,refundClock);
let revision=sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(next.passId).revision;
await actOnRefund(db,refund.refundId,'approve',{key:key(),expectedRevision:revision,reason:'Synthetic approval'},actor,refundClock);revision++;
assert.equal((await actOnRefund(db,refund.refundId,'pay',{key:key(),expectedRevision:revision,reason:'Synthetic payout record',amountCents:540000,paidAt:refundClock.toISOString(),method:'cash',evidence:'Synthetic payout only'},actor,refundClock)).status,'saved');
assert.equal((await balances(db,next.passId)).remaining_units,12);assert.equal((await balances(db,next.passId)).available_units,12);assert.equal(sqlite.prepare('SELECT status FROM stay_passes WHERE id=?').get(next.passId).status,'active');
assert.equal((await balances(db,result.passId)).remaining_units,60);assert.equal((await passDetail(db,next.passId,actor,refundClock)).ledger_consistent,true);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Renewal/refund integration passed: only the actual new purchase is refunded, carried rights/value remain active and the original pass is unchanged.');

// Recover the actual renewed/refunded graph, not merely a fixture without links.
const {storedArchive}=await import('../portable_archive.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
const recovery=await mkdtemp(join(tmpdir(),'pass-renewal-recovery-'));
try{
 const snapshot=await cloudSnapshot(db),archive=join(recovery,'fixture.zip');
 await writeFile(archive,new Uint8Array(await storedArchive({'snapshot.json':JSON.stringify(snapshot),'objects.json':'[]'}).arrayBuffer()));
 execFileSync('python3',['-m','cloudflare.restore_backup',archive,join(recovery,'restored')],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
 execFileSync('python3',['-c',"import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); assert d.execute('SELECT count(*) FROM stay_pass_renewals').fetchone()[0]==3; assert d.execute(\"SELECT count(*) FROM stay_pass_refunds WHERE status='paid'\").fetchone()[0]==1; assert d.execute('PRAGMA foreign_key_check').fetchall()==[]; assert d.execute(\"SELECT count(*) FROM sqlite_master WHERE name='stay_pass_renewal_validate'\").fetchone()[0]==1; assert d.execute('SELECT SUM(carried_units) FROM stay_pass_renewals').fetchone()[0]==24",join(recovery,'restored','cloud-recovery.sqlite3')]);
}finally{await rm(recovery,{recursive:true,force:true});}
console.log('Renewal recovery passed: two generations of carry, zero-carry renewal, cash-linked refund, immutable guards and foreign keys survive portable restore.');
