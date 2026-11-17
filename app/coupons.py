from datetime import datetime
from zoneinfo import ZoneInfo


def coupon_today():
    return datetime.now(ZoneInfo('Asia/Bangkok')).date()


def find_coupon(db, code, stay_id=None):
    coupon = db.execute("""SELECT c.*,
        (SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id) AS used,
        EXISTS(SELECT 1 FROM coupon_uses u WHERE u.coupon_id=c.id AND u.stay_id=?) AS already_used
        FROM coupons c WHERE c.code=?""", (stay_id, code)).fetchone()
    if coupon is None or (coupon['archived'] and not coupon['already_used']):
        raise ValueError('ไม่พบรหัสคูปอง')
    if not coupon['already_used']:
        if coupon['expires_on'] < coupon_today().isoformat():
            raise ValueError('คูปองหมดอายุแล้ว')
        if coupon['used'] >= coupon['max_uses']:
            raise ValueError('คูปองถูกใช้ครบจำนวนครั้งแล้ว')
    return coupon


def coupon_discount(coupon, subtotal):
    if subtotal < coupon['minimum_cents']:
        raise ValueError('ยอดค่าฝากไม่ถึงขั้นต่ำของคูปอง')
    amount = (subtotal*coupon['value']+5000)//10000 if coupon['kind'] == 'percent' else coupon['value']
    return min(subtotal, amount)
