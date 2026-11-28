import {customerImageCss} from "./customer_image_styles.mjs";
import {intakeGroups,intakeGroupsEn} from "./stay_terms.mjs";

export const palette = {
  classic:["#153c32","#e7f2e9"], christmas:["#153c32","#eaf1eb"], valentine:["#702845","#f8e3eb"],
  halloween:["#412657","#f1e6f8"], songkran:["#124b63","#dff6f6"], buddhist:["#784817","#fbefd9"],
  japan:["#703750","#f8edf0"],
};
const labels = {
  en:{
    booking:"Booking confirmation",deposit:"Deposit receipt",stay:"Boarding summary",bookingNo:"Booking number",
    stayNo:"Stay number",customer:"Customer",contact:"Contact",checkin:"Check-in",checkout:"Pickup",
    actualIn:"Actual check-in",actualOut:"Actual check-out",service:"Service",duration:"Duration",dogs:"Dogs",
    total:"Total",discount:"Discount",due:"Balance due",paid:"Paid",depositReceived:"Deposit received",
    balanceAtCheckin:"Remaining balance for check-in",items:"Payment history",ratePending:"Rate pending",
    note:"Note",consent:"Customer acceptance and signature",agreed:"Accepted and signed",noConsent:"No saved signature",
    refund:"Refund",qr:"Payment QR",intake:"Check-in notes",pending:"Awaiting check-in",
    checked_in:"Checked in",completed:"Checked out",cancelled:"Cancelled",booked:"Booked",
    overnight:"Overnight boarding",daycare:"Day care",monthly:"Monthly boarding",
    day:"day",days:"days",month:"month",months:"months",night:"night",checkinPayment:"Check-in payment",
    addPayment:"Additional payment",slogan:"Because every little paw deserves a whole lot of love.",
    address1:"163/206 Moo 5, iLeaf Town 2 Village, Soi 12",address2:"Srisunthon, Thalang, Phuket 83110",
    phone:"Telephone 081-426-6241",
  },
  th:{
    booking:"ใบยืนยันการจอง",deposit:"ใบรับมัดจำ",stay:"สรุปการรับฝาก",bookingNo:"เลขจอง",
    stayNo:"เลขเข้าพัก",customer:"ลูกค้า",contact:"ช่องทางติดต่อ",checkin:"วันเข้าพัก",checkout:"วันรับกลับ",
    actualIn:"เช็กอินจริง",actualOut:"เช็กเอาต์จริง",service:"ประเภทบริการ",duration:"จำนวนวัน",dogs:"สุนัขที่รับฝาก",
    total:"ยอดสุทธิ",discount:"ส่วนลด",due:"ยอดคงเหลือ",paid:"ชำระแล้ว",depositReceived:"รับมัดจำ",
    balanceAtCheckin:"ยอดคงเหลือที่ต้องชำระในวันเข้าพัก",items:"ประวัติการชำระเงิน",ratePending:"รอระบุราคา",
    note:"หมายเหตุ",consent:"การยอมรับและลายเซ็นลูกค้า",agreed:"รับทราบและลงนามแล้ว",noConsent:"ยังไม่มีลายเซ็น",
    refund:"คืนเงิน",qr:"สแกน QR เพื่อชำระเงิน",intake:"รายละเอียดตอนเช็กอิน",pending:"รอเช็กอิน",
    checked_in:"เช็กอินแล้ว",completed:"กลับบ้านแล้ว",cancelled:"ยกเลิกแล้ว",booked:"จอง",
    overnight:"ฝากค้างคืน",daycare:"ฝากระหว่างวัน",monthly:"ฝากรายเดือน",
    day:"วัน",days:"วัน",month:"เดือน",months:"เดือน",night:"คืน",checkinPayment:"ชำระวันเข้าพัก",
    addPayment:"ชำระเพิ่มเติม",slogan:"เพราะทุกอุ้งเท้าเล็ก ๆ สมควรได้รับความรักที่ยิ่งใหญ่",
    address1:"163/206 ม.5 มบ.ไอลีฟทาวน์ 2 ซ.12",address2:"ต.ศรีสุนทร อ.ถลาง จ.ภูเก็ต 83110",
    phone:"โทร 081-426-6241",
  },
};

export const escape = (value) => String(value ?? "").replace(/[&<>"']/g,(character) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
}[character]));
const cell = (label,value) => `<div class="fact"><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`;
export const picture = (src,alt,css="") => src ? `<img class="${css}" src="${escape(src)}" alt="${escape(alt)}">` : "";
const money = (cents) => "฿"+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
export const dogIcon = `<span class="dog-icon" aria-hidden="true"><svg viewBox="0 0 48 48">
  <path fill="#d49a62" d="M12 18 9 7 Q20 7 23 16M25 16Q31 7 40 7L38 21"/>
  <path fill="#efc18e" d="M9 28C9 18 15 13 24 13S39 18 39 28s-6 14-15 14S9 38 9 28"/>
  <path fill="#f9e8cf" d="M15 33q9-12 18 0a9 9 0 0 1-18 0"/>
  <path fill="#472f29" d="M16 24a2 2 0 1 1 4 0 2 2 0 0 1-4 0m12 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0m-8 7q4-4 8 0-4 6-8 0"/>
</svg></span>`;

function signatureImage(value) {
  let strokes;
  try { strokes = JSON.parse(value); } catch { return ""; }
  if (!Array.isArray(strokes)) return "";
  const paths = [];
  for (const stroke of strokes.slice(0,150)) {
    if (!Array.isArray(stroke)) continue;
    const points = stroke.slice(0,4000).filter((point) => Array.isArray(point) && point.length===2 && point.every(Number.isInteger)
      && point[0]>=0 && point[0]<=720 && point[1]>=0 && point[1]<=240);
    if (points.length>1) paths.push(`<polyline points="${points.map((point) => point.join(",")).join(" ")}"/>`);
  }
  return paths.length ? `<svg class="signature" aria-hidden="true" viewBox="0 0 720 240" fill="none" stroke="#254639"
    stroke-linecap="round" stroke-linejoin="round" stroke-width="4">${paths.join("")}</svg>` : "";
}

function termsSection(terms) {
  if (!Array.isArray(terms?.sections)) return "";
  return `<section class="terms"><h2>${escape(terms.title)}</h2><p>${escape(terms.intro)}</p>${terms.sections.map((section) =>
    `<h3>${escape(section.heading)}</h3><ul>${Array.isArray(section.items)
      ? section.items.map((item) => `<li>${escape(item)}</li>`).join("") : ""}</ul>`).join("")}</section>`;
}

function intakeSection(intake,t,lang) {
  if (!intake) return "";
  const rows = [];
  const exam = lang === "th" ? {normal:"ปกติ",abnormal:"พบความผิดปกติ","1":"ตรวจแล้ว"}
    : {normal:"Normal",abnormal:"Concern noted","1":"Checked"};
  for (const group of lang === "th" ? intakeGroups : intakeGroupsEn) for (const [field,label,kind] of group.fields) {
    const value = intake[field];
    if (!value && (kind !== "item" || intake[field+"_packed"] !== "1")) continue;
    const rendered = kind === "exam" ? (exam[value] || value)
      : typeof kind === "object" ? kind[value] : value;
    rows.push(`<li>${escape(label)}${rendered ? " · "+escape(rendered) : ""}</li>`);
  }
  return rows.length ? `<section><h2>${escape(t.intake)}</h2><ul>${rows.join("")}</ul></section>` : "";
}

export function documentHtml(doc) {
  const {lang,kind,format} = doc;
  const t = labels[lang];
  const [accent,tint] = palette[doc.theme] || palette.classic;
  const dayFmt = new Intl.DateTimeFormat(lang==="en" ? "en-GB" : "th-TH",{dateStyle:"medium",timeZone:"Asia/Bangkok"});
  const timeFmt = new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Asia/Bangkok"});
  const day = (value) => Number.isFinite(Date.parse(value)) ? dayFmt.format(new Date(value)) : "—";
  const stamp = (value) => value && day(value) !== "—" ? day(value)+(value.length>10 ? " · "+timeFmt.format(new Date(value)) : "") : "—";
  const unit = doc.service_type === "monthly" ? (doc.charged_nights===1?t.month:t.months) : (doc.charged_nights===1?t.day:t.days);
  const rateUnit = doc.service_type === "monthly" ? t.month : doc.service_type === "daycare" ? t.day : t.night;
  const state = doc.stay_id ? t.checked_in : t[doc.status];
  const linked = [
    ...(doc.stay_number ? [cell(t.stayNo,doc.stay_number)] : []),
    ...(doc.booking_number ? [cell(t.bookingNo,doc.booking_number)] : []),
  ].join("");
  const paymentRows = (doc.deposit ? [doc.deposit] : doc.payments).map((payment) => ({
    left:[day(payment.occurred_on),payment.received_time].filter(Boolean).join(" · "),
    label:payment.description?.startsWith('กลับรายการเงินหลังเช็กเอาต์ Stay Pass')?(doc.lang==='en'?'Cash entry correction':'กลับรายการบันทึกเงิน'):{deposit:t.depositReceived,checkin:t.checkinPayment,additional:t.addPayment}[payment.payment_type],
    amount:money(payment.amount_cents),
  }));
  for (const refund of doc.refunds) paymentRows.push({left:day(refund.date),label:refund.description?.startsWith('กลับรายการเงินหลังเช็กเอาต์ Stay Pass')?(doc.lang==='en'?'Cash entry correction':'กลับรายการบันทึกเงิน'):t.refund,amount:money(Math.round(refund.amount*100))});
  const balance = kind === "stay" ? (doc.status === "cancelled" ? null : doc.due_cents) : doc.balance_cents;
  const settled = doc.paid_cents ?? doc.payments.reduce((sum,payment) => sum+payment.amount_cents,0);
  const paymentBlock = paymentRows.length ? `<section class="payments"><h2>${escape(doc.deposit ? t.depositReceived : t.items)}</h2>
    <div class="payrows">${paymentRows.map((row) => `<div class="payment"><span>${escape(row.left)}</span>
    <span>${escape(row.label)}</span><strong>${escape(row.amount)}</strong></div>`).join("")}</div></section>` : "";
  const signed = doc.consent && signatureImage(doc.consent.signature);
  const consent = kind === "stay" ? `<section><h2>${escape(t.consent)}</h2><p>${escape(signed
    ? [t.agreed,doc.consent.customer_name,stamp(doc.consent.signed_at)].join(" · ") : t.noConsent)}</p>${signed || ""}</section>` : "";
  const pass=doc.stay_pass||doc.pricing?.stay_pass;
  const totals = `<section class="facts amounts">${!doc.deposit ? cell(pass?(lang==='en'?'Cash-covered service total':'ค่าบริการส่วนที่ชำระเป็นเงิน'):t.total,balance === null && kind !== "stay" ? t.ratePending : money(doc.total_cents)) : ""}
    ${!doc.deposit && doc.discount_cents ? cell(t.discount,money(doc.discount_cents)) : ""}
    ${!doc.deposit && settled ? cell(t.paid,money(settled)) : ""}
    ${cell(doc.deposit ? t.balanceAtCheckin : t.due,balance === null ? "—" : money(balance))}</section>`;
  const pricing=doc.pricing;
  const priceTime=value=>Math.floor(value/60)+(lang==='en'?'h ':' ชม. ')+(value%60)+(lang==='en'?'m':' นาที');
  const priceRowClass='class="late-fee-row" style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #ddd"';
  const priceRows=pricing?.rows?.map(row=>{
    const dog=doc.dogs.find(dog=>dog.id===row.dog_id);
    return `<div ${priceRowClass}><span>${escape(dog?.name || '')}</span><span>${escape(money(row.base_cents))}</span><strong>${escape(money(row.fee_cents))}</strong></div>`;
  }).join('') || '';
  const extensionBlock=pricing?.extensions?.length ? `<section><h2>${lang==='en'?'Stay extension':'การต่อวันเข้าพัก'}</h2>${pricing.extensions.map(row=>`<p>${escape(day(row.before.checkout))} ${escape(row.before.time)} → ${escape(day(row.after.checkout))} ${escape(row.after.time)}<br>${lang==='en'?'Additional charge':'ค่าใช้จ่ายเพิ่ม'} ${escape(money(row.added_cents))}</p>`).join('')}</section>` : '';
  const priceBlock=pass || !pricing || pricing.service!=='overnight' || pricing.extensions?.length ? '' : pricing.grandfathered
    ? `<section><h2>${lang==='en'?'Agreed price retained':'ใช้ราคาที่ตกลงเดิม'}</h2><p>${lang==='en'?'Existing booking: no additional late check-out charge.':'รายการเดิม: ไม่คิดค่ารับกลับล่าช้าเพิ่ม'}</p></section>`
    : `<section class="boarding-price-breakdown"><h2>${lang==='en'?'Boarding and late check-out charges':'ค่าฝากเลี้ยงและค่ารับกลับล่าช้า'}</h2>
      <p>${lang==='en'?'Boarding':'ค่าฝากปกติ'} ${escape(pricing.base_days)} ${lang==='en'?'day(s), 24 hours per day':'วัน รอบละ 24 ชั่วโมง'} · ${escape(money(pricing.base_cents))}</p>
      <p>${lang==='en'?'Time beyond the booked period':'เวลาส่วนเกินจากจำนวนวันที่ระบุ'}: ${escape(priceTime(pricing.extra_minutes))}</p>
      <p>${lang==='en'?'Up to 2 hours free; over 2–6 hours +25%; over 6–12 hours +50%; over 12 hours +1 day.':'ผ่อนผันไม่เกิน 2 ชม. ฟรี · เกิน 2–6 ชม. +25% · เกิน 6–12 ชม. +50% · เกิน 12 ชม. เพิ่ม 1 วัน'}</p>
      <p><strong>${lang==='en'?'Applied late fee':'อัตราที่ใช้'}: ${pricing.percent===100?(lang==='en'?'1 extra day':'เพิ่ม 1 วัน'):pricing.percent+'%'} · ${escape(money(pricing.fee_cents))}</strong></p>
      <div ${priceRowClass}><strong>${lang==='en'?'Dog':'สุนัข'}</strong><strong>${lang==='en'?'Boarding':'ค่าฝากปกติ'}</strong><strong>${lang==='en'?'Late check-out':'รับกลับล่าช้า'}</strong></div>${priceRows}</section>`;
  const daycare=pass?.checkout_reconciliation?.daycare||pass?.daycare;
  const passBlock=pass?`<section class="stay-pass-breakdown" style="overflow-wrap:anywhere"><h2>Little Paws Stay Pass</h2>${daycare?`<p>${lang==='en'?'Day Care: up to 12 hours = 0.5 day; over 12 hours = 1 day. Duration: ':'Day Care: ไม่เกิน 12 ชั่วโมง = 0.5 วัน; เกิน 12 ชั่วโมง = 1 วัน · ระยะเวลา: '}${escape((daycare.elapsed_minutes/60).toLocaleString(lang==='en'?'en-GB':'th-TH',{maximumFractionDigits:2}))} ${lang==='en'?'hours':'ชั่วโมง'}</p>`:''}<p>${escape(pass.pass_number)} · ${lang==='en'?'Credits used':'ใช้โควตา'} ${escape(pass.credit_units/4)} ${lang==='en'?'days':'วัน'}</p>
    ${pass.cancellation_cash_fees_cents?`<p>${lang==='en'?'Cancellation fees carried from the booking':'ค่าบริการยกเลิกที่รวมมาจากการจอง'}: ${escape(money(pass.cancellation_cash_fees_cents))}</p>`:''}
    <p>${lang==='en'?'Late pickup allowance':'โควตารับกลับล่าช้า'}: ${escape(pass.settlement.late_units/4)} ${lang==='en'?'days':'วัน'} · ${lang==='en'?'Covered by Pass':'หัก Pass'} ${escape(pass.settlement.rows.reduce((n,r)=>n+(r.late_covered_units||0),0)/4)} ${lang==='en'?'days':'วัน'}${Number.isSafeInteger(pass.settlement.late_cash_cents)?' · '+(lang==='en'?'Late pickup cash: ':'รับกลับล่าช้าชำระเป็นเงิน: ')+escape(money(pass.settlement.late_cash_cents)):''}</p>
    <p>${lang==='en'?'Cash-covered portion':'ส่วนเกินที่ชำระเป็นเงิน'}: ${escape(pass.settlement.cash_units/4)} ${lang==='en'?'days':'วัน'} · ${escape(money(pass.settlement.cash_cents))}</p>
    ${pass.settlement.rows.map(row=>`<p>${escape(row.name)} · ${lang==='en'?'Pass':'โควตา'} ${escape(row.covered_units/4)} ${lang==='en'?'days':'วัน'} · ${lang==='en'?'Cash':'เงิน'} ${escape(money(row.cash_cents))}</p>`).join('')}</section>`:'';
  const reconciliation=pass?.checkout_reconciliation;
  const checkoutBlock=reconciliation?`<section class="stay-pass-checkout-summary"><h2>${lang==='en'?'Checkout credit update':'สรุปปรับสิทธิ์เมื่อรับกลับ'}</h2>
    <p>${lang==='en'?'Original pickup':'กำหนดรับกลับเดิม'}: ${escape(stamp(reconciliation.original_agreement.checkout_at))} · ${escape(reconciliation.original_agreement.quantity100/100)} ${daycare?(lang==='en'?'visit':'ครั้ง'):(lang==='en'?'days':'วัน')}</p>
    <p>${lang==='en'?'Actual pickup':'รับกลับจริง'}: ${escape(stamp(reconciliation.actual_checkout_at))}</p>
    <p>${lang==='en'?'Credits restored':'คืนโควตา'} ${escape(reconciliation.restored_units/4)} ${lang==='en'?'days':'วัน'} · ${lang==='en'?'Extra credits used':'ใช้โควตาเพิ่ม'} ${escape(reconciliation.extra_covered_units/4)} ${lang==='en'?'days':'วัน'}</p>
    ${reconciliation.refund_review_cents?`<p>${lang==='en'?'Overpayment at checkout':'เงินรับเกิน ณ วันรับกลับ'} ${escape(money(reconciliation.refund_review_cents))} · ${lang==='en'?'Refund handled separately; this document does not confirm a refund.':'ดำเนินการคืนเงินแยกต่างหาก เอกสารนี้ไม่ใช่หลักฐานว่าได้คืนเงินแล้ว'}</p>`:''}
    </section>`:'';
  const dogRows = doc.dogs.map((dog) => `<li>${picture(dog.image,dog.name,"dog-photo") || dogIcon}
    <div><strong>${escape(dog.name)}</strong><small>${escape(pass ? (lang==='en'?'Regular reference: ':'ราคาอ้างอิง: ')+money(dog.nightly_rate_cents) : dog.nightly_rate_cents === null ? t.ratePending
      : money(dog.nightly_rate_cents)+" / "+rateUnit)}</small></div></li>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(t[kind])} · Little Paws</title><style>
    ${doc.font ? `@font-face{font-family:LittlePawsFont;src:url('${doc.font}') format('woff2');font-display:block}` : ""}
    :root{--accent:${accent};--tint:${tint}}
    *{box-sizing:border-box}html{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#f2f5f2;color:#20332b;font:15px/1.45 LittlePawsFont,"Sukhumvit Set","Noto Sans Thai",Garuda,system-ui,sans-serif}
    main{max-width:780px;margin:auto;padding:26px}header,section,footer{break-inside:avoid}
    header{background:var(--accent);border-radius:20px;color:#fff;padding:21px 23px;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    header h1{margin:12px 0 2px;font-size:29px;line-height:1.2}header p{margin:0}
    .brand{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700}.logo{width:48px;height:44px;object-fit:contain}
    .address{text-align:right;font-size:11px;color:#fff;max-width:46%}.mascot{display:block;width:92px;margin:4px 0 6px auto}
    .status{color:#fff;background:#ffffff24;border-radius:99px;display:inline-block;margin-top:7px;padding:2px 9px;font-size:12px}
    section{background:#fff;border:1px solid #d9e4df;border-radius:14px;padding:13px 16px;margin-top:12px}
    h2,h3,p{margin:0 0 6px}h2{font-size:16px;color:var(--accent)}h3{font-size:13px}
    .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fact{background:var(--tint);padding:8px 10px;border-radius:9px}
    .fact strong,.fact small,.dog-list small{display:block;overflow-wrap:anywhere}.fact small,.dog-list small{font-size:11px;color:#52665c}
    .facts.agenda .fact strong{font-size:17px}.amounts .fact strong{font-size:14px}
    .dog-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;list-style:none;margin:0;padding:0}
    .dog-list li{display:flex;align-items:center;gap:9px;background:var(--tint);border-radius:10px;min-width:0;padding:7px}
    .dog-list strong{overflow-wrap:anywhere}.dog-photo,.dog-icon{width:49px;height:49px;border-radius:10px;object-fit:cover;flex:none}
    .dog-icon{display:flex;align-items:center;justify-content:center;background:#f5e6d3}.dog-icon svg{width:37px;height:37px}
    .payment{display:grid;grid-template-columns:1.25fr 1fr auto;gap:8px;border-bottom:1px solid #e9f0ed;padding:5px 0;font-size:12px;break-inside:avoid}
    .payment strong{text-align:right}.payrows{display:grid}.signature{display:block;width:260px;max-height:100px;border:1px solid #dae8e0;border-radius:8px}
    .terms{break-inside:auto}.terms h3{break-after:avoid}.terms ul{margin:0 0 8px;padding-inline-start:20px;font-size:11px}
    .payment-qr{width:190px;max-width:100%;display:block;margin:auto}.memo{white-space:pre-wrap;overflow-wrap:anywhere}
    footer{text-align:center;font-size:11px;margin-top:16px;color:var(--accent)}footer strong{display:block;font-size:13px}
    @page{size:A4;margin:11mm}@media print{body{background:#fff}main{padding:0}section.payments{break-inside:auto}}
    @media(max-width:470px){main{padding:12px}header{padding:13px}.address{font-size:9px}header h1{font-size:23px}}
    ${format === "png" ? customerImageCss : ""}</style></head><body><main><header><div><div class="brand">${picture(doc.logo,"Little Paws","logo")}Little Paws Homestay Phuket</div>
    <h1>${escape(t[kind])}</h1>${state ? `<p class="status">${escape(state)}</p>` : ""}</div><div class="address">
    ${picture(doc.mascot,"","mascot")}<p>${escape(t.address1)}<br>${escape(t.address2)}<br>${escape(t.phone)}</p></div></header>
    <section class="facts agenda">${linked}${cell(t.checkin,day(doc.checkin)+(pricing?.checkin_time ? " · "+pricing.checkin_time : ""))}${cell(t.checkout,day(doc.checkout)+(pricing?.checkout_time ? " · "+pricing.checkout_time : ""))}
    ${cell(t.service,t[doc.service_type] || doc.service_type)}${cell(lang === "th" && doc.service_type === "monthly" ? "จำนวนเดือน" : t.duration,doc.charged_nights+" "+unit)}
    ${doc.actual_checkin_at ? cell(t.actualIn,stamp(doc.actual_checkin_at)) : ""}${doc.actual_checkout_at ? cell(t.actualOut,stamp(doc.actual_checkout_at)) : ""}
    ${cell(t.customer,doc.customer)}${doc.contact ? cell(t.contact,doc.contact) : ""}</section>
    <section><h2>${escape(t.dogs)}</h2><ul class="dog-list">${dogRows}</ul></section>
    ${doc.note ? `<section><h2>${escape(t.note)}</h2><p class="memo">${escape(doc.note)}</p></section>` : ""}
    ${passBlock}${checkoutBlock}${priceBlock}${extensionBlock}${totals}${paymentBlock}${kind === "stay" ? intakeSection(doc.intake,t,lang) : ""}
    ${consent}${format === "pdf" ? termsSection(doc.terms) : ""}
    ${doc.qr ? `<section><h2>${escape(t.qr)}</h2>${picture(doc.qr,t.qr,"payment-qr")}</section>` : ""}
    <footer><strong>Little Paws, Big Love.</strong>${escape(t.slogan)}</footer></main></body></html>`;
}
