// Development/staging only. Records an already received full payment; never transfers money.
export function salePaymentUi({root,node,api,money,en,quote,input,onSaved,endpoint='/sales/record',renewal=false,onPending=()=>{}}){
 const t=(th,eng)=>en?eng:th,form=Object.assign(node('form'),{className:'sp-form'}),status=node('p');status.setAttribute('role','status');
 form.append(node('h3',renewal?t('ต่ออายุและบันทึกรับชำระครบ','Renewal and full payment'):t('บันทึกการขายและรับชำระครบ','Sale and full payment')));
 const field=(label,element)=>{const wrap=node('label',label);wrap.append(element);form.append(wrap);return element;};
 const amount=field(t('ยอดรับเต็มจำนวน (บาท)','Full payment (THB)'),Object.assign(node('input'),{type:'number',value:quote.snapshot.paid_cents/100,readOnly:true}));
 const method=field(t('วิธีรับชำระ','Payment method'),node('select'));method.append(new Option(t('โอนเงิน','Transfer'),'transfer'),new Option(t('เงินสด','Cash'),'cash'));
 const reference=field(t('เลขอ้างอิงการชำระ','Payment reference'),Object.assign(node('input'),{maxLength:200}));
 const channel=field(t('ช่องทางยอมรับเงื่อนไข','Acceptance channel'),node('select'));channel.append(new Option('LINE','line'),new Option(t('เอกสาร','Document'),'document'),new Option(t('ต่อหน้า','In person'),'in_person'));
 const thaiNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
 const acceptedAt=field(t('วันเวลาที่ลูกค้ายอมรับ','Customer acceptance time'),Object.assign(node('input'),{type:'datetime-local',value:thaiNow,required:true,step:'1'}));
 const evidence=field(t('หลักฐานยอมรับเงื่อนไข / บันทึกอ้างอิง','Acceptance evidence / reference'),Object.assign(node('textarea'),{required:true,maxLength:2000,rows:3}));evidence.parentElement.className='sp-full-row';
 const accepted=field(t('ลูกค้าได้รับและยอมรับ Policy ฉบับที่แสดงแล้ว','Customer received and accepted the displayed policy'),Object.assign(node('input'),{type:'checkbox',required:true}));accepted.parentElement.className='sp-check-row sp-full-row';
 const photo=field(t('ลูกค้าอนุญาตใช้รูปน้องที่เลือกบนภาพ Stay Pass (ไม่บังคับ)','Customer permits photos of these dogs on Stay Pass images (optional)'),Object.assign(node('input'),{type:'checkbox'}));photo.parentElement.className='sp-check-row sp-full-row';
 const reason=field(t('หมายเหตุการขาย','Sale note'),Object.assign(node('textarea'),{required:true,maxLength:800,rows:2,value:renewal?t('ต่ออายุ Stay Pass','Stay Pass renewal'):t('จำหน่าย Stay Pass','Stay Pass sale')}));reason.parentElement.className='sp-full-row';
 const button=Object.assign(node('button',renewal?t('ยืนยันต่ออายุ','Confirm renewal'):t('ยืนยันบันทึกการขาย','Confirm sale')),{type:'submit'});button.className='sp-full-row';status.className='sp-full-row';form.append(button,status);root.append(form);
 let attempt=null;
 const errors={price_confirmation_required:t('ราคามีการเปลี่ยน กรุณาสรุปราคาและยืนยันใหม่','The price changed. Review and confirm a new quote.'),policy_not_approved:t('เงื่อนไขยังไม่อนุมัติ','Policy is not approved.'),conflict:t('ข้อมูลหรือจำนวนแพ็กเกจเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด','The data or sales limit changed. Review the latest list.'),full_payment_required:t('ต้องชำระเต็มจำนวนก่อนเปิดใช้','Full payment is required before activation.')};
 form.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;
  if(!attempt){if(!form.reportValidity())return;if(!confirm(renewal?t('ยืนยันต่ออายุและบันทึกเงินที่รับครบแล้ว?','Confirm renewal and the full payment already received?'):t('ยืนยันบันทึกการขายและเงินที่รับครบแล้ว?','Confirm this sale and the full payment already received?')))return;
   attempt={...input,key:crypto.randomUUID().replaceAll('-',''),quoteHash:quote.quote_hash,paidCents:quote.snapshot.paid_cents,paymentMethod:method.value,reference:reference.value,reason:reason.value,
    photoConsentDogIds:photo.checked?[...input.dogIds]:[],acceptance:{confirmed:accepted.checked,channel:channel.value,evidence:evidence.value,acceptedAt:acceptedAt.value+(acceptedAt.value.length===16?':00':'')+'+07:00'}};
  }
  onPending(true);for(const item of form.querySelectorAll('input,textarea,select'))item.disabled=true;button.disabled=true;
  try{const result=await api(endpoint,attempt);if(result.status!=='saved')throw Object.assign(Error(errors[result.status]||t('ข้อมูลเปลี่ยน กรุณาตรวจรายการล่าสุด','Data changed. Review the latest records.')),{httpStatus:409,code:result.status});await onSaved(result);}
  catch(error){status.textContent=errors[error.code]||error.message;if(error.httpStatus&&error.httpStatus<500){attempt=null;onPending(false);for(const item of form.querySelectorAll('input,textarea,select'))item.disabled=false;}}
  finally{if(form.isConnected)button.disabled=false;}
 };
}
