import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {db,sqlite,actor,key} from './test_foundation.mjs';
import {initialPlan} from './pricing.mjs';
import {savePlan,savePrice} from './repository.mjs';
import {quoteSale,recordPaidSale} from './sales.mjs';
import {quoteRefund,requestRefund,actOnRefund} from './refunds.mjs';
import {balances} from './credits.mjs';
import {cloudSnapshot} from '../cloud_backup.mjs';
const migration=await readFile(new URL('./migrations/007_refunds.sql',import.meta.url),'utf8');sqlite.exec(migration);sqlite.exec(migration);
const bought=new Date('2026-11-27T09:00:00+07:00'),now=new Date('2026-11-28T10:00:00+07:00');
sqlite.exec("INSERT INTO customers(id,name,archived) VALUES(99,'Refund demo',0);INSERT INTO dogs(id,name,customer_id,size,archived) VALUES(99,'Refund dog',99,'small',0)");
const plan=await savePlan(db,{planId:null,code:'REFUND-TEST',expectedRevision:0,config:{...initialPlan(),policy_version:'1.9.1'},reason:'Synthetic refund plan',key:key()},actor,bought);
await savePrice(db,{planId:plan.planId,planVersionId:plan.id,expectedRevision:1,effectiveAt:null,reason:'Synthetic refund price',key:key()},actor,bought);
async function purchase(){const input={planId:plan.planId,customerId:99,size:'small',dogIds:[99]},quote=await quoteSale(db,input,actor,bought);const paid=await recordPaidSale(db,{...input,quoteHash:quote.quote_hash,key:key(),paidCents:510000,paymentMethod:'cash',reference:'DEMO',reason:'Synthetic purchase',acceptance:{confirmed:true,channel:'document',evidence:'DEMO only',acceptedAt:bought.toISOString()}},actor,bought);assert.equal(paid.status,'saved');return paid.passId;}
const revision=id=>sqlite.prepare('SELECT revision FROM stay_passes WHERE id=?').get(id).revision;
const lot=id=>sqlite.prepare("SELECT * FROM stay_pass_credit_lots WHERE pass_id=? AND source_kind='purchase'").get(id);
function fixtureCredit(passId,lotId,kind,delta){
 const source=sqlite.prepare('SELECT * FROM stay_pass_credit_lots WHERE id=?').get(lotId),op=crypto.randomUUID(),at=bought.toISOString();
 sqlite.prepare('INSERT INTO stay_pass_operations(id,pass_id,actor_id,request_key,request_hash,expected_revision,kind,reason,created_at) VALUES(?,?,1,?,?,?,?,?,?)').run(op,passId,key(),'fixture',revision(passId),kind,'Synthetic settled ledger state',at);
 sqlite.prepare(`INSERT INTO stay_pass_credit_transactions(id,operation_id,pass_id,lot_id,kind,delta_units,delta_reserved,delta_refund_held,before_units,after_units,before_reserved,after_reserved,before_refund_held,after_refund_held,recorded_at) VALUES(?,?,?,?,?,?,0,0,?,?,0,0,0,0,?)`)
  .run(crypto.randomUUID(),op,passId,lotId,kind,delta,source.remaining_units,source.remaining_units+delta,at);
 sqlite.prepare("UPDATE stay_pass_operations SET result='{}' WHERE id=?").run(op);sqlite.prepare('UPDATE stay_passes SET revision=revision+1 WHERE id=?').run(passId);
}
const old=await purchase(),pass=await purchase(),oldLot=lot(old),carry=crypto.randomUUID();
// Fixture renewal transfers twelve units out and in, without a new cash receipt.
fixtureCredit(old,oldLot.id,'renewal_transfer_out',-12);
sqlite.prepare("INSERT INTO stay_pass_credit_lots(id,pass_id,source_kind,source_lot_id,issued_units,origin_value_cents,expires_at,created_at) SELECT ?,id,'carry_forward',?,12,102000,expires_at,? FROM stay_passes WHERE id=?").run(carry,oldLot.id,bought.toISOString(),pass);
fixtureCredit(pass,carry,'renewal_carry_forward',12);
let input={passId:pass,kind:'change_of_mind',units:60,requestedAt:'2026-11-28T09:30:00+07:00'};
const cashBefore=sqlite.prepare('SELECT COUNT(*) n FROM transactions').get().n,changes=sqlite.prepare('SELECT total_changes() n').get().n;
let quote=await quoteRefund(db,input,actor,now);assert.equal(quote.status,'ready');assert.equal(quote.amount_cents,510000);assert.equal(quote.carry_preserved_units,12);assert.equal(quote.due_day,'2026-12-12');assert.equal(sqlite.prepare('SELECT total_changes() n').get().n,changes);
const request={...input,key:key(),reason:'Customer changed their mind',evidence:'Synthetic notification',quoteHash:quote.quote_hash};
let saved=await requestRefund(db,request,actor,now);assert.equal(saved.status,'saved');assert.equal((await requestRefund(db,request,actor,now)).replayed,true);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM transactions').get().n,cashBefore);
assert.equal((await balances(db,pass)).available_units,12);assert.equal(sqlite.prepare('SELECT status FROM stay_passes WHERE id=?').get(pass).status,'active');
assert.equal((await quoteRefund(db,input,actor,now)).status,'refund_already_pending');
const approve={key:key(),reason:'Approved per seven-day policy',expectedRevision:revision(pass)};
assert.equal((await actOnRefund(db,saved.refundId,'approve',approve,actor,now)).refundStatus,'approved');
const payout={key:key(),reason:'Refund already paid',expectedRevision:revision(pass),paidAt:'2026-11-28T09:45:00+07:00',method:'transfer',evidence:'DEMO refund reference',amountCents:510000};
sqlite.exec("CREATE TRIGGER injected_refund_failure BEFORE INSERT ON stay_pass_audit_logs WHEN NEW.action='refund_paid' BEGIN SELECT RAISE(ABORT,'injected_refund_failure');END");
await assert.rejects(()=>actOnRefund(db,saved.refundId,'pay',payout,actor,now),/injected_refund_failure/);
assert.equal(sqlite.prepare('SELECT status FROM stay_pass_refunds WHERE id=?').get(saved.refundId).status,'approved');assert.equal((await balances(db,pass)).refund_held_units,60);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM transactions').get().n,cashBefore);
sqlite.exec('DROP TRIGGER injected_refund_failure');
assert.equal((await actOnRefund(db,saved.refundId,'pay',payout,actor,now)).refundStatus,'paid');assert.equal((await actOnRefund(db,saved.refundId,'pay',payout,actor,now)).replayed,true);
assert.equal((await actOnRefund(db,saved.refundId,'pay',{...payout,key:key(),expectedRevision:revision(pass)},actor,now)).status,'already_paid');
const remaining=await balances(db,pass);assert.equal(remaining.remaining_units,12);assert.equal(remaining.available_units,12);assert.equal(remaining.refund_held_units,0);assert.equal(lot(pass).remaining_units,0);assert.equal(sqlite.prepare('SELECT remaining_units FROM stay_pass_credit_lots WHERE id=?').get(carry).remaining_units,12);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM stay_pass_payment_links WHERE pass_id=? AND purpose='refund'").get(pass).n,1);assert.equal(sqlite.prepare('SELECT remaining_units FROM stay_pass_credit_lots WHERE id=?').get(oldLot.id).remaining_units,48);
assert.throws(()=>sqlite.prepare('UPDATE stay_pass_refunds SET amount_cents=1 WHERE id=?').run(saved.refundId),/stay_pass_(immutable|refund_state)/);assert.equal(sqlite.prepare('SELECT amount_cents FROM stay_pass_refunds WHERE id=?').get(saved.refundId).amount_cents,510000);
await assert.rejects(()=>quoteRefund(db,{...input,units:1},actor,now),error=>error.code==='refund_credit_exceeded');
// A settled five-day service fixture leaves ten days, valued at the original price.
const special=await purchase();fixtureCredit(special,lot(special).id,'stay_consumption',-20);
input={passId:special,kind:'change_of_mind',units:40,requestedAt:'2026-11-28T09:30:00+07:00'};
assert.equal((await quoteRefund(db,input,actor,now)).reason,'already_used');
input.kind='shop_unavailable';quote=await quoteRefund(db,input,actor,now);assert.equal(quote.amount_cents,340000);
const specialRequest={...input,key:key(),reason:'Shop cannot provide remaining service',evidence:'DEMO',quoteHash:quote.quote_hash};saved=await requestRefund(db,specialRequest,actor,now);
assert.equal((await balances(db,special)).available_units,0);assert.equal(sqlite.prepare('SELECT status FROM stay_passes WHERE id=?').get(special).status,'refund_pending');
assert.equal((await actOnRefund(db,saved.refundId,'reject',{key:key(),reason:'Customer chose to retain their credits',expectedRevision:revision(special)},actor,now)).refundStatus,'rejected');assert.equal((await balances(db,special)).remaining_units,40);assert.equal((await balances(db,special)).available_units,40);
await assert.rejects(()=>requestRefund(db,{...specialRequest,key:key()},actor,now),error=>error.code==='refund_confirmation_required');
const snap=await cloudSnapshot(db);assert(snap.rows.stay_pass_refunds.some(r=>r.status==='paid'));assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
console.log('Refund workflow passed: immutable request, inclusive deadline, purchase-only hold, preserved carry, approval, cash/credit rollback, paid replay, original-price special refund, rejection restoration and backup inclusion. No real money transferred.');

// HTTP boundary: no lifecycle write is reachable by default or on production.
const {stayPassRoute}=await import('./routes.mjs');
const {refundList}=await import('./refunds.mjs');
const admin={...actor,is_admin:true},env={DB:db,STAY_PASS_PREVIEW:'1',STAY_PASS_ENVIRONMENT:'development',STAY_PASS_REFUND_WRITES:'1'};
const http=(path,body,origin='https://staff.test')=>new Request('https://staff.test/api/stay-pass'+path,body?{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
const dummy={passId:special,kind:'shop_unavailable',units:1,requestedAt:now.toISOString()};
for(const path of ['/refunds/quote','/refunds/request','/refunds/action']){
 assert.equal((await stayPassRoute(http(path,dummy),{...env,STAY_PASS_REFUND_WRITES:'0'},admin)).status,404);
 assert.equal((await stayPassRoute(http(path,dummy),{...env,STAY_PASS_ENVIRONMENT:'production'},admin)).status,404);
 assert.equal((await stayPassRoute(http(path,dummy,'https://other.test'),env,admin)).status,403);
 assert.equal((await stayPassRoute(http(path,dummy),env,{...admin,is_admin:false})).status,403);
}
let listing=await refundList(db,{passId:special},actor,now);assert.equal(listing.refunds.length,1);assert.equal(listing.refunds[0].status,'rejected');assert.equal(listing.refunds[0].due_day,'2026-12-12');
assert.equal((await refundList(db,{passId:pass},actor,new Date('2027-01-01T00:00:00Z'))).refunds[0].alert,'');
await assert.rejects(()=>refundList(db,{offset:-1},actor),e=>e.code==='invalid_search');
const live=await purchase(),httpInput={passId:live,kind:'change_of_mind',units:60,requestedAt:bought.toISOString()},httpQuote=await (await stayPassRoute(http('/refunds/quote',httpInput),env,admin)).json();assert.equal(httpQuote.status,'ready');
const httpRequest={...httpInput,key:key(),reason:'Synthetic HTTP customer request',evidence:'Synthetic evidence',quoteHash:httpQuote.quote_hash};
let response=await stayPassRoute(http('/refunds/request',httpRequest),env,admin),httpSaved=await response.json();assert.equal(response.status,200);assert.equal(httpSaved.status,'saved');assert.equal((await (await stayPassRoute(http('/refunds/request',httpRequest),env,admin)).json()).replayed,true);
response=await stayPassRoute(http('/refunds?'+new URLSearchParams({pass:live})),env,admin);listing=await response.json();assert.equal(listing.refunds[0].id,httpSaved.refundId);assert.equal(listing.refunds[0].alert,'');
assert.equal((await refundList(db,{passId:live},actor,new Date('2026-12-11T00:00:00+07:00'))).refunds[0].alert,'due_soon');
assert.equal((await refundList(db,{passId:live},actor,new Date('2026-12-12T00:00:00+07:00'))).refunds[0].alert,'overdue');
sqlite.prepare('UPDATE app_users SET active=0 WHERE id=?').run(actor.id);
assert.equal((await stayPassRoute(http('/refunds'),env,admin)).status,403);
sqlite.prepare('UPDATE app_users SET active=1 WHERE id=?').run(actor.id);
console.log('Refund API/read boundary passed: disabled/production/origin/fresh-admin gates, quote/request replay, filtered history, inclusive deadline alerts and no payout on request.');
