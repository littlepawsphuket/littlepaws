import {overnightPricing,saveBookingPrice,savedBoardingPrice,freezeLegacyPrice} from "./boarding_pricing.mjs";
import {validDay, randomReference} from "./bookings.mjs";
import {bookingSnapshot, bookingWarnings} from "./booking_warnings.mjs";
import {authorizedStaff} from "./stay_payments.mjs";

export const defaultRates = {
  overnight:{small:400,medium:500,large:600}, daycare:{small:200,medium:250,large:300},
  monthly:{small:null,medium:null,large:null},
};
const pending = "a.status='pending' AND a.stay_id IS NULL";
const hasPayments = "EXISTS (SELECT 1 FROM transactions t WHERE t.deposit_appointment_id=a.id AND t.payment_type!='')";
const keyPattern = /^[0-9a-f]{32}$/;

export function bookingValues(form, agreedPrice = null) {
  const {customerId,checkin,checkout,service,quantity100,discountCents,dogs,note} = form;
  if (!Number.isSafeInteger(customerId) || customerId < 1 || !validDay(checkin) || !validDay(checkout) ||
      checkout < checkin || !Object.hasOwn(defaultRates,service) ||
      !Number.isSafeInteger(quantity100) || quantity100 < 0 || quantity100 > 3660000 ||
      (service !== "monthly" && quantity100 % 100) || !Number.isSafeInteger(discountCents) ||
      discountCents < 0 || discountCents > 99_999_999_900 || typeof note !== "string" || note.length > 800 ||
      !Array.isArray(dogs) || !dogs.length || dogs.length > 30) return null;
  const ids = new Set();
  let subtotal = 0;
  let quotePending = false;
  for (const dog of dogs) {
    if (!dog || !Number.isSafeInteger(dog.id) || dog.id < 1 || ids.has(dog.id) ||
        (dog.rate !== null && (!Number.isSafeInteger(dog.rate) || dog.rate < 0 || dog.rate > 99_999_999))) return null;
    ids.add(dog.id);
    quotePending ||= dog.rate === null;
    subtotal += Math.floor(((dog.rate ?? 0) * quantity100 + 50) / 100);
  }
  const pricing=overnightPricing(form);
  if(pricing===null)return null;
  subtotal+=pricing?.fee_cents || 0;
  if (pricing && agreedPrice) subtotal=Number(agreedPrice.total)+(Number(agreedPrice.discount_cents)||0)+(Number(agreedPrice.rounding_cents)||0);
  if (!quotePending && discountCents > subtotal && !agreedPrice) return null;
  const rawNet = Math.max(0,subtotal-discountCents);
  const rounding = form.wholeBaht === true ? rawNet % 100 : 0;
  const data={fields:[customerId,checkin,checkout,quantity100/100,(rawNet-rounding)/100,note,discountCents,rounding,service],
    subtotal, pricing, dogIds:[...ids], dogRows:JSON.stringify(dogs), quotePending, netCents:rawNet-rounding};
  return agreedPrice ? freezeLegacyPrice(data,agreedPrice) : data;
}

export async function bookingRates(db) {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key='rates'").bind().first();
  return configuredRates(row?.value);
}

export function configuredRates(raw) {
  let saved = {};
  try { saved = JSON.parse(raw) || {}; } catch {}
  return Object.fromEntries(Object.entries(defaultRates).map(([service, defaults]) =>
    [service, {...defaults,...saved[service]}]));
}

export const allDogsOwned = `(SELECT count(*) FROM dogs d JOIN json_each(?) choice ON d.id=choice.value
    WHERE d.customer_id=? AND (d.archived=0 OR EXISTS (
      SELECT 1 FROM appointment_dogs ad WHERE ad.appointment_id=? AND ad.dog_id=d.id))) = ?`;

export async function saveBooking(db, id, form, actor) {
  let agreedPrice=null;
  const saved=id===null ? null : await savedBoardingPrice(db,"booking",id);
  if(id!==null && form.pricingVersion===1 && (!saved || saved.grandfathered)){
    agreedPrice=await db.prepare(`SELECT a.discount_cents,a.rounding_cents,ROUND(a.agreed_total*100) AS total
      FROM appointments a WHERE a.id=? AND ${authorizedStaff}`).bind(id,actor.id,actor.email).first();
    if(!agreedPrice)return {status:"not_found"};
  }
  const data = bookingValues(form,agreedPrice);
  if (!data || (id === null && (typeof form.key !== "string" || !keyPattern.test(form.key))) ||
      (id !== null && form.revision !== null &&
        (typeof form.revision !== "string" || !/^[a-f0-9-]{36}$/.test(form.revision)))) return {status:"invalid"};
  if(!data.pricing && saved)return {status:"conflict"};
  const identity = [actor.id,actor.email];
  const revision = crypto.randomUUID();
  const owner = form.customerId;
  const ownerCheck = `EXISTS(SELECT 1 FROM customers c WHERE c.id=? AND (c.archived=0 OR c.id=?))`;
  const eligible = [owner,id === null ? null : owner,JSON.stringify(data.dogIds),owner,id,form.dogs.length];
  const bookedAt = new Date(Date.now()+7*3600000).toISOString().replace("Z","+07:00");
  async function replay() {
    if (id !== null) return null;
    const row = await db.prepare(`SELECT a.id,a.status FROM appointments a WHERE a.create_key=? AND ${authorizedStaff}`)
      .bind(form.key,...identity).first();
    if (!row) return null;
    return row.status === "pending" ? {status:"saved",id:row.id} : {status:"conflict"};
  }
  // A single D1 batch makes the parent and all selected dogs visible together.
  for (let attempt=0; attempt<5; attempt++) {
    const previous = await replay();
    if (previous) return previous;
    const check = await bookingWarnings(db,id,form.checkin,form.checkout,data.dogIds);
    if (check.token && form.warningToken !== check.token) {
      return await replay() || {status:"warning",warnings:check.warnings,token:check.token};
    }
    const unchanged = [ ...check.params,check.snapshot ];
    const code = randomReference();
    const primary = id === null
      ? db.prepare(`INSERT INTO appointments(customer_id,checkin,checkout,charged_nights,agreed_total,note,
          discount_cents,rounding_cents,service_type,create_key,booking_number,booked_at,cloud_revision)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE ${ownerCheck} AND ${allDogsOwned} AND ${authorizedStaff}
            AND NOT EXISTS (SELECT 1 FROM stays WHERE stay_number=?)
            AND (${bookingSnapshot})=?
          ON CONFLICT DO NOTHING`).bind(...data.fields,form.key,code,bookedAt,revision,...eligible,...identity,code,...unchanged)
      : db.prepare(`UPDATE appointments AS a SET customer_id=?,checkin=?,checkout=?,charged_nights=?,agreed_total=?,
          note=?,discount_cents=?,rounding_cents=?,service_type=?,cloud_revision=?
          WHERE a.id=? AND ${pending} AND a.customer_id=? AND a.cloud_revision IS ?
            AND ${ownerCheck} AND ${allDogsOwned} AND ${authorizedStaff}
            AND (? OR ? >= COALESCE((SELECT SUM(ROUND(amount*100)) FROM transactions
              WHERE deposit_appointment_id=a.id AND payment_type!=''),0))
            AND (${bookingSnapshot})=?`)
        .bind(...data.fields,revision,id,owner,form.revision,...eligible,...identity,Number(data.quotePending),data.netCents,...unchanged);
    const writes = await db.batch([
      primary,
      db.prepare("DELETE FROM appointment_dogs WHERE appointment_id=(SELECT id FROM appointments WHERE cloud_revision=?)").bind(revision),
      db.prepare(`INSERT INTO appointment_dogs(appointment_id,dog_id,nightly_rate_cents)
        SELECT a.id,json_extract(d.value,'$.id'),json_extract(d.value,'$.rate')
        FROM appointments a CROSS JOIN json_each(?) d WHERE a.cloud_revision=?`).bind(data.dogRows,revision),
      ...(data.pricing ? [saveBookingPrice(db,revision,data.pricing)] : []),
      id === null
        ? db.prepare(`SELECT a.id,a.status FROM appointments a WHERE a.create_key=? AND ${authorizedStaff}`).bind(form.key,...identity)
        : db.prepare(`SELECT a.id,a.status FROM appointments a WHERE a.id=? AND ${authorizedStaff}`).bind(id,...identity),
    ]);
    const update=writes[0],result=writes.at(-1);
    if (update.meta.changes === 1) return {status:id === null ? "created" : "saved",id:result.results[0].id};
    if (id !== null) {
      const latest = await bookingWarnings(db,id,form.checkin,form.checkout,data.dogIds);
      if (latest.snapshot !== check.snapshot) continue;
      return {status:result.results.length ? "conflict" : "not_found"};
    }
    if (result.results.length) {
      return result.results[0].status === "pending" ? {status:"saved",id:result.results[0].id} : {status:"conflict"};
    }
  }
  return {status:"invalid"};
}

export async function archiveBooking(db, id, actor) {
  const {meta} = await db.prepare(`UPDATE appointments AS a SET status='cancelled'
    WHERE a.id=? AND a.stay_id IS NULL AND NOT (${hasPayments}) AND ${authorizedStaff}`)
    .bind(id,actor.id,actor.email).run();
  return {status:meta.changes === 1 ? "removed" : "conflict"};
}
