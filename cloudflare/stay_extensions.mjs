import {overnightPricing,savedBoardingPrice} from './boarding_pricing.mjs';
import {authorizedStaff,normalizePayment} from './stay_payments.mjs';
import {stayPaymentSnapshot} from './stay_edits.mjs';
import {bookingWarnings,bookingSnapshot} from './booking_warnings.mjs';

const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const moment=(day,time)=>Date.parse(day+'T'+time+':00+07:00');
async function fingerprint(value){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');}

// Preserve the agreed original total and discounts. Only the increase in the
// existing boarding calculator is added; do not reprice past service.
export function extensionPrice(stay,price,dogs,input){
 if(price?.stay_pass)return {status:'pass_review_required'};
 if(stay.service_type!=='overnight')return {status:'service_review_required'};
 const startTime=price?.checkin_time||stay.intake?.arrival_time;
 const endTime=price?.checkout_time||stay.intake?.pickup_time;
 if(!validTime(startTime)||!validTime(endTime))return {status:'missing_original_time'};
 if(!validDay(input.checkout)||!validTime(input.checkoutTime))return {status:'invalid'};
 const oldEnd=moment(stay.checkout,endTime),end=moment(input.checkout,input.checkoutTime),start=moment(stay.checkin,startTime);
 if(end<=oldEnd||end<=start||end-start>366*86400000)return {status:'invalid'};
 if(!dogs.length||dogs.some(d=>!Number.isSafeInteger(d.nightly_rate_cents)||d.nightly_rate_cents<0))return {status:'missing_rate'};
 const oldQuantity=Math.round(stay.charged_nights*100);
 if(!Number.isSafeInteger(oldQuantity)||oldQuantity<0||!Number.isSafeInteger(stay.total_cents)||stay.total_cents<0)return {status:'invalid'};
 const quantity100=Math.max(oldQuantity,Math.floor((end-start)/86400000)*100);
 const base={pricingVersion:1,checkin:stay.checkin,checkinTime:startTime,service:'overnight',dogs:dogs.map(d=>({id:d.id,rate:d.nightly_rate_cents}))};
 const before=overnightPricing({...base,checkout:stay.checkout,checkoutTime:endTime,quantity100:oldQuantity});
 const after=overnightPricing({...base,checkout:input.checkout,checkoutTime:input.checkoutTime,quantity100});
 if(!before||!after)return {status:'invalid'};
 const increase=after.base_cents+after.fee_cents-before.base_cents-before.fee_cents;
 if(!Number.isSafeInteger(increase)||increase<0)return {status:'price_review_required'};
 const addedCents=increase-increase%100,totalCents=stay.total_cents+addedCents;
 if(!Number.isSafeInteger(totalCents)||totalCents>99_999_999_900)return {status:'invalid'};
 return {status:'ready',old_checkout:stay.checkout,old_checkout_time:endTime,checkout:input.checkout,checkout_time:input.checkoutTime,
  old_total_cents:stay.total_cents,added_cents:addedCents,total_cents:totalCents,quantity100,pricing:after,
  rows:after.rows.map((r,i)=>({dog_id:r.dog_id,rate_cents:r.rate_cents,added_cents:r.base_cents+r.fee_cents-before.rows[i].base_cents-before.rows[i].fee_cents})),
  late_delta_cents:after.fee_cents-before.fee_cents};
}

async function load(db,id,actor){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')return null;
 const stay=await db.prepare(`SELECT s.*,(SELECT details FROM boarding_charges WHERE stay_id=s.id) AS price_snapshot,ROUND(s.agreed_total*100) AS total_cents,(${stayPaymentSnapshot}) AS payment_snapshot,
  COALESCE((SELECT SUM(ROUND(amount*100)) FROM transactions WHERE stay_id=s.id AND payment_type!=''),0) AS paid_cents
  FROM stays s WHERE s.id=? AND ${authorizedStaff}`).bind(id,actor.id,actor.email).first();
 if(!stay)return null;
 try{stay.intake=JSON.parse(stay.intake)||{};}catch{stay.intake={};}
 stay.service_type=stay.intake.service_type||'overnight';
 const {results:dogs}=await db.prepare('SELECT dog_id AS id,nightly_rate_cents FROM stay_dogs WHERE stay_id=? ORDER BY dog_id').bind(id).all();
 return {stay,dogs,price:await savedBoardingPrice(db,'stay',id)};
}
export async function quoteStayExtension(db,id,input,actor){
 const source=await load(db,id,actor);if(!source)return {status:'not_found'};
 const {stay,dogs,price}=source;
 if(stay.status!=='checked_in'||stay.cancelled_at)return {status:'stay_closed'};
 if(stay.payment_tracking!==1)return {status:'payment_review_required'};
 const quote=extensionPrice(stay,price,dogs,input);if(quote.status!=='ready')return quote;
 const warnings=await bookingWarnings(db,null,stay.checkin,input.checkout,dogs.map(d=>d.id),id);
 const state={id,revision:stay.cloud_revision,paymentSnapshot:stay.payment_snapshot,price,dogs,checkout:input.checkout,checkoutTime:input.checkoutTime,capacity:warnings.snapshot};
 return {...quote,paid_cents:stay.paid_cents,due_cents:Math.max(0,quote.total_cents-stay.paid_cents),warnings:warnings.warnings,
  quote_hash:await fingerprint(state),revision:stay.cloud_revision};
}
export async function extendStay(db,id,input,actor){
 if(typeof input.key!=='string'||!/^[a-f0-9]{32}$/.test(input.key)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)return {status:'invalid'};
 const source=await load(db,id,actor);if(!source)return {status:'not_found'};
 const request={checkout:input.checkout,checkoutTime:input.checkoutTime,reason:input.reason.trim(),payment:input.payment||null};
 const requestHash=await fingerprint(request),history=source.price?.extensions||[];
 const previous=history.find(row=>row.key===input.key);
 if(previous)return previous.actor_id===actor.id&&previous.request_hash===requestHash ? {status:'saved',id,duplicate:true} : {status:'conflict'};
 const quote=await quoteStayExtension(db,id,input,actor);
 if(quote.status!=='ready')return quote;
 if(quote.quote_hash!==input.quoteHash)return {status:'conflict'};
 // Capacity overrides for extensions are deliberately not implicit.
 if(quote.warnings.length)return {status:'capacity_review_required',warnings:quote.warnings};
 const payment=input.payment ? normalizePayment({...input.payment,key:input.key}) : null;
 if(input.payment&&!payment)return {status:'invalid'};
 if(payment&&payment.amountCents>quote.due_cents)return {status:'payment_exceeds'};
 const {stay,dogs,price}=source;
 const warnings=await bookingWarnings(db,null,stay.checkin,input.checkout,dogs.map(d=>d.id),id);
 // A second read is not allowed to quietly authorize a newer state.
 const current=await quoteStayExtension(db,id,input,actor);if(current.quote_hash!==quote.quote_hash)return {status:'conflict'};
 const revision=crypto.randomUUID(),entry={key:input.key,request_hash:requestHash,actor_id:actor.id,created_at:new Date().toISOString(),reason:request.reason,
  before:{checkout:stay.checkout,time:quote.old_checkout_time,total_cents:stay.total_cents,quantity:stay.charged_nights,pricing:price?{...price,extensions:undefined}:null},
  after:{checkout:quote.checkout,time:quote.checkout_time,total_cents:quote.total_cents,quantity:quote.quantity100/100},added_cents:quote.added_cents,payment_cents:payment?.amountCents||0};
 const savedPrice={...quote.pricing,extensions:[...history,entry]};
 const marker='EXISTS(SELECT 1 FROM stays WHERE id=? AND cloud_revision=?)';
 const statements=[db.prepare(`UPDATE stays AS s SET checkout=?,charged_nights=?,agreed_total=?,intake=?,cloud_revision=?
  WHERE s.id=? AND s.cloud_revision IS ? AND s.status='checked_in' AND s.cancelled_at IS NULL AND s.payment_tracking=1
   AND ROUND(s.agreed_total*100)=? AND s.checkout=? AND (${stayPaymentSnapshot})=? AND ${authorizedStaff}
   AND (SELECT json_group_array(json_array(dog_id,nightly_rate_cents)) FROM (SELECT dog_id,nightly_rate_cents FROM stay_dogs WHERE stay_id=s.id ORDER BY dog_id))=?
   AND (SELECT details FROM boarding_charges WHERE stay_id=s.id) IS ? AND (${bookingSnapshot})=?`)
  .bind(quote.checkout,quote.quantity100/100,quote.total_cents/100,JSON.stringify({...stay.intake,pickup_time:quote.checkout_time}),revision,
   id,stay.cloud_revision,stay.total_cents,stay.checkout,stay.payment_snapshot,actor.id,actor.email,JSON.stringify(dogs.map(d=>[d.id,d.nightly_rate_cents])),stay.price_snapshot??null,...warnings.params,warnings.snapshot),
  db.prepare(`INSERT INTO boarding_charges(stay_id,details) SELECT ?,? WHERE ${marker} ON CONFLICT(stay_id) DO UPDATE SET details=excluded.details`)
   .bind(id,JSON.stringify(savedPrice),id,revision)];
 if(payment)statements.push(db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,payment_type,payment_key,received_time)
  SELECT ?,'income','ค่าฝากเลี้ยง','ชำระเพิ่มเติม · ต่อวันเข้าพัก',?/100.0,s.customer_id,s.id,'','additional',?,? FROM stays s WHERE s.id=? AND s.cloud_revision=?`)
  .bind(payment.paymentDate,payment.amountCents,input.key,payment.paidAt,id,revision));
 const [result]=await db.batch(statements);
 return result.meta.changes===1 ? {status:'saved',id,added_cents:quote.added_cents,total_cents:quote.total_cents,due_cents:quote.due_cents-(payment?.amountCents||0)} : {status:'conflict'};
}
