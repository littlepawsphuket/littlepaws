// Serialized into the authenticated development page; quote-only, no hold/payment endpoint.
export function bookingPreviewUi({root,node,api,money,en,canConvert=false}){
 const t=(th,eng)=>en?eng:th,days=u=>new Intl.NumberFormat(en?'en-GB':'th-TH',{maximumFractionDigits:2}).format(u/4);
 const panel=node('section');panel.className='card sp-panel';panel.append(node('h2',t('ทดลองใช้ Stay Pass กับการจอง','Preview Stay Pass for a booking')),
  node('p',canConvert?t('ตรวจสรุปโควตาและส่วนที่ชำระเป็นเงินก่อนยืนยันการจอง','Review credits and cash charges before confirming the booking.'):t('ค้นหาการจองเดิมเพื่อดูโควตาและเงินที่ต้องชำระเพิ่ม ยังไม่กันสิทธิ์ เช็กอิน หรือรับเงินจริง','Review credits and cash due for an existing booking. This preview does not reserve credits, check in, or receive money.')));
 const searchForm=node('form');searchForm.className='sp-booking-search';const search=node('input');search.type='search';search.maxLength=100;
 const label=node('label',t('เลขจอง ชื่อลูกค้า หรือชื่อน้องหมา','Booking number, customer or dog name'));label.append(search);
 const find=node('button',t('ค้นหาการจอง','Find bookings'));searchForm.append(label,find);
 const state=node('p');state.setAttribute('role','status');state.setAttribute('aria-live','polite');
 const choices=node('div'),result=node('div');panel.append(searchForm,state,choices,result);root.append(panel);
 let requestId=0,bookingId=null,passId=null,allocation=null;
 const errors={per_pet_credit_allocation_required:t('กรุณาแบ่งโควตาให้น้องแต่ละตัว แล้วกดคำนวณอีกครั้ง','Allocate credits to each dog, then calculate again.'),regular_rate_required:t('ยังไม่มีราคาปกติครบทุกตัว กรุณาตรวจการจอง','Complete the regular rates on the booking.'),booking_times_required:t('กรุณาบันทึกเวลาเข้าและรับกลับในการจองก่อน','Save arrival and pickup times on the booking first.'),pass_expired:t('แพ็กเกจหมดอายุแล้ว','This pass has expired.'),stay_crosses_expiry:t('วันรับกลับเกินอายุแพ็กเกจ','Pickup falls outside pass validity.'),promotion_cannot_combine:t('ใช้ Stay Pass ร่วมกับส่วนลดอื่นไม่ได้','Stay Pass cannot be combined with other discounts.'),deposit_excess_review_required:t('มีมัดจำส่วนเกิน กรุณาตรวจสอบก่อนเปลี่ยนวิธีชำระ','Excess deposits require review before changing payment mode.'),existing_payment_review_required:t('มีเงินรับเดิม ต้องตรวจการจัดการเงินก่อนเปลี่ยนเป็น Stay Pass','Existing payments require review before switching to Stay Pass.'),booking_warning_review_required:t('มีข้อควรตรวจเรื่องวันหยุด จำนวนที่ว่าง หรือการจองซ้อน','Review closures, capacity or overlapping bookings.'),daycare_duration_approval_required:t('เกณฑ์ระยะเวลา Day Care ยังรอยืนยัน','Day Care duration policy is pending approval.'),arrival_before_pass_purchase:t('วันเข้าพักก่อนวันที่ซื้อแพ็กเกจ','Arrival precedes pass purchase.')};
 async function calculate(){
  const seq=++requestId;result.replaceChildren();state.textContent=t('กำลังคำนวณ…','Calculating…');
  try{
   const q=await api('/booking-quote',{bookingId,passId,convert:canConvert,...(allocation?{allocations:allocation}: {})});if(seq!==requestId||!panel.isConnected)return;
   state.textContent='';const s=q.settlement;
   const summary=node('div');summary.className='sp-booking-summary';
   for(const [title,value] of [[t('ค่าฝากพื้นฐาน','Base boarding'),days(s.base_units)+' '+t('วัน','days')],[t('รับกลับล่าช้า','Late pickup'),days(s.late_units)+' '+t('วัน','days')],[t('ใช้โควตา','Pass credits'),days(s.covered_units)+' '+t('วัน','days')],[t('ส่วนเกินที่ชำระเงิน','Cash-covered portion'),days(s.cash_units)+' '+t('วัน','days')]]){const d=node('div');d.append(node('span',title),node('strong',value));summary.append(d);}
   const cash=node('p',t('ยอดชำระเพิ่ม: ','Additional cash due: ')+(s.cash_cents===null?t('กรุณาแบ่งโควตาก่อน','Allocate credits first'):money(s.cash_cents)));cash.className='sp-sale-total';
   if(q.payment_preview?.existing_deposit_cents>0){
    const paid=q.payment_preview;result.append(node('p',t('รับมัดจำเดิมแล้ว: ','Existing deposits: ')+money(paid.existing_deposit_cents)),node('p',t('ยอดชำระเพิ่มหลังหักมัดจำ: ','Cash due after deposits: ')+(paid.cash_due_cents===null?'—':money(paid.cash_due_cents))));
    if(paid.deposit_excess_cents>0)result.append(node('p',t('มัดจำเกินยอดใหม่: ','Deposit exceeds the new cash total: ')+money(paid.deposit_excess_cents)+t(' · ต้องตรวจวิธีจัดการก่อนยืนยัน ระบบไม่คืนเงินเอง',' · Review before confirmation; no automatic refund.')));
   }
   result.append(summary,cash,node('p',t('โควตาที่จองเพิ่มได้หลังรายการนี้: ','Available credits after this booking: ')+days(s.available_after_units)+' '+t('วัน','days')));
   if(q.credit_allocation?.length){const carry=q.credit_allocation.filter(l=>l.source_kind==='carry_forward').reduce((n,l)=>n+l.units,0);if(carry)result.append(node('p',t('ใช้โควตายกยอดก่อน: ','Carried credits used first: ')+days(carry)+' '+t('วัน','days')));}
   if(q.late_checkout)result.append(node('p',t('รับกลับเกินรอบ 24 ชั่วโมง: ','Beyond the 24-hour allowance: ')+q.late_checkout.extra_minutes+' '+t('นาที · ฟรี 2 ชั่วโมงแรก · อัตรา ','minutes · First 2 hours free · Tier ')+q.late_checkout.percent+'%'));
   const allocationInputs=[];
   for(const row of s.rows){const card=node('section');card.className='sp-booking-dog';card.append(node('h3',row.name),node('p',t('ราคาปกติในรายการ: ','Recorded regular rate: ')+(Number.isSafeInteger(row.regular_rate_cents)?money(row.regular_rate_cents):'—')));
    const input=node('input');Object.assign(input,{type:'number',min:'0',max:String(row.total_units/4),step:'0.25',value:row.covered_units===null?'':String(row.covered_units/4)});
    const l=node('label',t('โควตาที่ใช้กับน้อง (วัน)','Credits for this dog (days)'));l.append(input);card.append(l,node('p',t('ส่วนที่ชำระเงิน: ','Cash portion: ')+(row.cash_cents===null?'—':money(row.cash_cents))));
    input.addEventListener('input',()=>{cash.textContent=t('ยอดชำระเพิ่ม: กรุณากดคำนวณใหม่','Additional cash due: Recalculate to update');state.textContent=t('มีการแก้การแบ่งโควตา ยังไม่ได้คำนวณใหม่','Allocation changed. Recalculate before reviewing the amount.');});
    allocationInputs.push({dog_id:row.dog_id,input});result.append(card);
   }
   if(s.rows.length>1){const recalc=node('button',t('คำนวณการแบ่งโควตาใหม่','Recalculate allocation'));recalc.type='button';recalc.onclick=()=>{
    const next=allocationInputs.map(({dog_id,input})=>({dog_id,credit_units:Number(input.value)*4}));
    if(allocationInputs.some(({input})=>input.value===''||!input.checkValidity())||next.some(a=>!Number.isSafeInteger(a.credit_units))||next.reduce((n,a)=>n+a.credit_units,0)!==s.covered_units){state.textContent=t('โควตารวมต้องเท่ากับ ','Total allocated credits must equal ')+days(s.covered_units)+' '+t('วัน และเพิ่มทีละ 0.25 วัน','days, in increments of 0.25 day');return;}
    allocation=next;calculate();};result.append(recalc);}
   const review=node('ul');for(const code of q.blockers){if(['booking_release_not_approved','mixed_payment_integration_required'].includes(code))continue;review.append(node('li',errors[code]||t('กรุณาตรวจสิทธิ์หรือรายละเอียดก่อนดำเนินการ','Review eligibility and details before proceeding')));}if(review.children.length)result.append(review);
   if(canConvert){
    const confirmButton=node('button',t('ยืนยันใช้ Pass กับการจองนี้','Confirm Stay Pass for this booking'));confirmButton.type='button';
    const blocking=q.blockers.filter(c=>!['booking_release_not_approved','mixed_payment_integration_required'].includes(c));
    confirmButton.disabled=blocking.length>0||s.covered_units===0||s.cash_cents===null;
    let pending=null;
    confirmButton.onclick=async()=>{
     if(!pending&&!confirm(t('ยืนยันเปลี่ยนการจองนี้มาใช้ Stay Pass? ระบบจะกันโควตา และเก็บยอดจองเดิมไว้ในประวัติ','Use Stay Pass for this booking? Credits will be reserved and the original total retained in history.')+'\n'+q.pass_number+' · '+days(s.covered_units)+' '+t('วัน','days')+' · '+money(s.cash_cents)))return;
     pending??={passId,bookingId,allocations:allocation||undefined,quoteHash:q.quote_hash,key:[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join(''),reason:'Confirmed conversion of existing booking'};
     const controls=[...panel.querySelectorAll('input,select,button')].map(el=>({el,disabled:el.disabled}));for(const {el} of controls)el.disabled=true;
     try{const saved=await api('/booking-convert',pending);if(saved.status!=='saved')throw Error(t('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจการจองล่าสุด','Data changed. Review the latest booking.'));
      state.textContent=t('ยืนยันใช้ Pass แล้ว ยังไม่ได้เช็กอินหรือรับเงินเพิ่ม','Pass conversion confirmed. Check-in and additional payment are not yet recorded.');
      result.replaceChildren(node('h3',t('กันโควตาแล้ว ','Credits reserved: ')+days(s.covered_units)+' '+t('วัน','days')),node('p',t('ค่าบริการส่วนที่ชำระเป็นเงิน: ','Cash-covered service total: ')+money(s.cash_cents)));
      const link=node('a',t('ไปหน้ารายการจองเพื่อเช็กอิน','Open bookings to check in'));link.href='/#bookings';result.append(link);
     }catch(error){state.textContent=error.message;confirmButton.disabled=false;confirmButton.textContent=t('ส่งคำยืนยันเดิมอีกครั้ง / ตรวจผลก่อนแก้ไข','Retry the same confirmation / review before editing');}
    };result.append(confirmButton);
   }
   result.append(node('p',t('ตัวอย่างนี้ยังไม่เปลี่ยนราคาหรือการชำระเงินเดิม และยังไม่ใช่การยืนยันการใช้สิทธิ์','This preview does not change existing prices or payments and does not confirm credit use.')));
  }catch(e){if(seq===requestId)state.textContent=e.message;}
 }
 searchForm.onsubmit=async event=>{
  event.preventDefault();const seq=++requestId;find.disabled=true;choices.replaceChildren();result.replaceChildren();state.textContent=t('กำลังค้นหา…','Searching…');
  try{const data=await api('/booking-search?search='+encodeURIComponent(search.value.trim()));if(seq!==requestId||!panel.isConnected)return;
   if(!data.bookings.length){state.textContent=t('ไม่พบการจองที่รอเช็กอิน','No pending bookings found.');return;}
   state.textContent=t('แสดงไม่เกิน 50 รายการ หากไม่พบให้ระบุคำค้นให้เจาะจงขึ้น','Up to 50 results. Refine your search if needed.');
   const picker=node('select'),pickLabel=node('label',t('เลือกการจอง','Select booking'));picker.append(Object.assign(node('option',t('เลือกการจอง…','Select a booking…')),{value:''}));
   for(const b of data.bookings)picker.append(Object.assign(node('option',[b.booking_number||'#'+b.id,b.customer,b.pets,b.checkin+' → '+b.checkout].filter(Boolean).join(' · ')),{value:String(b.id)}));pickLabel.append(picker);choices.append(pickLabel);
   picker.onchange=async()=>{const pickSeq=++requestId;result.replaceChildren();allocation=null;bookingId=Number(picker.value);choices.querySelector('[data-pass-picker]')?.remove();if(!picker.value)return;
    state.textContent=t('กำลังตรวจแพ็กเกจ…','Checking passes…');try{const data=await api('/booking-options?booking='+bookingId);if(pickSeq!==requestId||!panel.isConnected)return;
     if(!data.passes.length){state.textContent=t('ไม่พบแพ็กเกจที่ตรงกับเจ้าของและน้องทุกตัวในการจองนี้','No eligible pass covers this customer and all dogs in the booking.');return;}
     const passSelect=node('select'),passLabel=node('label',t('เลือก Stay Pass','Choose Stay Pass'));passLabel.dataset.passPicker='1';passSelect.append(Object.assign(node('option',t('เลือกแพ็กเกจ…','Select a pass…')),{value:''}));for(const p of data.passes)passSelect.append(Object.assign(node('option',p.pass_number+' · '+t('จองเพิ่มได้ ','Available ')+days(p.available_units)+' '+t('วัน','days')),{value:p.id}));passLabel.append(passSelect);choices.append(passLabel);state.textContent='';
     passSelect.onchange=()=>{allocation=null;passId=passSelect.value;result.replaceChildren();if(passId)calculate();else requestId++;};
    }catch(e){if(pickSeq===requestId)state.textContent=e.message;}
   };
  }catch(e){if(seq===requestId)state.textContent=e.message;}finally{find.disabled=false;}
 };
}
