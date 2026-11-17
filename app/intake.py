from app.settings import SERVICES
import calendar
import json
from datetime import date, time
from decimal import Decimal, InvalidOperation


YES_NO = {'yes': 'ใช่', 'no': 'ไม่ใช่'}
PROFILE_GROUPS = (
    ('ข้อมูลประจำตัวสุนัข', (
        ('breed', 'สายพันธุ์', 'text'),
        ('gender', 'เพศ', {'male': 'เพศผู้', 'female': 'เพศเมีย'}),
        ('neutered', 'สถานะการทำหมัน', {'yes': 'ทำหมันแล้ว', 'no': 'ยังไม่ทำหมัน'}),
        ('weight', 'น้ำหนัก (กก.)', 'weight'),
    )),
    ('สุขภาพและการป้องกันโรค', (
        ('vaccinated', 'วัคซีนพื้นฐานใน 1 ปีที่ผ่านมา', YES_NO),
        ('rabies', 'วัคซีนพิษสุนัขบ้าใน 1 ปีที่ผ่านมา', YES_NO),
        ('flea_tick', 'ป้องกันเห็บหมัดใน 1 เดือนที่ผ่านมา', YES_NO),
        ('medical_history', 'ประวัติสุขภาพ / แพ้อาหาร', 'textarea'),
        ('required_care', 'โรคประจำตัว / การดูแลที่ต้องการ', 'textarea'),
        ('medications', 'ยาประจำตัว (ชื่อยา ขนาดยา เวลา)', 'textarea'),
    )),
)
INTAKE_GROUPS = (
    ('ข้อมูลติดต่อและบริการ', (
        ('arrival_time', 'เวลาเข้าพัก', 'time'),
        ('pickup_time', 'เวลารับกลับ', 'time'),
        ('service_type', 'ประเภทบริการ', SERVICES),
    )),
    ('ของใช้ที่นำมาฝาก', (
        ('food', 'อาหาร', 'item'),
        ('treats', 'ขนม', 'item'),
        ('supplies', 'ยา / อาหารเสริมที่นำมา', 'item'),
        ('bedding', 'ที่นอน ผ้าห่ม หรือของเล่น', 'item'),
        ('other_items', 'ของใช้อื่น ๆ', 'textarea'),
    )),
    ('ตรวจร่างกาย', (
        ('exam_eyes', 'ตา', 'exam'),
        ('exam_ears', 'หู', 'exam'),
        ('exam_skin', 'ผิวหนัง', 'exam'),
        ('exam_coat', 'ขน', 'exam'),
        ('health', 'ตา หู ผิวหนัง และขน', {'normal': 'ปกติ', 'abnormal': 'พบความผิดปกติ'}),
        ('health_note', 'รายละเอียดที่ตรวจพบ', 'textarea'),
        ('behavior', 'พฤติกรรมขณะรับฝาก', {'friendly': 'เป็นมิตร', 'anxious': 'กังวล', 'aggressive': 'ก้าวร้าว'}),
        ('social', 'การอยู่ร่วมกับสุนัขตัวอื่น', {**YES_NO, 'special': 'ต้องดูแลเป็นพิเศษ'}),
        ('staff_note', 'หมายเหตุจากผู้รับฝาก', 'textarea'),
    )),
)


def read_optional_fields(form, groups):
    result = {}
    for _, fields in groups:
        for key, _, kind in fields:
            value = form.get(key, '').strip()
            if kind == 'exam':
                choices = set(form.getlist(key)) - {'', '1'}
                if len(choices) > 1 or not choices <= {'normal', 'abnormal'}:
                    raise ValueError
                if choices or '1' in form.getlist(key):
                    result[key] = next(iter(choices), '1')
                continue
            if kind == 'item':
                if form.get(f'{key}_packed') == '1' or (value and 'intake_checklists' not in form):
                    result[f'{key}_packed'] = '1'
                else:
                    continue
            if not value:
                continue
            if isinstance(kind, dict) and value not in kind:
                raise ValueError
            if kind == 'date':
                value = date.fromisoformat(value).isoformat()
            if kind == 'time':
                value = time.fromisoformat(value).strftime('%H:%M')
            if kind == 'weight':
                try:
                    weight = Decimal(value)
                except InvalidOperation as exc:
                    raise ValueError from exc
                if not weight.is_finite() or weight <= 0 or weight > 999:
                    raise ValueError
                value = format(weight.normalize(), 'f')
            result[key] = value
    return result


def shift_months(day, months):
    year, month_index = divmod(day.year*12+day.month-1+months, 12)
    month = month_index+1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def age_parts(born, today):
    months = (today.year-born.year)*12 + today.month-born.month
    if shift_months(born, months) > today:
        months -= 1
    return divmod(max(0, months), 12)


def read_dog_profile(form, today):
    result = read_optional_fields(form, PROFILE_GROUPS)
    birth = form.get('birth_date', '').strip()
    estimated = form.get('birth_estimated') == '1'
    years, months = form.get('age_years', '').strip(), form.get('age_months', '').strip()
    if (years or months) and (form.get('age_source') == 'age' or not birth):
        years, months = int(years or 0), int(months or 0)
        if years < 0 or not 0 <= months < 12:
            raise ValueError
        birth = shift_months(today, -(years*12+months)).isoformat()
        estimated = True
    if birth:
        born = date.fromisoformat(birth)
        if born > today:
            raise ValueError
        result.update(birth_date=born.isoformat(), birth_estimated=estimated)
    return result


def encode(values):
    return json.dumps(values, ensure_ascii=False, separators=(',', ':'))


def dog_profile_row(row, today):
    profile = json.loads(row['profile'])
    birth = profile.get('birth_date')
    years, months = age_parts(date.fromisoformat(birth), today) if birth else ('', '')
    return dict(row, profile=profile, age_years=years, age_months=months)
