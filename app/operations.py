import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def now_local():
    return datetime.now(ZoneInfo('Asia/Bangkok'))


def booking_warnings(db, start, end, dogs, *, appointment_id, stay_id, capacity):
    warnings = []
    if db.execute('SELECT 1 FROM shop_holidays WHERE starts_on<=? AND ends_on>=?', (end, start)).fetchone():
        warnings.append('ช่วงที่เลือกตรงกับวันหยุดร้าน')
    slots = db.execute("""
        SELECT a.checkin start,a.checkout end,ad.dog_id FROM appointments a
        JOIN appointment_dogs ad ON ad.appointment_id=a.id
        WHERE a.status='pending' AND a.stay_id IS NULL AND a.id IS NOT ? AND a.checkin<=? AND a.checkout>=?
        UNION ALL
        SELECT COALESCE(substr(s.actual_checkin_at,1,10),s.checkin),
               COALESCE(substr(s.actual_checkout_at,1,10),s.checkout),sd.dog_id FROM stays s
        JOIN stay_dogs sd ON sd.stay_id=s.id
        WHERE s.status!='cancelled' AND s.id IS NOT ?
          AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<=?
          AND COALESCE(substr(s.actual_checkout_at,1,10),s.checkout)>=?
    """, (appointment_id, end, start, stay_id, end, start)).fetchall()
    if any(slot['dog_id'] in dogs for slot in slots):
        warnings.append('มีสุนัขตัวเดิมในรายการที่ทับช่วงวันที่เลือก')
    if capacity:
        occupancy = len(dogs)
        changes = Counter()
        for slot in slots:
            if slot['start'] <= start:
                occupancy += 1
            else:
                changes[slot['start']] += 1
            if slot['end'] < end:
                release = datetime.fromisoformat(slot['end']).date()+timedelta(days=1)
                changes[release.isoformat()] -= 1
        peak = occupancy
        for day in sorted(changes):
            occupancy += changes[day]
            peak = max(peak, occupancy)
        if peak > capacity:
            warnings.append('จำนวนสุนัขเกินความจุที่ตั้งไว้')
    token = hashlib.sha256(json.dumps([start,end,sorted(dogs),warnings]).encode()).hexdigest()
    return warnings, token
