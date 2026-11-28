import assert from 'node:assert/strict';
import {bookingSettlement,cashTopupCents} from './settlement.mjs';
import {overnightPricing} from '../boarding_pricing.mjs';
const dogs=[{id:1,name:'One',nightly_rate_cents:50000}];
for(const [minutes,percent,units] of [[120,0,0],[121,25,1],[360,25,1],[361,50,2],[720,50,2],[721,100,4]]){
 const day='2026-12-02',h=Math.floor(minutes/60),m=minutes%60;
 const price=overnightPricing({pricingVersion:1,service:'overnight',checkin:'2026-12-01',checkout:day,checkinTime:'00:00',checkoutTime:String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'),quantity100:100,dogs:dogs.map(d=>({id:d.id,rate:d.nightly_rate_cents}))});
 assert.equal(price.percent,percent);const q=bookingSettlement({baseUnits:4,latePercent:price.percent,dogs,availableUnits:4,service:'overnight'});
 assert.equal(q.late_units,units);assert.equal(q.cash_units,units);assert.equal(q.cash_cents,price.fee_cents);
}
assert.equal(cashTopupCents(2,50000),25000);assert.equal(cashTopupCents(1,40100),10000);
assert.equal(cashTopupCents(2,25000,'daycare'),25000);assert.equal(cashTopupCents(1,25000,'daycare'),12500);
const family=[{id:1,name:'One',nightly_rate_cents:40000},{id:2,name:'Two',nightly_rate_cents:50000}];
const base={baseUnits:40,latePercent:25,dogs:family,availableUnits:36,service:'overnight'};
assert.ok(bookingSettlement(base).blockers.includes('per_pet_credit_allocation_required'));
assert.equal(bookingSettlement(base).cash_cents,null);
const q=bookingSettlement({...base,allocations:[{dog_id:1,credit_units:21},{dog_id:2,credit_units:15}]});
assert.equal(q.cash_cents,75000);assert.equal(q.late_cash_cents,12500);assert.equal(q.late_covered_units,1);assert.ok(q.rows.every(r=>r.base_cash_cents+r.late_cash_cents===r.cash_cents));assert.deepEqual(q.rows.map(r=>r.covered_units),[21,15]);assert.equal(q.available_after_units,0);
assert.equal(bookingSettlement({...base,allocations:[{dog_id:1,credit_units:18},{dog_id:2,credit_units:18}]}).cash_cents,67500);
assert.throws(()=>bookingSettlement({...base,allocations:[{dog_id:1,credit_units:21},{dog_id:2,credit_units:16}]}),/invalid_credit_allocation/);
assert.throws(()=>bookingSettlement({...base,availableUnits:-1}));assert.throws(()=>bookingSettlement({...base,latePercent:30}));
const empty=bookingSettlement({...base,availableUnits:0});assert.equal(empty.covered_units,0);assert.equal(empty.cash_units,42);assert.equal(empty.cash_cents,472500);
assert.equal(bookingSettlement({...base,availableUnits:42}).cash_cents,0);
assert.equal(bookingSettlement({...base,dogs:[{id:1,nightly_rate_cents:null},{id:2,nightly_rate_cents:null}]}).cash_cents,null);
assert.throws(()=>bookingSettlement({...base,allocations:[null,null]}),/invalid_credit_allocation/);
console.log('Settlement passed: shared late thresholds, 0.25-day precision, exhausted credits, regular-price cash, Day Care normalization, whole-baht rounding, explicit family allocations and invalid-input guards.');
