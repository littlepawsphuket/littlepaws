// Serialized into the authenticated development page; customer data uses textContent.
export function passRefundUi({root,node,api,money,en,pass,lots,writes,onChanged}){
 const t=(th,eng)=>en?eng:th,days=u=>String(u/4),atNow=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,19);
 const states={requested:t('รออนุมัติ','Awaiting approval'),approved:t('อนุมัติแล้ว รอคืนเงินจริง','Approved · awaiting payout'),rejected:t('ยุติคำขอ คืนสิทธิ์แล้ว','Closed · credits released'),paid:t('คืนเงินแล้ว','Paid')};
 const causes={change_of_mind:t('เปลี่ยนใจภายใน 7 วัน','Change of mind within 7 days'),death:t('น้องเสียชีวิต','Pet passed away'),serious_illness:t('เจ็บป่วยร้ายแรง','Serious illness'),force_majeure:t('เหตุสุดวิสัย','Force majeure'),shop_unavailable:t('ร้านไม่สามารถให้บริการ','Shop cannot provide service'),shop_closure:t('ร้านยุติบริการ','Shop closure'),legal:t('สิทธิตามกฎหมาย','Legal entitlement')};
 const errors={invalid_refund_payment:t('ตรวจวันเวลาคืนเงิน ยอดเงิน และหลักฐานคืนเงินจริง','Check the payout date, exact amount and payout evidence.'),invalid_request_time:t('เวลารับคำขอต้องไม่ก่อนเวลาซื้อหรือเป็นเวลาในอนาคต กรุณาตรวจวันและเวลารวมวินาที','The request time cannot precede purchase or be in the future. Check the date, time and seconds.'),refund_credit_exceeded:t('โควตาที่ขอคืนเกินยอดที่ใช้ได้','Requested credits exceed the available balance.'),full_refund_required:t('กรณีเปลี่ยนใจต้องขอคืนโควตาที่ซื้อใหม่ครบทั้งหมด','Change-of-mind refunds require all purchased credits.'),already_used:t('มีการใช้สิทธิ์หรือหักโควตาแล้ว','Credits have been used or deducted.'),outside_refund_window:t('พ้นช่วงคืนเงินแบบเปลี่ยนใจ','Outside the change-of-mind window.'),booking_review_required:t('ต้องจัดการรายการจองหรือโควตาที่กันไว้ก่อน','Review existing bookings or held credits first.'),refund_already_pending:t('มีคำขอคืนเงินที่ยังดำเนินการอยู่','A refund request is already pending.'),refund_source_review_required:t('ต้องตรวจแหล่งโควตาและรายการรับเงินก่อน','Credit and payment sources require review.')};
 const section=Object.assign(node('section'),{className:'sp-read-card'});root.append(section);section.append(node('h3',t('การคืนเงิน','Refunds')));
 const status=node('p');status.setAttribute('role','status');section.append(status);
 const field=(form,label,input)=>{const wrap=node('label',label);wrap.append(input);form.append(wrap);return input;};
 const input=(type,value,required=true)=>Object.assign(node('input'),{type,value,required});
 const text=()=>Object.assign(node('textarea'),{required:true,maxLength:800,rows:2});
 const key=()=>crypto.randomUUID().replaceAll('-','');
 const button=(form,label,action)=>{const b=Object.assign(node('button',label),{type:'button'});form.append(b);b.onclick=action;return b;};
 function resultError(result){if(result.status!=='saved')throw Error(errors[result.status]||t('ข้อมูลเปลี่ยน กรุณาโหลดประวัติใหม่ก่อนทำรายการ','Data changed. Reload the history before proceeding.'));}
 // Preserve the exact request and its key while a network result is uncertain.
 function writer(form,b,path,payload,summary,validate=()=>form.reportValidity()){let pending=null;return async()=>{
  if(!pending&&!validate())return;
  if(!pending){const data=payload();if(!data)return;if(!confirm(summary(data)))return;pending={...data,key:key()};for(const f of section.querySelectorAll('input,select,textarea,button'))if(f!==b)f.disabled=true;}
  b.disabled=true;status.textContent=t('กำลังบันทึก…','Saving…');
  try{const result=await api(path,pending);resultError(result);status.textContent=t('บันทึกแล้ว','Saved');await onChanged();}
  catch(error){if(error.httpStatus>=400&&error.httpStatus<500){pending=null;for(const f of section.querySelectorAll('input,select,textarea,button'))f.disabled=false;}status.textContent=(errors[error.code]||error.message)+' '+t('กดปุ่มเดิมเพื่อส่งข้อมูลเดิมซ้ำ หรือโหลดประวัติเพื่อตรวจผล','Retry the same button with unchanged data, or reload history to review the result.');}
  finally{b.disabled=false;}
 };}
 async function load(){try{const data=await api('/refunds?'+new URLSearchParams({pass:pass.id}));if(!section.isConnected)return;
  if(!data.refunds.length)section.append(node('p',t('ยังไม่มีประวัติการคืนเงิน','No refund history.')));
  for(const row of data.refunds){const card=Object.assign(node('article'),{className:'sp-read-card'});section.append(card);
   card.append(node('h4',states[row.status]),node('p',(causes[row.kind]||row.kind)+' · '+days(row.units)+' '+t('วัน','days')+' · '+money(row.amount_cents)),node('p',t('คืนภายใน ','Due by ')+row.due_day+' 23:59 · '+row.reason));
   if(row.alert)card.append(node('strong',row.alert==='overdue'?t('เกินกำหนดคืนเงิน','Refund overdue'):t('ใกล้ครบกำหนดคืนเงิน','Refund due soon')));
   if(!writes||!['requested','approved'].includes(row.status))continue;
   const form=Object.assign(node('form'),{className:'sp-form'});form.onsubmit=e=>e.preventDefault();card.append(form);
   const reason=field(form,t('เหตุผล / หมายเหตุ','Reason / note'),text());reason.closest('label').className='sp-full-row';
   if(row.status==='requested'){
    const b=button(form,t('อนุมัติคำขอ','Approve request'));
    b.onclick=writer(form,b,'/refunds/action',()=>({refundId:row.id,action:'approve',expectedRevision:row.revision,reason:reason.value}),()=>t('อนุมัติคำขอคืนเงิน ','Approve refund request ')+money(row.amount_cents)+'?');
   }else{
    field(form,t('ยอดคืนตามคำขอ','Approved refund amount'),Object.assign(input('text',money(row.amount_cents)),{readOnly:true}));
    const paidAt=field(form,t('วันเวลาที่คืนเงินจริง','Actual payout date and time'),Object.assign(input('datetime-local',atNow()),{step:'1'}));
    const method=node('select');method.append(new Option(t('โอนเงิน','Transfer'),'transfer'),new Option(t('เงินสด','Cash'),'cash'));field(form,t('ช่องทางคืนเงิน','Refund method'),method);
    const evidence=field(form,t('เลขอ้างอิง / หลักฐานคืนเงินจริง','Payout reference / evidence'),text());evidence.maxLength=2000;evidence.closest('label').className='sp-full-row';
    const b=button(form,t('บันทึกว่าคืนเงินจริงแล้ว','Record completed payout'));
    b.onclick=writer(form,b,'/refunds/action',()=>({refundId:row.id,action:'pay',expectedRevision:row.revision,reason:reason.value,amountCents:row.amount_cents,method:method.value,paidAt:paidAt.value+(paidAt.value.length===16?':00':'')+'+07:00',evidence:evidence.value}),()=>t('ยืนยันว่าคืนเงินจริงแล้ว ','Confirm money has already been refunded: ')+money(row.amount_cents)+t(' ระบบจะบันทึกและตัดเฉพาะโควตาที่อนุมัติ ไม่ได้โอนเงินแทนร้าน',' The system records the completed payout and cancels only the approved credits; it does not transfer money.'));
   }
   const reject=button(form,t('ยุติคำขอและคืนสิทธิ์ที่ระงับ','Close request and release held credits'));
   reject.onclick=writer(form,reject,'/refunds/action',()=>({refundId:row.id,action:'reject',expectedRevision:row.revision,reason:reason.value}),()=>t('ยุติคำขอและคืนโควตาที่ระงับไว้ โดยไม่บันทึกเงินคืน?','Close this request and release its credits without recording a cash refund?'),()=>reason.reportValidity());
  }
  if(writes&&!data.refunds.some(r=>['requested','approved'].includes(r.status)))newRequest();
 }catch(error){status.textContent=error.message;}}
 function newRequest(){const purchase=lots.filter(l=>l.source_kind==='purchase');if(purchase.length!==1)return;const lot=purchase[0],max=lot.remaining_units-lot.reserved_units-lot.refund_held_units;if(max<1)return;
  const box=node('details');box.append(node('summary',t('สร้างคำขอคืนเงิน','Create refund request')));section.append(box);
  box.append(node('p',t('คืนเงินเฉพาะโควตาที่ซื้อใหม่ โควตายกยอดคงสิทธิ์เดิมจนถึงวันหมดอายุแพ็กเกจใหม่','Refunds apply only to newly purchased credits. Carried credits retain their rights until this pass expires.')));
  const form=Object.assign(node('form'),{className:'sp-form'});form.onsubmit=e=>e.preventDefault();box.append(form);
  const kind=node('select');for(const [k,label] of Object.entries(causes))kind.append(new Option(label,k));field(form,t('ประเภทคำขอ','Refund type'),kind);
  const units=field(form,t('จำนวนวันที่ขอคืนเงิน','Days to refund'),Object.assign(input('number',days(max)),{min:'0.25',max:days(max),step:'0.25'}));
  const requestedAt=field(form,t('วันเวลาที่ได้รับแจ้งจากลูกค้า','Customer notification date and time'),Object.assign(input('datetime-local',atNow()),{step:'1'}));
  const reason=field(form,t('เหตุผล','Reason'),text()),evidence=field(form,t('หลักฐานรับคำขอ','Request evidence'),text());evidence.maxLength=2000;for(const f of [reason,evidence])f.closest('label').className='sp-full-row';
  const quoteBox=node('div');box.append(quoteBox);const preview=button(form,t('ตรวจสิทธิ์และคำนวณเงินคืน','Check eligibility and quote'));
  const values=()=>({passId:pass.id,kind:kind.value,units:Number(units.value)*4,requestedAt:requestedAt.value+(requestedAt.value.length===16?':00':'')+'+07:00',reason:reason.value,evidence:evidence.value});let serial=0;
  form.oninput=()=>{serial++;quoteBox.replaceChildren();};
  preview.onclick=async()=>{if(!form.reportValidity())return;const seq=++serial;preview.disabled=true;quoteBox.replaceChildren();try{const data=values(),q=await api('/refunds/quote',data);if(seq!==serial)return;if(q.status!=='ready')throw Error(errors[q.reason]||errors[q.status]||t('ไม่เข้าเงื่อนไข กรุณาตรวจสอบ','Not eligible. Review this request.'));
   quoteBox.append(node('p',t('ยอดคืน ','Refund ')+money(q.amount_cents)+' · '+days(q.units)+' '+t('วัน','days')),node('p',t('คืนภายใน ','Due by ')+q.due_day+' 23:59'),node('p',t('โควตายกยอดที่ยังคงอยู่ ','Carried credits preserved: ')+days(q.carry_preserved_units)+' '+t('วัน','days')));
   const b=button(quoteBox,t('บันทึกคำขอและระงับโควตาที่ขอคืน','Save request and hold refund credits'));
   b.onclick=writer(form,b,'/refunds/request',()=>({...data,quoteHash:q.quote_hash}),()=>t('บันทึกคำขอคืนเงิน ','Save refund request ')+money(q.amount_cents)+t(' และระงับโควตาเฉพาะส่วนนี้ ยังไม่บันทึกเงินคืน?',' and hold only these credits, without recording a cash payout yet?'));
  }catch(error){quoteBox.replaceChildren(node('p',errors[error.code]||error.message));}finally{preview.disabled=false;}};
 }
 load();
}
