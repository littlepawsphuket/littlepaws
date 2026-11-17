import qrcode from "qrcode-generator";
import {validDay} from "./bookings.mjs";
import {authorizedStaff} from "./stay_payments.mjs";

const usedCount = "(SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id)";
const authorizedAdmin = `EXISTS (SELECT 1 FROM app_users u WHERE u.id=? AND u.is_admin=1)
  AND ${authorizedStaff}`;

function defaultExpiry() {
  const today = new Date(Date.now()+7*3600000);
  const target = new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+6,1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(today.getUTCDate(),lastDay));
  return target.toISOString().slice(0,10);
}

function randomCouponCode() {
  const range = 1000000;
  const ceiling = Math.floor(2**32 / range) * range;
  const random = new Uint32Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= ceiling);
  return String(random[0] % range).padStart(6,"0");
}

const selectCoupon = `SELECT c.id,c.code,c.kind,c.value,c.minimum_cents,c.expires_on,c.max_uses,
  ${usedCount} AS used FROM coupons c`;

export async function listCoupons(db, status, before) {
  const groups = {
    active:`c.expires_on>=date('now','+7 hours') AND ${usedCount}=0`,
    used:`c.expires_on>=date('now','+7 hours') AND ${usedCount}>0`,
    expired:"c.expires_on<date('now','+7 hours')",
  };
  const {results} = await db.prepare(`${selectCoupon} WHERE c.archived=0 AND c.id<? AND ${groups[status]}
    ORDER BY c.id DESC LIMIT 26`).bind(before).all();
  const coupons = results.slice(0,25);
  return {coupons,nextBefore:results.length>coupons.length ? coupons.at(-1).id : null,defaultExpiry:defaultExpiry()};
}

export function couponMatrix(code) {
  const qr = qrcode(1,"M");
  qr.addData(code,"Numeric");
  qr.make();
  return Array.from({length:qr.getModuleCount()},(_,row) =>
    Array.from({length:qr.getModuleCount()},(_,column) => Number(qr.isDark(row,column))).join(""));
}

export async function couponDetails(db,id) {
  const coupon = await db.prepare(`${selectCoupon} WHERE c.id=? AND c.archived=0`).bind(id).first();
  return coupon ? {...coupon,qr:couponMatrix(coupon.code)} : null;
}

export async function saveCoupon(db,id,form,actor) {
  const {kind,value,minimumCents,expiresOn,maxUses,key} = form;
  if (!["percent","fixed"].includes(kind) ||
      !Number.isSafeInteger(value) || value < 1 || value > (kind === "percent" ? 10000 : 99999999900) ||
      !Number.isSafeInteger(minimumCents) || minimumCents < 0 || minimumCents > 99999999900 ||
      !validDay(expiresOn) || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 999999) return {status:"invalid"};
  const identity = [actor.id,actor.id,actor.email];
  const fields = [kind,value,minimumCents,expiresOn,maxUses];
  if (id !== null) {
    const {meta} = await db.prepare(`UPDATE coupons AS c SET kind=?,value=?,minimum_cents=?,expires_on=?,max_uses=?
      WHERE c.id=? AND c.archived=0 AND (? >= date('now','+7 hours') OR ?=c.expires_on)
        AND ?>=${usedCount} AND ${authorizedAdmin}`)
      .bind(...fields,id,expiresOn,expiresOn,maxUses,...identity).run();
    return meta.changes === 1 ? {status:"saved",id} : {status:"conflict"};
  }
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) return {status:"invalid"};
  const createKey = actor.id+":"+key;
  for (let attempt=0; attempt<10; attempt++) {
    const [insert,lookup] = await db.batch([
      db.prepare(`INSERT INTO coupons(code,kind,value,minimum_cents,expires_on,max_uses,cloud_create_key)
        SELECT ?,?,?,?,?,?,? WHERE ?>=date('now','+7 hours') AND ${authorizedAdmin}
        ON CONFLICT DO NOTHING`).bind(randomCouponCode(),...fields,createKey,expiresOn,...identity),
      db.prepare(`SELECT id,archived FROM coupons WHERE cloud_create_key=? AND ${authorizedAdmin}`).bind(createKey,...identity),
    ]);
    const coupon = lookup.results[0];
    if (coupon) {
      if (coupon.archived) return {status:"conflict"};
      return {status:insert.meta.changes === 1 ? "created" : "saved",id:coupon.id};
    }
  }
  return {status:"invalid"};
}

export async function archiveCoupon(db,id,actor) {
  const {meta} = await db.prepare(`UPDATE coupons SET archived=1 WHERE id=? AND ${authorizedAdmin}`)
    .bind(id,actor.id,actor.id,actor.email).run();
  return {status:meta.changes === 1 ? "removed" : "not_found"};
}
