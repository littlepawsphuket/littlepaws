// Route using fresh stay details. A Stay Pass must never reach the legacy close endpoint.
export async function staffCheckoutAction({id,button,api,openReview,confirm,onSaved,onError}){
 if(button.disabled)return;
 button.disabled=true;
 try{
  const stay=await api('/api/stays/'+id);
  if(stay.status!=='checked_in'||stay.cancelled_at)throw Error('stay_changed');
  if(stay.pricing?.stay_pass||stay.stay_pass){await openReview(id);return;}
  if(!confirm())return;
  await api('/api/stays/'+id+'/check-out',{method:'POST'});
  await onSaved();
 }catch(error){onError(error);}finally{button.disabled=false;}
}
export const staffCheckoutCss=`
.staff-pass-checkout{margin-block:20px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--wash);scroll-margin-top:20px}
.staff-pass-checkout summary{min-height:44px;cursor:pointer;font-weight:700}
.staff-pass-checkout .sp-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:end}
.staff-pass-checkout .sp-form label{display:flex;flex-direction:column;gap:6px;min-width:0}
.staff-pass-checkout input:not([type=checkbox]),.staff-pass-checkout select,.staff-pass-checkout textarea{width:100%;box-sizing:border-box;min-width:0;min-height:48px;font:inherit}
.staff-pass-checkout button{min-height:48px;white-space:normal}
.staff-pass-checkout .sp-read-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px;margin-block:16px}
.staff-pass-checkout .sp-read-metrics dt{grid-column:1;font-weight:500}.staff-pass-checkout .sp-read-metrics dd{grid-column:2;margin:0;font-weight:700;overflow-wrap:anywhere}
.staff-pass-checkout .sp-check-row{grid-column:1/-1;display:flex!important;flex-direction:row!important;align-items:center;min-height:48px}
.staff-pass-checkout input[type=checkbox]{width:24px;height:24px;flex-shrink:0}.staff-pass-checkout .sp-full-row{grid-column:1/-1}
@media(max-width:540px){.staff-pass-checkout{padding:12px}.staff-pass-checkout .sp-form{grid-template-columns:minmax(0,1fr)}}
`;
