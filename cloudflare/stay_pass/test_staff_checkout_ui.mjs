import assert from 'node:assert/strict';
import {staffCheckoutAction} from './staff_checkout_ui.mjs';
import {outstandingPage} from '../staff_ui.mjs';
const run=async(stay,{fail=false,accept=true}={})=>{
 const calls=[],button={disabled:false};let reviewed=0,confirmed=0,saved=0,errors=0;
 await staffCheckoutAction({id:7,button,api:async(path,options)=>{calls.push([path,options]);if(fail)throw Error('offline');return stay;},openReview:async()=>{reviewed++;},confirm:()=>{confirmed++;return accept;},onSaved:async()=>{saved++;},onError:()=>{errors++;}});
 assert.equal(button.disabled,false);return {calls,reviewed,confirmed,saved,errors};
};
for(const stay of [{status:'checked_in',pricing:{stay_pass:{pass_number:'TEST'}}},{status:'checked_in',stay_pass:{}}]){
 const r=await run(stay);assert.equal(r.reviewed,1);assert.equal(r.confirmed,0);assert.equal(r.calls.length,1);assert.equal(r.saved,0);
}
let r=await run({status:'checked_in'});assert.equal(r.confirmed,1);assert.equal(r.saved,1);assert.equal(r.calls[1][0],'/api/stays/7/check-out');
r=await run({status:'checked_in'},{accept:false});assert.equal(r.calls.length,1);assert.equal(r.saved,0);
for(const stay of [{status:'completed'},{status:'checked_in',cancelled_at:'2026-11-28'}]){r=await run(stay);assert.equal(r.errors,1);assert.equal(r.confirmed,0);assert.equal(r.calls.length,1);}
r=await run(null,{fail:true});assert.equal(r.errors,1);assert.equal(r.calls.length,1);
let calls=0;await staffCheckoutAction({id:7,button:{disabled:true},api:()=>calls++});assert.equal(calls,0);
// Gate stays server-rendered in both languages: no preview module for staff or production.
for(const lang of ['th','en'])for(const [admin,preview,writes] of [[true,true,true],[true,true,false],[true,false,true],[false,true,true]]){
 const html=await outstandingPage(admin,false,'classic','Test',lang,preview,writes).text();
 assert.equal(html.includes('function passCheckoutUi('),admin&&preview);
 const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 new Function(script);if(admin&&preview)assert.ok(script.includes('},'+writes+',function passExtensionUi'));else assert.ok(script.endsWith(',null,false,null,false)'));assert.ok(script.endsWith(',false)'));
}
console.log('Staff checkout entry: fresh routing, Pass legacy-bypass prevention, normal checkout, stale/error/double-click safety and TH/EN preview/admin/write gates passed.');
