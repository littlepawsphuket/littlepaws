from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode

from flask import has_request_context, request, session


LANGUAGES = {'th': 'ไทย', 'en': 'English'}
EN = dict(line.split('\t', 1) for line in Path(__file__).with_name('en.tsv').read_text(encoding='utf-8').splitlines()
          if line)
THAI_MONTHS = ('มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
               'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม')
THAI_SHORT_MONTHS = ('ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                     'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.')
ENGLISH_MONTHS = ('January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December')


def stay_duration(quantity, service_type, lang=None):
    amount = Decimal(str(quantity))
    number = format(amount.normalize(), 'f')
    if (lang or language()) == 'th':
        return f"{number} {'เดือน' if service_type == 'monthly' else 'วัน'}"
    unit = 'month' if service_type == 'monthly' else 'day'
    return f"{number} {unit if amount == 1 else unit + 's'}"


def language():
    return session.get('language', 'th') if has_request_context() else 'th'


def translate(message, lang=None):
    return EN.get(message, message) if isinstance(message, str) and (lang or language()) == 'en' else message


def language_url(lang):
    params = [(key, value) for key, value in request.args.items(multi=True) if key != 'lang']
    return request.path + '?' + urlencode([*params, ('lang', lang)])


def display_date(value, lang=None):
    try:
        day = value if isinstance(value, date) else date.fromisoformat(value)
    except (TypeError, ValueError):
        return value or '—'
    if (lang or language()) == 'en':
        return f'{day.day} {ENGLISH_MONTHS[day.month-1][:3]} {day.year}'
    return f'{day.day} {THAI_SHORT_MONTHS[day.month-1]} {day.year+543}'


def display_month(value, lang=None, full=False):
    try:
        month = value if isinstance(value, date) else date.fromisoformat(value + '-01')
    except (TypeError, ValueError):
        return value or '—'
    if (lang or language()) == 'en':
        name = ENGLISH_MONTHS[month.month-1]
        return f'{name if full else name[:3]} {month.year}'
    names = THAI_MONTHS if full else THAI_SHORT_MONTHS
    return f'{names[month.month-1]} {month.year+543}'


def display_payment_datetime(payment, lang):
    day = display_date(payment['occurred_on'], lang)
    clock = payment.get('received_time')
    return f"{day} · {clock}" if clock else day
