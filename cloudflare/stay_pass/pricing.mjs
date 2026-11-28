import {fail,stamp} from './rules.mjs';
export const sizes=['small','medium','large'];
export const initialPlan=()=>({name_th:'Little Paws Stay Pass',name_en:'Little Paws Stay Pass',credit_units:60,validity_months:12,
 pricing_mode:'automatic',discount_bps:1500,daily_reference_cents:{small:40000,medium:50000,large:60000},
 manual_prices_cents:{small:510000,medium:637500,large:765000},sales_limit:10,policy_version:'1.5',
 benefits_th:['ล็อกราคาบริการในแพ็กเกจ','แบ่งสิทธิ์ให้สุนัขขนาดเดียวกันที่ลงทะเบียน','ใช้ได้ช่วงเทศกาลโดยต้องจองและได้รับการยืนยัน'],
 benefits_en:['Locked package service price','Sharing between registered dogs of the same size','Holiday use subject to confirmed availability']});
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validatePlan(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_plan');
 const allowed=Object.keys(initialPlan());if(Object.keys(input).some(key=>!allowed.includes(key)))fail('invalid_plan');
 const c=structuredClone(input);
 for(const key of ['name_th','name_en'])if(typeof c[key]!=='string'||!c[key].trim()||[...c[key]].length>100)fail('invalid_plan');else c[key]=c[key].trim();
 if(!int(c.credit_units,1,146400)||!int(c.validity_months,1,120)||!int(c.sales_limit,1,1000000)||
  !['automatic','manual'].includes(c.pricing_mode)||!int(c.discount_bps,0,9999)||!/^\d+\.\d+(?:\.\d+)?$/.test(c.policy_version||''))fail('invalid_plan');
 for(const key of ['daily_reference_cents','manual_prices_cents']){
  if(!c[key]||Object.keys(c[key]).length!==3||sizes.some(size=>!int(c[key][size],1,9999999999)))fail('invalid_plan');
 }
 for(const key of ['benefits_th','benefits_en'])if(!Array.isArray(c[key])||c[key].length>20||c[key].some(x=>typeof x!=='string'||!x.trim()||[...x].length>400))fail('invalid_plan');
 return c;
}
export function pricePreview(input,previous={}){
 const config=validatePlan(input);const prices={};
 for(const size of sizes){
  const regularNumerator=BigInt(config.daily_reference_cents[size])*BigInt(config.credit_units);
  if(regularNumerator%4n)fail('money_rounding_approval_required');
  const regular=regularNumerator/4n;
  const saleNumerator=regular*BigInt(10000-config.discount_bps);
  if(config.pricing_mode==='automatic'&&saleNumerator%10000n)fail('money_rounding_approval_required');
  const sale=config.pricing_mode==='automatic'?saleNumerator/10000n:BigInt(config.manual_prices_cents[size]);
  if(sale<=0n||sale>regular||sale>9999999999n)fail('invalid_price');
  prices[size]={regular_cents:Number(regular),sale_cents:Number(sale),previous_cents:previous[size]?.sale_cents??null,
   saved_cents:Number(regular-sale),discount_bps:Number(((regular-sale)*10000n+regular/2n)/regular),
   average_daily_numerator_cents:Number(sale)*4,average_daily_denominator:config.credit_units};
 }
 return {config,prices,rounding:'exact_cents_only',financial_use_enabled:false};
}
export function effectivePrice(versions,at){const instant=stamp(at);return versions.filter(x=>x.effective_at<=instant).sort((a,b)=>b.effective_at.localeCompare(a.effective_at))[0]||null;}
