// Shared read-only quote for pass-covered boarding and regular-price cash top-ups.
import {fail} from './rules.mjs';
export function cashTopupCents(cashUnits,rateCents,service='overnight'){
 if(!['overnight','daycare'].includes(service)||!Number.isSafeInteger(cashUnits)||cashUnits<0||!Number.isSafeInteger(rateCents)||rateCents<0)fail('invalid_pass_booking');
 // Same whole-baht rule as existing boarding. Day Care buys 2 units, overnight 4.
 const value=BigInt(cashUnits)*BigInt(rateCents)/(service==='daycare'?200n:400n)*100n;
 if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('invalid_pass_booking');return Number(value);
}
export function bookingSettlement({baseUnits,latePercent,dogs,availableUnits,service,allocations}){
 if(!['overnight','daycare'].includes(service)||!Array.isArray(dogs)||!dogs.length||dogs.length>30||
  !Number.isSafeInteger(baseUnits)||baseUnits<1||baseUnits%dogs.length||!Number.isSafeInteger(availableUnits)||availableUnits<0||
  ![0,25,50,100].includes(latePercent)||(service==='daycare'&&latePercent!==0)||
  dogs.some(d=>!d||typeof d!=='object'||!Number.isSafeInteger(d.id)||d.id<1)||new Set(dogs.map(d=>d.id)).size!==dogs.length)fail('invalid_pass_booking');
 const baseEach=baseUnits/dogs.length,lateEach=latePercent/25,totalEach=baseEach+lateEach,total=totalEach*dogs.length;
 const covered=Math.min(total,availableUnits),blockers=[];
 if(!Number.isSafeInteger(total))fail('invalid_pass_booking');
 const rates=dogs.map(d=>d.nightly_rate_cents),ratesValid=rates.every(r=>Number.isSafeInteger(r)&&r>=0);
 let chosen=null;
 if(allocations!==undefined){
  if(!Array.isArray(allocations)||allocations.length!==dogs.length||allocations.some(a=>!a||typeof a!=='object')||new Set(allocations.map(a=>a.dog_id)).size!==dogs.length||
   allocations.some(a=>!dogs.some(d=>d.id===a.dog_id)||!Number.isSafeInteger(a.credit_units)||a.credit_units<0||a.credit_units>totalEach)||
   allocations.reduce((n,a)=>n+a.credit_units,0)!==covered)fail('invalid_credit_allocation');
  chosen=new Map(allocations.map(a=>[a.dog_id,a.credit_units]));
 }else if(covered===total||covered===0){chosen=new Map(dogs.map(d=>[d.id,covered===0?0:totalEach]));}
 else if(ratesValid&&new Set(rates).size===1){
  // Same cost for each dog; stable automatic split is visible and can be overridden.
  let left=covered;chosen=new Map([...dogs].sort((a,b)=>a.id-b.id).map(d=>{const n=Math.min(totalEach,left);left-=n;return [d.id,n];}));
 }else blockers.push('per_pet_credit_allocation_required');
 if(!ratesValid&&covered<total)blockers.push('regular_rate_required');
 const rows=dogs.map(d=>{
  const credit=chosen?.get(d.id)??null,cash=credit===null?null:totalEach-credit;
  const baseCredit=credit===null?null:Math.min(baseEach,credit),lateCredit=credit===null?null:Math.max(0,credit-baseEach);
  const totalCash=cash===0?0:cash!==null&&Number.isSafeInteger(d.nightly_rate_cents)&&d.nightly_rate_cents>=0?cashTopupCents(cash,d.nightly_rate_cents,service):null;
  const baseCash=baseCredit===null?null:baseEach-baseCredit,baseCents=baseCash===0?0:totalCash===null?null:cashTopupCents(baseCash,d.nightly_rate_cents,service);
  return {dog_id:d.id,name:d.name,regular_rate_cents:d.nightly_rate_cents,base_units:baseEach,late_units:lateEach,total_units:totalEach,
   covered_units:credit,base_covered_units:baseCredit,late_covered_units:lateCredit,base_cash_units:baseCash,late_cash_units:lateCredit===null?null:lateEach-lateCredit,cash_units:cash,base_cash_cents:baseCents,late_cash_cents:totalCash===null||baseCents===null?null:totalCash-baseCents,
   cash_cents:totalCash};
 });
 const cashTotal=rows.every(r=>r.cash_cents!==null)?rows.reduce((n,r)=>n+r.cash_cents,0):null;
 if(cashTotal!==null&&!Number.isSafeInteger(cashTotal))fail('invalid_pass_booking');
 return {base_units:baseUnits,late_units:lateEach*dogs.length,total_units:total,covered_units:covered,cash_units:total-covered,
  cash_cents:cashTotal,late_cash_cents:cashTotal===null?null:rows.reduce((n,r)=>n+r.late_cash_cents,0),late_covered_units:chosen?rows.reduce((n,r)=>n+r.late_covered_units,0):null,available_after_units:availableUnits-covered,rows,blockers};
}
