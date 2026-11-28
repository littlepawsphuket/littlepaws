import assert from 'node:assert/strict';
import {refundWindow,changeOfMindRefund,refundValueSlice} from './rules.mjs';
const purchasedAt='2026-12-01T15:30:00+07:00';
assert.equal(refundWindow(purchasedAt,'2026-12-01T15:29:59+07:00').within_window,false);
assert.equal(refundWindow(purchasedAt,purchasedAt).within_window,true);
assert.equal(refundWindow(purchasedAt,'2026-12-07T23:59:59.999+07:00').within_window,true);
assert.equal(refundWindow(purchasedAt,'2026-12-08T00:00:00+07:00').within_window,false);
assert.equal(refundWindow(purchasedAt,'2026-12-07T16:59:59.999Z').within_window,true);
assert.equal(refundWindow(purchasedAt,'2026-12-07T17:00:00Z').within_window,false);
assert.equal(refundWindow('2028-02-27T23:55:00+07:00','2028-03-04T23:59:59+07:00').within_window,true);
assert.equal(refundWindow('2026-12-29T12:00:00+07:00','2027-01-04T23:59:59+07:00').within_window,true);
const base={purchasedAt,requestedAt:'2026-12-07T23:59:59+07:00',usedUnits:0,deductionUnits:0,paidCents:510000};
assert.equal(changeOfMindRefund(base).refund_cents,510000);
assert.equal(changeOfMindRefund({...base,usedUnits:2}).reason,'already_used');
assert.equal(changeOfMindRefund({...base,deductionUnits:1}).reason,'already_used');
assert.equal(changeOfMindRefund({...base,requestedAt:'2026-12-08T00:00:00+07:00'}).reason,'outside_refund_window');
assert.throws(()=>changeOfMindRefund({...base,deductionUnits:0.5}),error=>error.code==='invalid_refund');
console.log('Confirmed refund rules passed: purchase is day one; Thai midnight, year/leap transitions; service use and cancellation/no-show deductions prevent ordinary full change-of-mind refund.');

for(const value of [1,7,510000,100001]){let sum=0;for(let i=0;i<60;i++)sum+=refundValueSlice(value,60,i,i+1);assert.equal(sum,value);assert.equal(refundValueSlice(value,60,0,60),value);}
assert.equal(refundValueSlice(1,4,0,2),1);assert.equal(refundValueSlice(1,4,2,4),0);assert.equal(refundValueSlice(510000,60,0,40),340000);
console.log('Refund rounding passed: nearest-satang cumulative slices, split requests, exact full remainder and original-value cap.');
