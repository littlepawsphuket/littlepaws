import {savedBoardingPrice,saveStayPrice,freezeLegacyPrice} from "./boarding_pricing.mjs";
import {quoteCoupon, unchangedCoupon, couponCondition, saveCouponUse} from "./coupons.mjs";
import terms, {intakeGroups} from "./stay_terms.mjs";
import {authorizedStaff, normalizePayment} from "./stay_payments.mjs";
import {bookingValues, allDogsOwned} from "./booking_writes.mjs";
import {bookingSnapshot, bookingWarnings} from "./booking_warnings.mjs";
import {validDay, randomReference} from "./bookings.mjs";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function hasSignature(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 150) return false;
  let count = 0;
  let line = false;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length || (count += stroke.length) > 4000) return false;
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2 ||
          !point.every(Number.isInteger) || point[0] < 0 || point[0] > 720 || point[1] < 0 || point[1] > 240) return false;
      const [x,y] = stroke[0];
      if ((x-point[0])**2 + (y-point[1])**2 >= 64) line = true;
    }
  }
  return line;
}

export function normalizeIntake(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const intake = {};
  for (const group of intakeGroups) {
    for (const [field,,kind] of group.fields) {
      const entry = value[field];
      if (entry !== undefined && (typeof entry !== "string" || entry.length > 600)) return null;
      if (kind === "item") {
        const packed = value[field + "_packed"];
        if (packed !== undefined && packed !== "1") return null;
        if (!packed) continue;
        intake[field + "_packed"] = "1";
      }
      const text = entry?.trim();
      if (!text) continue;
      if (kind === "exam" && !["normal","abnormal"].includes(text)) return null;
      if (typeof kind === "object" && !Object.hasOwn(kind,text)) return null;
      intake[field] = text;
    }
  }
  return intake;
}

export function checkInTerms(language) {
  const lang = language === "en" ? "en" : "th";
  return {language:lang, terms:terms[lang], version:terms.versions[lang]};
}

export function checkInValues(form, now = new Date()) {
  const signedAt = new Date(now.valueOf()+7*3600000).toISOString().replace("Z","+07:00");
  const {language,version,signature,accepted,revision,arrivalDay,arrivalTime,pickupTime,
    amountCents,expectedBalance,paymentDate,receivedTime,key} = form;
  if (accepted !== true || (language !== "th" && language !== "en") ||
      version !== terms.versions[language] || !hasSignature(signature)) return {status:"consent_required"};
  if (!validDay(arrivalDay) || arrivalDay > signedAt.slice(0,10) || typeof arrivalTime !== "string" ||
      !timePattern.test(arrivalTime) || typeof pickupTime !== "string" || (pickupTime && !timePattern.test(pickupTime)) ||
      !Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(expectedBalance) ||
      expectedBalance < amountCents || (revision !== null && (typeof revision !== "string" || revision.length > 36))) {
    return {status:"invalid"};
  }
  const payment = normalizePayment({amountCents:Math.max(1,amountCents),paymentDate,receivedTime,key},now);
  const intake = normalizeIntake(form.intake);
  if (!payment || !intake) return {status:"invalid"};

  const arrival = `${arrivalDay}T${arrivalTime}:00+07:00`;
  return {arrival,arrivalDay,arrivalTime,pickupTime,amountCents,expectedBalance,paymentDate,revision,
    paidAt:payment.paidAt,signedAt,language,signature,intake};
}

export function consentInsert(db, marker, checkIn) {
  return db.prepare(`INSERT INTO stay_consents(stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en)
    SELECT s.id,s.customer_id,c.name,?,?,?,?,? FROM stays s JOIN customers c ON c.id=s.customer_id
    WHERE s.create_key=?`).bind(checkIn.signedAt,JSON.stringify(terms.th),JSON.stringify(checkIn.signature),
    checkIn.language,JSON.stringify(terms.en),marker);
}

export function paymentInsert(db, marker, checkIn) {
  return db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,
    payment_method,payment_type,payment_key,received_time)
    SELECT ?,'income','ค่าฝากเลี้ยง','ชำระวันเข้าพัก',?/100.0,s.customer_id,s.id,'','checkin',?,?
    FROM stays s WHERE s.create_key=? AND ?>0`)
    .bind(checkIn.paymentDate,checkIn.amountCents,marker,checkIn.paidAt,marker,checkIn.amountCents);
}

async function bookedCouponSource(db, id, actor) {
  return db.prepare(`SELECT a.stay_id,a.discount_cents,ROUND(a.agreed_total*100) AS total,
    COALESCE((SELECT SUM(ROUND(t.amount*100)) FROM transactions t
      WHERE t.deposit_appointment_id=a.id AND t.payment_type!=''),0) AS paid,
    (SELECT SUM(CAST((d.nightly_rate_cents * ROUND(a.charged_nights*100)+50)/100 AS INTEGER))
      FROM appointment_dogs d WHERE d.appointment_id=a.id) AS subtotal
    FROM appointments a WHERE a.id=? AND a.status='pending' AND ${authorizedStaff}
      AND NOT EXISTS (SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id AND d.nightly_rate_cents IS NULL)
    `).bind(id,actor.id,actor.email).first();
}

async function pricedBooking(db,id,form,actor) {
  const source=await db.prepare(`SELECT a.*,ROUND(a.agreed_total*100) AS total,
    COALESCE((SELECT SUM(ROUND(t.amount*100)) FROM transactions t WHERE t.deposit_appointment_id=a.id AND t.payment_type!=''),0) AS paid
    FROM appointments a WHERE a.id=? AND a.status='pending' AND ${authorizedStaff}`).bind(id,actor.id,actor.email).first();
  if(!source)return null;
  if(source.stay_id)return {source};
  const dogs=(await db.prepare(`SELECT dog_id AS id,nightly_rate_cents AS rate FROM appointment_dogs WHERE appointment_id=? ORDER BY dog_id`).bind(id).all()).results;
  const draft={customerId:source.customer_id,checkin:form.arrivalDay,checkout:form.pickupDay || source.checkout,
    checkinTime:form.arrivalTime,checkoutTime:form.pickupTime,quantity100:form.quantity100,
    pricingVersion:1,service:source.service_type,discountCents:source.discount_cents,note:source.note,dogs,wholeBaht:true};
  const previous=await savedBoardingPrice(db,"booking",id);
  const data=bookingValues(draft,(!previous || previous.grandfathered) ? source : null);
  return data && !data.quotePending ? {source,draft,data} : null;
}
export async function previewBookedPrice(db,form,actor) {
  if(!Number.isSafeInteger(form.bookingId) || form.bookingId<1 || form.pricingVersion!==1)return {status:'invalid'};
  const price=await pricedBooking(db,form.bookingId,form,actor);
  if(!price || price.source.stay_id)return {status:'not_found'};
  if(price.source.cloud_revision!==form.revision)return {status:'conflict'};
  if(price.data.netCents<price.source.paid)return {status:'payment_exceeds'};
  return {status:'ready',total_cents:price.data.netCents,balance_cents:price.data.netCents-price.source.paid,
    pricing:price.data.pricing,discount_cents:price.source.discount_cents};
}

export async function previewCheckInCoupon(db, form, actor) {
  let quote;
  if (form.draft && typeof form.draft === "object" && form.bookingId === undefined) {
    const ready = await previewDirectStay(db,form.draft,actor);
    if (ready.status !== "ready") return {status:"invalid"};
    const data = bookingValues(form.draft);
    quote = await quoteCoupon(db,form.code,data.subtotal,form.draft.discountCents,0);
  } else if (Number.isSafeInteger(form.bookingId) && form.bookingId > 0) {
    const priced=form.pricingVersion===1 ? await pricedBooking(db,form.bookingId,form,actor) : null;
    if(form.pricingVersion===1 && !priced)return {status:"invalid"};
    const source = priced ? {...priced.source,subtotal:priced.data.subtotal} : await bookedCouponSource(db,form.bookingId,actor);
    if (!source || source.stay_id || source.subtotal === null) return {status:"not_found"};
    quote = await quoteCoupon(db,form.code,source.subtotal,source.discount_cents,source.paid);
  } else return {status:"invalid"};
  if (quote.status) return quote;
  return {status:"ready",discount_cents:quote.discount,total_cents:quote.total,balance_cents:quote.balance};
}

export async function checkInBooking(db, id, form, actor) {
  const checkIn = checkInValues(form);
  if (checkIn.status) return checkIn;
  const {arrival,arrivalDay,arrivalTime,pickupTime,expectedBalance,revision,intake} = checkIn;
  const identity = [actor.id,actor.email];
  const marker = crypto.randomUUID();
  let quote;
  let adjustment = 0;
  const priced=form.pricingVersion===1 ? await pricedBooking(db,id,form,actor) : null;
  if(form.pricingVersion===1 && !priced)return {status:"invalid"};
  if(priced?.source.stay_id)return {status:"saved",stayId:priced.source.stay_id};
  if(!priced && await savedBoardingPrice(db,"booking",id))return {status:"conflict"};
  if(priced){
    if(priced.source.cloud_revision!==revision)return {status:"conflict"};
    if(priced.data.netCents<priced.source.paid)return {status:"payment_exceeds"};
    adjustment=priced.source.total-priced.data.netCents;
    if(!form.couponCode && expectedBalance!==priced.data.netCents-priced.source.paid)return {status:"conflict"};
  }
  if (form.couponCode) {
    const source = priced ? {...priced.source,subtotal:priced.data.subtotal} : await bookedCouponSource(db,id,actor);
    if (source?.stay_id) return {status:"saved",stayId:source.stay_id};
    if (!source || source.subtotal === null) return {status:"not_found"};
    quote = await quoteCoupon(db,form.couponCode,source.subtotal,source.discount_cents,source.paid);
    if (quote.status) {
      const latest = await bookedCouponSource(db,id,actor);
      return latest?.stay_id ? {status:"saved",stayId:latest.stay_id} : quote;
    }
    if (expectedBalance !== quote.balance) return {status:"conflict"};
    adjustment = source.total - quote.total;
  }
  for (let attempt=0; attempt<5; attempt++) {
    const code = randomReference();
    const writes = await db.batch([
      db.prepare(`INSERT INTO stays(customer_id,checkin,checkout,charged_nights,agreed_total,status,note,
        discount_cents,rounding_cents,actual_checkin_at,intake,payment_tracking,create_key,stay_number)
        SELECT a.customer_id,COALESCE(?,a.checkin),COALESCE(?,a.checkout),COALESCE(?,a.charged_nights),(ROUND(a.agreed_total*100)-?)/100.0,'checked_in',a.note,
          a.discount_cents+?,COALESCE(?,a.rounding_cents),?,json_patch(?,json_object('service_type',a.service_type,'arrival_time',?,
          'pickup_time',?)),1,?,?
        FROM appointments a WHERE a.id=? AND a.stay_id IS NULL AND a.status='pending'
          AND a.cloud_revision IS ? AND ?<=COALESCE(?,a.checkout) AND ${authorizedStaff}
          AND EXISTS (SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id)
          AND NOT EXISTS (SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id AND d.nightly_rate_cents IS NULL)
          AND ROUND(a.agreed_total*100)-COALESCE((SELECT SUM(ROUND(t.amount*100)) FROM transactions t
            WHERE t.deposit_appointment_id=a.id AND t.payment_type!=''),0)=?
          AND ${unchangedCoupon}
          AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.booking_number=?)
        ON CONFLICT DO NOTHING`)
        .bind(priced?.draft.checkin ?? null,priced?.draft.checkout ?? null,priced ? priced.draft.quantity100/100 : null,
          adjustment,quote?.discount ?? 0,quote?.rounding ?? priced?.data.fields[7] ?? null,arrival,JSON.stringify(intake),arrivalTime,pickupTime,
          marker,code,id,revision,arrivalDay,priced?.draft.checkout ?? null,...identity,priced ? priced.source.total-priced.source.paid : expectedBalance+adjustment,...couponCondition(quote?.coupon),code),
      db.prepare(`INSERT INTO stay_dogs(stay_id,dog_id,nightly_rate_cents)
        SELECT s.id,d.dog_id,d.nightly_rate_cents FROM stays s CROSS JOIN appointment_dogs d
        WHERE s.create_key=? AND d.appointment_id=?`).bind(marker,id),
      consentInsert(db,marker,checkIn),
      db.prepare(`UPDATE transactions SET stay_id=(SELECT id FROM stays WHERE create_key=?)
        WHERE deposit_appointment_id=? AND EXISTS (SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,id,marker),
      paymentInsert(db,marker,checkIn),
      saveCouponUse(db,marker,quote,checkIn.signedAt),
      db.prepare(`UPDATE appointments AS a SET stay_id=(SELECT id FROM stays WHERE create_key=?)
        WHERE a.id=? AND EXISTS (SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,id,marker),
      ...(priced ? [saveStayPrice(db,marker,priced.data.pricing)] : []),
      db.prepare("SELECT id AS stay_id FROM stays WHERE create_key=?").bind(marker),
    ]);
    const write=writes[0],lookup=writes.at(-1);
    if (write.meta.changes === 1) return {status:"created",stayId:lookup.results[0].stay_id};
    const existing = await db.prepare(`SELECT a.stay_id,a.status,a.cloud_revision,a.checkout,
      a.agreed_total,(SELECT COALESCE(SUM(ROUND(t.amount*100)),0) FROM transactions t
        WHERE t.deposit_appointment_id=a.id AND t.payment_type!='') AS paid,
      EXISTS(SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id) AND NOT EXISTS(
        SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id AND d.nightly_rate_cents IS NULL) AS priced
      FROM appointments a WHERE a.id=? AND ${authorizedStaff}`).bind(id,...identity).first();
    if (!existing) return {status:"not_found"};
    if (existing.stay_id) return {status:"saved",stayId:existing.stay_id};
    if (!existing.priced || existing.status !== "pending" || existing.cloud_revision !== revision ||
        arrivalDay > existing.checkout || Math.round(existing.agreed_total*100)-existing.paid-adjustment !== expectedBalance) {
      return {status:"conflict"};
    }
  }
  return {status:quote ? "coupon_unavailable" : "conflict"};
}

const activeOwner = "EXISTS (SELECT 1 FROM customers c WHERE c.id=? AND c.archived=0)";

export async function previewDirectStay(db, draft, actor) {
  if(draft?.bookingId!==undefined)return previewBookedPrice(db,draft,actor);
  const booking = bookingValues(draft);
  if (!booking || booking.quotePending) return {status:"invalid"};
  const customer = await db.prepare(`SELECT c.name FROM customers c WHERE c.id=? AND c.archived=0
    AND ${allDogsOwned} AND ${authorizedStaff}`).bind(draft.customerId,JSON.stringify(booking.dogIds),
    draft.customerId,null,booking.dogIds.length,actor.id,actor.email).first();
  if (!customer) return {status:"invalid"};
  return {status:"ready",customer:customer.name,total_cents:booking.netCents,balance_cents:booking.netCents,pricing:booking.pricing};
}

export async function checkInDirect(db, form, actor) {
  const checkIn = checkInValues(form);
  if (checkIn.status) return checkIn;
  const draft = form.draft && form.pricingVersion===1 ? {...form.draft,checkin:form.arrivalDay,checkout:form.pickupDay || form.draft.checkout,checkinTime:form.arrivalTime,checkoutTime:form.pickupTime,quantity100:form.quantity100,pricingVersion:1} : form.draft;
  if (!draft || typeof draft !== "object") return {status:"invalid"};
  const booking = bookingValues(draft);
  if (!booking || booking.quotePending ||
      checkIn.arrivalDay > draft.checkout) return {status:"invalid"};
  const [owner,checkin,checkout,quantity,total,note,discount,rounding,service] = booking.fields;
  const identity = [actor.id,actor.email];
  const submission = actor.id + ":" + form.key;
  const marker = crypto.randomUUID();
  const intake = JSON.stringify({...checkIn.intake,service_type:service,arrival_time:checkIn.arrivalTime,pickup_time:checkIn.pickupTime});
  async function replay() {
    const previous = await db.prepare(`SELECT id FROM stays WHERE direct_checkin_key=? AND ${authorizedStaff}`)
      .bind(submission,...identity).first();
    return previous ? {status:"saved",stayId:previous.id} : null;
  }
  for (let attempt=0; attempt<5; attempt++) {
    const previous = await replay();
    if (previous) return previous;
    const quote = form.couponCode ? await quoteCoupon(db,form.couponCode,booking.subtotal,discount,0) : null;
    if (quote?.status) return await replay() || quote;
    if (checkIn.expectedBalance !== (quote?.balance ?? booking.netCents)) return {status:quote ? "conflict" : "invalid"};
    const warnings = await bookingWarnings(db,null,checkIn.arrivalDay,checkout,booking.dogIds);
    if (warnings.token && warnings.token !== form.warningToken) {
      return await replay() || {status:"warning",warnings:warnings.warnings,token:warnings.token};
    }
    const code = randomReference();
    const writes = await db.batch([
      db.prepare(`INSERT INTO stays(customer_id,checkin,checkout,charged_nights,agreed_total,status,note,
          discount_cents,rounding_cents,actual_checkin_at,intake,payment_tracking,create_key,stay_number,direct_checkin_key)
        SELECT ?,?,?,?,?,'checked_in',?,?,?,?,?,1,?,?,?
        WHERE ${activeOwner} AND ${allDogsOwned} AND ${authorizedStaff}
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.booking_number=?)
          AND ${unchangedCoupon} AND (${bookingSnapshot})=?
        ON CONFLICT DO NOTHING`).bind(owner,checkin,checkout,quantity,quote ? quote.total/100 : total,note,discount+(quote?.discount ?? 0),
        quote?.rounding ?? rounding,checkIn.arrival,intake,
        marker,code,submission,owner,JSON.stringify(booking.dogIds),owner,null,booking.dogIds.length,...identity,
        code,...couponCondition(quote?.coupon),...warnings.params,warnings.snapshot),
      db.prepare(`INSERT INTO stay_dogs(stay_id,dog_id,nightly_rate_cents)
        SELECT s.id,json_extract(d.value,'$.id'),json_extract(d.value,'$.rate')
        FROM stays s CROSS JOIN json_each(?) d WHERE s.create_key=?`).bind(booking.dogRows,marker),
      consentInsert(db,marker,checkIn),
      paymentInsert(db,marker,checkIn),
      saveCouponUse(db,marker,quote,checkIn.signedAt),
      ...(booking.pricing ? [saveStayPrice(db,marker,booking.pricing)] : []),
      db.prepare("SELECT id FROM stays WHERE create_key=?").bind(marker),
    ]);
    const write=writes[0],result=writes.at(-1);
    if (write.meta.changes === 1) return {status:"created",stayId:result.results[0].id};
  }
  return await replay() || {status:"conflict"};
}
