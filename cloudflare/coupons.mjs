export const couponAvailable = `c.archived=0 AND c.expires_on>=date('now','+7 hours')
  AND (SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id)<c.max_uses`;

export const unchangedCoupon = `(? IS NULL OR EXISTS(SELECT 1 FROM coupons c WHERE c.id=?
  AND c.kind=? AND c.value=? AND c.minimum_cents=? AND ${couponAvailable}))`;

export function couponCondition(coupon) {
  return [coupon?.id ?? null,coupon?.id ?? null,coupon?.kind ?? null,coupon?.value ?? null,coupon?.minimum_cents ?? null];
}

export async function quoteCoupon(db, code, subtotal, billDiscount, paid) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return {status:"coupon_invalid"};
  const coupon = await db.prepare(`SELECT c.id,c.kind,c.value,c.minimum_cents FROM coupons c
    WHERE c.code=? AND ${couponAvailable}`).bind(code).first();
  if (!coupon || !Number.isSafeInteger(coupon.value) || coupon.value < 1 ||
      (coupon.kind === "percent" && coupon.value > 10000)) return {status:"coupon_unavailable"};
  if (subtotal < coupon.minimum_cents) return {status:"coupon_minimum"};
  const discount = Math.min(subtotal,coupon.kind === "percent"
    ? Number((BigInt(subtotal)*BigInt(coupon.value)+5000n)/10000n) : coupon.value);
  if (discount <= 0 || billDiscount + discount > subtotal) return {status:"coupon_exceeds"};
  const rawTotal = subtotal - billDiscount - discount;
  const rounding = rawTotal % 100;
  const total = rawTotal - rounding;
  if (paid > total) return {status:"coupon_exceeds"};
  return {coupon,discount,rounding,total,balance:total-paid};
}

export function saveCouponUse(db, marker, quote, usedAt) {
  return db.prepare(`INSERT INTO coupon_uses(stay_id,coupon_id,discount_cents,used_at)
    SELECT id,?,?,? FROM stays WHERE create_key=? AND ? IS NOT NULL`)
    .bind(quote?.coupon.id ?? null,quote?.discount ?? 0,usedAt,marker,quote?.coupon.id ?? null);
}
