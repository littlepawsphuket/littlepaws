from collections import Counter, defaultdict
from datetime import date, timedelta

from flask import url_for

from app.operations import now_local
from app.settings import SERVICES
from app.i18n import display_date, translate


REPORTS = {
    'finance': ('รายรับ–รายจ่าย', 'Income and expenses'),
    'balances': ('ยอดค้างชำระ', 'Outstanding balances'),
    'boarding': ('การจองและการเข้าพัก', 'Bookings and stays'),
    'coupons': ('การใช้คูปอง', 'Coupon usage'),
    'customers': ('ลูกค้าใหม่และลูกค้ากลับมาใช้ซ้ำ', 'New and returning customers'),
}


def make_report(db, name, start, end, filters, lang, balance_sql):
    def label(th, en):
        return en if lang == 'en' else th

    def day(value):
        return display_date(value, lang)

    def stay_url(sid, anchor=None):
        return url_for('stay_summary', sid=sid, _anchor=anchor)

    def row(values, link=None):
        return dict(values=values, link=link)

    params = (start.isoformat(), end.isoformat())
    summary, rows, groups, chart = [], [], [], None

    if name == 'finance':
        kind = filters.get('kind', '')
        category = filters.get('category', '')
        data = db.execute("""SELECT t.*,c.name customer FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id
             WHERE occurred_on BETWEEN ? AND ? AND (?='' OR kind=?) AND (?='' OR category=?)
             ORDER BY occurred_on DESC,id DESC""", (*params, kind, kind, category, category)).fetchall()
        kinds = {'income': label('รายรับ', 'Income'), 'refund': label('เงินคืน', 'Refunds'), 'expense': label('รายจ่าย', 'Expenses')}
        methods = {'deposit': label('มัดจำ', 'Deposits'), 'checkin': label('รับวันเข้าพัก', 'Check-in payments'),
                   'additional': label('รับเพิ่ม', 'Additional payments'), 'other': label('รายรับอื่น', 'Other income')}
        totals, breakdown, months = Counter(), Counter(), defaultdict(Counter)
        for t in data:
            value = t['amount']
            totals[t['kind']] += value
            months[t['occurred_on'][:7]][t['kind']] += value
            if t['kind'] == 'income':
                breakdown[t['payment_type'] or 'other'] += value
            link = (url_for('appointment_preview', aid=t['deposit_appointment_id']) if t['deposit_appointment_id']
                    else stay_url(t['stay_id']) if t['stay_id'] else url_for('transaction_edit', tid=t['id']))
            rows.append(row([day(t['occurred_on']), kinds[t['kind']], translate(t['description'], lang),
                             t['customer'] or '—', value], link))
        summary = [(title, round(totals[k], 2)) for k, title in kinds.items()]
        summary.append((label('เงินสุทธิ', 'Net cash'), round(totals['income']-totals['refund']-totals['expense'], 2)))
        groups = [(label('รายรับแยกตามการรับเงิน', 'Income by payment type'), [(title, round(breakdown[k], 2)) for k, title in methods.items()])]
        chart = (list(kinds.values()), [(m, [round(values[k], 2) for k in kinds]) for m, values in sorted(months.items())])
        columns = [label('วันที่รับหรือจ่าย', 'Transaction date'), label('ประเภท', 'Type'), label('รายละเอียด', 'Description'), label('ลูกค้า', 'Customer'), label('ยอด (บาท)', 'Amount (THB)')]
        note = label('อิงวันที่บันทึกรับหรือจ่ายเงินจริง เงินสุทธิ = รายรับ − เงินคืน − รายจ่าย', 'Uses recorded cash transaction dates. Net cash = income − refunds − expenses.')
    elif name in ('balances', 'boarding'):
        service = filters.get('service', '')
        customer = filters.get('customer', '')
        status = filters.get('status', '')
        actual_start = "COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)"
        actual_end = "COALESCE(substr(s.actual_checkout_at,1,10),CASE WHEN s.status='checked_in' THEN ? ELSE s.checkout END)"
        current_day = now_local().date().isoformat()
        data = db.execute(f"""SELECT s.*,c.name customer, {actual_start} actual_start,{actual_end} actual_end, {balance_sql} AS due_cents,
            COALESCE(json_extract(s.intake,'$.service_type'),'overnight') service,
            (SELECT group_concat(d.name, ', ') FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=s.id) dogs,
            (SELECT count(*) FROM stay_dogs sd WHERE sd.stay_id=s.id) dog_count
            FROM stays s JOIN customers c ON c.id=s.customer_id
            WHERE s.status IN ('checked_in','completed') AND actual_start<=? AND actual_end>=?
              AND (?='' OR CAST(s.customer_id AS TEXT)=?)
              AND (?='' OR COALESCE(json_extract(s.intake,'$.service_type'),'overnight')=?)
              AND (?='' OR s.status=?)
            ORDER BY actual_start DESC,s.id DESC""", (current_day,params[1], params[0], customer, customer, service, service, status, status)).fetchall()
        columns = [label('รายการ', 'Record'), label('ลูกค้า', 'Customer'), label('สุนัข', 'Dogs'),
                   label('เข้าพัก', 'Arrival'), label('รับกลับ', 'Pickup'), label('ประเภทบริการ', 'Service')]
        if name == 'balances':
            data = [s for s in data if s['due_cents'] > 0]
            columns += [label('ยอดสุทธิ (บาท)', 'Net (THB)'), label('รับแล้ว (บาท)', 'Paid (THB)'), label('ค้างชำระ (บาท)', 'Due (THB)')]
            summary = [(label('ยอดค้างรวม (บาท)', 'Total due (THB)'), sum(s['due_cents'] for s in data)/100),
                       (label('รอบฝากค้างชำระ', 'Outstanding stays'), len(data)),
                       (label('เจ้าของ', 'Owners'), len({s['customer_id'] for s in data}))]
            note = label('ยอดค้างปัจจุบันของรอบฝากที่ทับช่วงวันที่เลือก เฉพาะบิลที่บันทึกยอดรับจริง', 'Current balances for stays overlapping the selected dates, where payments are tracked.')
        else:
            columns += [label('สถานะ', 'Status')]
            months = defaultdict(Counter)
            events = Counter()
            dog_days = 0
            for s in data:
                first = max(start, date.fromisoformat(s['actual_start']))
                last = min(end, date.fromisoformat(s['actual_end']))
                if first <= last:
                    dog_days += ((last-first).days+1)*s['dog_count']
                    events[first] += s['dog_count']
                    if last < end:
                        events[last+timedelta(days=1)] -= s['dog_count']
                months[first.isoformat()[:7]][s['service']] += 1
            occupancy = peak = 0
            peak_day = None
            for current, change in sorted(events.items()):
                occupancy += change
                if occupancy > peak:
                    peak, peak_day = occupancy, current
            pending = db.execute("""SELECT a.*,c.name customer,
                (SELECT group_concat(d.name, ', ') FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) dogs
                FROM appointments a JOIN customers c ON c.id=a.customer_id
                WHERE a.status='pending' AND a.stay_id IS NULL AND a.checkin<=? AND a.checkout>=?
                  AND (?='' OR a.service_type=?) AND (?='' OR CAST(a.customer_id AS TEXT)=?)
                ORDER BY a.checkin,a.id""", (params[1], params[0], service, service, customer, customer)).fetchall() if not status else []
            summary = [(label('รอเช็กอิน', 'Pending bookings'), len(pending)), (label('รอบเข้าพักจริง', 'Actual stays'), len(data)),
                       (label('สุนัข (ตัวต่อรอบ)', 'Dogs across stays'), sum(s['dog_count'] for s in data)),
                       (label('วันเข้าพักรวม (ตัว-วัน)', 'Dog-days'), dog_days),
                       (label('วันสูงสุด', 'Peak day'), f'{day(peak_day)} · {peak}' if peak_day else '—')]
            chart = ([label('ค้างคืน', 'Overnight'), 'Day Care', label('รายเดือน','Monthly')], [(m, [v['overnight'], v['daycare'], v['monthly']]) for m,v in sorted(months.items())])
            note = label('นับรอบที่ทับช่วงวันที่เลือก จำนวนตัว-วันและวันสูงสุดนับรวมวันรับกลับ กราฟจัดตามเดือนแรกของรอบในช่วงที่เลือก',
                         'Counts overlapping stays. Dog-days and peak occupancy include pickup day. Chart uses the first month of each stay within the selected period.')
            for a in pending:
                rows.append(row([a['booking_number'] or f"#{a['id']}", a['customer'], a['dogs'] or '—', day(a['checkin']), day(a['checkout']),
                                 translate(SERVICES.get(a['service_type'], SERVICES['overnight']), lang), label('รอเช็กอิน','Pending')],
                                url_for('appointment_preview', aid=a['id'])))
        for s in data:
            values = [f"#{s['id']}", s['customer'], s['dogs'] or '—', day(s['actual_start']), day(s['actual_end']) if s['status'] == 'completed' else '—',
                      translate(SERVICES.get(s['service'], SERVICES['overnight']), lang)]
            if name == 'balances':
                values += [s['agreed_total'], round(s['agreed_total']-s['due_cents']/100,2), s['due_cents']/100]
            else:
                values += [label('กลับบ้านแล้ว','Checked out') if s['status']=='completed' else label('เข้าพัก','Checked in')]
            rows.append(row(values, stay_url(s['id'], 'stay-payment-history' if name=='balances' else None)))
    elif name == 'coupons':
        code = filters.get('code','').strip()
        data = db.execute("""SELECT u.*,s.checkin,s.agreed_total,(s.discount_cents+s.rounding_cents) total_discount,c.code,cu.name customer,
            COALESCE(substr(u.used_at,1,10),s.checkin) report_day
            FROM coupon_uses u JOIN coupons c ON c.id=u.coupon_id JOIN stays s ON s.id=u.stay_id
            JOIN customers cu ON cu.id=s.customer_id WHERE s.status!='cancelled'
              AND COALESCE(substr(u.used_at,1,10),s.checkin) BETWEEN ? AND ? AND (?='' OR c.code=?)
            ORDER BY report_day DESC,u.stay_id DESC""", (*params,code,code)).fetchall()
        totals = Counter()
        counts = Counter()
        for u in data:
            totals[u['code']] += u['discount_cents']
            counts[u['code']] += 1
            rows.append(row([day(u['report_day']), label('วันใช้สิทธิ์','Redemption date') if u['used_at'] else label('วันเข้าพัก','Arrival date'),
                             u['code'], u['customer'], round(u['agreed_total']+u['total_discount']/100,2),
                             u['discount_cents']/100, u['agreed_total']], stay_url(u['stay_id'])))
        columns = [label('วันที่','Date'),label('เกณฑ์วันที่','Date basis'),label('รหัส','Code'),label('ลูกค้า','Customer'),
                   label('ก่อนลด (บาท)','Before discounts (THB)'),label('คูปอง (บาท)','Coupon (THB)'),label('ยอดสุทธิ (บาท)','Net (THB)')]
        summary = [(label('จำนวนครั้งที่ใช้','Redemptions'),len(data)),(label('ส่วนลดคูปองรวม (บาท)','Total coupon discounts (THB)'),sum(totals.values())/100)]
        groups = [(label('สรุปตามรหัสคูปอง','By coupon code'), [(f'{code} · {counts[code]}', cents/100) for code,cents in totals.items()])]
        note = label('อิงวันที่ใช้สิทธิ์ รายการเดิมที่ไม่มีเวลาบันทึกใช้อ้างอิงจากวันเข้าพัก และไม่นับบิลที่ยกเลิก',
                     'Uses redemption date, or arrival date for older records. Cancelled stays are excluded.')
    else:
        segment = filters.get('segment','')
        data = db.execute("""WITH visits AS (
            SELECT customer_id,COALESCE(substr(actual_checkin_at,1,10),checkin) arrival
            FROM stays WHERE status IN ('checked_in','completed')
        ), visit_totals AS (
            SELECT customer_id,MIN(arrival) first_visit,SUM(arrival BETWEEN ? AND ?) period_visits,COUNT(*) visits
            FROM visits WHERE arrival<=? GROUP BY customer_id
        ), bookings AS (
            SELECT customer_id,CASE WHEN COUNT(*)=COUNT(booked_at) THEN MIN(substr(booked_at,1,10)) END first_booking
            FROM appointments GROUP BY customer_id
        )
        SELECT c.id,c.name,substr(c.registered_at,1,10) registered,b.first_booking,v.first_visit,
               COALESCE(v.period_visits,0) period_visits,COALESCE(v.visits,0) visits
        FROM customers c LEFT JOIN visit_totals v ON v.customer_id=c.id LEFT JOIN bookings b ON b.customer_id=c.id
        WHERE v.period_visits>0 OR registered BETWEEN ? AND ? OR b.first_booking BETWEEN ? AND ?
        ORDER BY period_visits DESC,c.name""", (*params,params[1],*params,*params)).fetchall()
        counts = Counter()
        for c in data:
            registered = bool(c['registered'] and params[0] <= c['registered'] <= params[1])
            first_booking = bool(c['first_booking'] and params[0] <= c['first_booking'] <= params[1])
            new = bool(c['period_visits'] and c['first_visit'] >= params[0])
            returning = bool(c['period_visits'] and not new)
            if segment and not {'new': new, 'returning': returning, 'registered': registered,
                                'first_booking': first_booking}.get(segment):
                continue
            counts.update(registered=int(registered),first_booking=int(first_booking),new=int(new),returning=int(returning))
            customer_group = label('ฝากครั้งแรก','First stay') if new else label('กลับมาฝาก','Returning') if returning else '—'
            rows.append(row([c['name'], customer_group, day(c['registered']) if c['registered'] else '—',
                             day(c['first_booking']) if c['first_booking'] else '—',
                             day(c['first_visit']) if c['first_visit'] else '—',
                             c['period_visits'], c['visits']], url_for('customer_detail', cid=c['id'])))
        columns = [label('ลูกค้า','Customer'),label('กลุ่ม','Segment'),label('เพิ่มโปรไฟล์','Profile created'),
                   label('จองครั้งแรก','First booking'),label('ฝากครั้งแรก','First stay'),
                   label('รอบฝากในช่วง','Stays in period'),label('รอบฝากถึงวันสิ้นสุด','Stays through period end')]
        summary = [(label('เพิ่มโปรไฟล์','Profiles created'),counts['registered']),
                   (label('จองครั้งแรก','First bookings'),counts['first_booking']),
                   (label('ฝากครั้งแรก','First stays'),counts['new']),
                   (label('กลับมาฝาก','Returning customers'),counts['returning'])]
        note = label('ข้อมูลเดิมที่ไม่ทราบวันเพิ่มโปรไฟล์หรือวันจองครั้งแรกจะแสดงเป็นขีด วันเข้าพักของรายการเดิมอิงวันที่ในรายการฝาก',
                     'A dash indicates an unavailable profile or first booking date. Older stays use their recorded arrival date.')
    return dict(title=label(*REPORTS[name]), note=note, period=f'{day(start)} – {day(end)}',
                summary=summary, columns=columns, rows=rows, groups=groups, chart=chart)
