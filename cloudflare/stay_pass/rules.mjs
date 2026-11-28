// Pure domain arithmetic. No customer-rights defaults are inferred here.
export class StayPassError extends Error {constructor(code){super(code);this.code=code;}}
export const fail=code=>{throw new StayPassError(code);};
export function units(value){
 const match=/^(0|[1-9]\d{0,4})(?:\.(00|0|25|5|50|75))?$/.exec(String(value));
 if(!match)fail('invalid_credit');
 const result=Number(match[1])*4+({'25':1,'5':2,'50':2,'75':3}[match[2]]||0);
 if(result>146400)fail('invalid_credit');return result;
}
export const days=value=>{if(!Number.isSafeInteger(value)||value<0)fail('invalid_credit');return String(value/4);};
export function cents(value){const m=/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(String(value));if(!m)fail('invalid_money');return Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));}
export function stamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|\+07:00)$/.test(value))fail('invalid_time');const d=new Date(value),day=value.slice(0,10);if(!Number.isFinite(d.valueOf())||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)fail('invalid_time');return d.toISOString();}
export function thaiDay(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp(value)));}
export function calendarNotice(arrival,notified){return (Date.parse(thaiDay(arrival)+'T00:00:00Z')-Date.parse(thaiDay(notified)+'T00:00:00Z'))/86400000;}
export function cancellationQuote({units:creditUnits,arrival,notified,cause}){
 if(!Number.isSafeInteger(creditUnits)||creditUnits<=0||!['customer','shop','no_show'].includes(cause))fail('invalid_cancellation');
 const notice=calendarNotice(arrival,notified);if(cause==='no_show'&&Date.parse(stamp(notified))<Date.parse(stamp(arrival)))fail('no_show_before_arrival');const percent=cause==='shop'?0:cause==='no_show'?100:notice>=7?0:50;
 if(creditUnits*percent%100)fail('credit_precision_approval_required');
 return {notice_calendar_days:notice,percent,deduct_units:creditUnits*percent/100,release_units:creditUnits-creditUnits*percent/100};
}
export function oneYearExpiry(purchasedAt){
 const day=thaiDay(purchasedAt);if(day.endsWith('-02-29'))fail('leap_day_approval_required');
 const next=String(Number(day.slice(0,4))+1)+day.slice(4);
 // Exclusive next midnight expresses the approved end of the prior Thai day.
 const exclusive=new Date(next+'T00:00:00+07:00');return {expires_exclusive:exclusive.toISOString(),last_valid_day:new Date(Date.parse(next+'T00:00:00Z')-86400000).toISOString().slice(0,10)};
}
export function withinValidity(checkout,expiresExclusive){return Date.parse(stamp(checkout))<Date.parse(stamp(expiresExclusive));}
// Confirmed: purchase day is day one (Dec 1 through Dec 7, Thai time).
export function refundWindow(purchasedAt,requestedAt){
 const purchase=stamp(purchasedAt),requested=stamp(requestedAt),day=thaiDay(purchase);
 const exclusive=new Date(Date.parse(day+'T00:00:00+07:00')+7*86400000).toISOString();
 return {within_window:requested>=purchase&&requested<exclusive,expires_exclusive:exclusive,
  last_request_day:new Date(Date.parse(day+'T00:00:00Z')+6*86400000).toISOString().slice(0,10)};
}
export function refundDeadline(requestedAt){
 const day=thaiDay(requestedAt),exclusive=new Date(Date.parse(day+'T00:00:00+07:00')+15*86400000).toISOString();
 return {due_exclusive:exclusive,due_day:new Date(Date.parse(day+'T00:00:00Z')+14*86400000).toISOString().slice(0,10)};
}
export function changeOfMindRefund({purchasedAt,requestedAt,usedUnits,deductionUnits,paidCents}){
 if(![usedUnits,deductionUnits,paidCents].every(Number.isSafeInteger)||usedUnits<0||deductionUnits<0||paidCents<=0)fail('invalid_refund');
 const window=refundWindow(purchasedAt,requestedAt),reason=!window.within_window?'outside_refund_window':usedUnits>0||deductionUnits>0?'already_used':null;
 return {...window,eligible:reason===null,reason,refund_cents:reason===null?paidCents:0};
}
export function valueSlice(valueCents,totalUnits,beforeUnits,afterUnits){
 if(![valueCents,totalUnits,beforeUnits,afterUnits].every(Number.isSafeInteger)||valueCents<0||totalUnits<=0||beforeUnits<0||afterUnits<beforeUnits||afterUnits>totalUnits)fail('invalid_value');
 // Legacy floor allocator for internal reconciliation. Refunds use refundValueSlice.
 return Number(BigInt(valueCents)*BigInt(afterUnits)/BigInt(totalUnits)-BigInt(valueCents)*BigInt(beforeUnits)/BigInt(totalUnits));
}
// Confirmed refund rounding: nearest satang, halves upward, cumulative so
// splitting one refund into several requests cannot create additional money.
export function refundValueSlice(valueCents,totalUnits,beforeUnits,afterUnits){
 if(![valueCents,totalUnits,beforeUnits,afterUnits].every(Number.isSafeInteger)||valueCents<0||totalUnits<=0||beforeUnits<0||afterUnits<beforeUnits||afterUnits>totalUnits)fail('invalid_value');
 const value=BigInt(valueCents),denominator=BigInt(totalUnits);
 const rounded=units=>(2n*value*BigInt(units)+denominator)/(2n*denominator);
 return Number(rounded(afterUnits)-rounded(beforeUnits));
}
export const releaseGates=Object.freeze({sales:false,booking:false,refund:false,renewal:false,imageGenerator:false,
 pending:['leap_day_expiry','reschedule_policy','actual_stay_adjustments','capacity_override','policy_approval','production_approval']});
