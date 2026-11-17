import terms, {intakeGroups} from "./stay_terms.mjs";
import {authorizedStaff, normalizePayment} from "./stay_payments.mjs";
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

function normalizeIntake(value) {
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

export async function checkInBooking(db, id, form, actor) {
  const now = new Date();
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

  const identity = [actor.id,actor.email];
  const arrival = `${arrivalDay}T${arrivalTime}:00+07:00`;
  const marker = crypto.randomUUID();
  for (let attempt=0; attempt<5; attempt++) {
    const code = randomReference();
    const [write,,,,,,lookup] = await db.batch([
      db.prepare(`INSERT INTO stays(customer_id,checkin,checkout,charged_nights,agreed_total,status,note,
        discount_cents,rounding_cents,actual_checkin_at,intake,payment_tracking,create_key,stay_number)
        SELECT a.customer_id,a.checkin,a.checkout,a.charged_nights,a.agreed_total,'checked_in',a.note,
          a.discount_cents,a.rounding_cents,?,json_patch(?,json_object('service_type',a.service_type,'arrival_time',?,
          'pickup_time',?)),1,?,?
        FROM appointments a WHERE a.id=? AND a.stay_id IS NULL AND a.status='pending'
          AND a.cloud_revision IS ? AND ?<=a.checkout AND ${authorizedStaff}
          AND EXISTS (SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id)
          AND NOT EXISTS (SELECT 1 FROM appointment_dogs d WHERE d.appointment_id=a.id AND d.nightly_rate_cents IS NULL)
          AND ROUND(a.agreed_total*100)-COALESCE((SELECT SUM(ROUND(t.amount*100)) FROM transactions t
            WHERE t.deposit_appointment_id=a.id AND t.payment_type!=''),0)=?
          AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.booking_number=?)
        ON CONFLICT DO NOTHING`)
        .bind(arrival,JSON.stringify(intake),arrivalTime,pickupTime,marker,code,id,revision,arrivalDay,...identity,expectedBalance,code),
      db.prepare(`INSERT INTO stay_dogs(stay_id,dog_id,nightly_rate_cents)
        SELECT s.id,d.dog_id,d.nightly_rate_cents FROM stays s CROSS JOIN appointment_dogs d
        WHERE s.create_key=? AND d.appointment_id=?`).bind(marker,id),
      db.prepare(`INSERT INTO stay_consents(stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en)
        SELECT s.id,s.customer_id,c.name,?,?,?,?,? FROM stays s JOIN customers c ON c.id=s.customer_id
        WHERE s.create_key=?`)
        .bind(signedAt,JSON.stringify(terms.th),JSON.stringify(signature),language,JSON.stringify(terms.en),marker),
      db.prepare(`UPDATE transactions SET stay_id=(SELECT id FROM stays WHERE create_key=?)
        WHERE deposit_appointment_id=? AND EXISTS (SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,id,marker),
      db.prepare(`INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,
        payment_method,payment_type,payment_key,received_time)
        SELECT ?,'income','ค่าฝากเลี้ยง','ชำระวันเข้าพัก',?/100.0,s.customer_id,s.id,'','checkin',?,?
        FROM stays s WHERE s.create_key=? AND ?>0`)
        .bind(paymentDate,amountCents,marker,payment.paidAt,marker,amountCents),
      db.prepare(`UPDATE appointments AS a SET stay_id=(SELECT id FROM stays WHERE create_key=?)
        WHERE a.id=? AND EXISTS (SELECT 1 FROM stays WHERE create_key=?)`).bind(marker,id,marker),
      db.prepare("SELECT id AS stay_id FROM stays WHERE create_key=?").bind(marker),
    ]);
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
        arrivalDay > existing.checkout || Math.round(existing.agreed_total*100)-existing.paid !== expectedBalance) {
      return {status:"conflict"};
    }
  }
  return {status:"conflict"};
}
