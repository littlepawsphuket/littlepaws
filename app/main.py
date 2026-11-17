from contextlib import closing
from functools import partial
from zipfile import BadZipFile, ZipFile, ZIP_DEFLATED
import os, csv, io, json, sqlite3, secrets, subprocess, tempfile
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation
from pathlib import Path
from flask import g, Flask, render_template, request, redirect, url_for, flash, session, abort, send_file, Response, jsonify
from werkzeug.utils import secure_filename

from app.auth import PUBLIC_CARE_ENDPOINTS, admin_attempts, init_users, matching_password, register_auth
from app.photo_orientation import upright_jpeg
from app.operations import booking_warnings, now_local
from app.backup_archive import ARCHIVE_LIMIT, DATABASE_NAME, PAYMENT_QR_NAME, receipt_names, validate_archive
from app.coupons import coupon_discount, coupon_today, find_coupon
from app.settings import RATE_UNITS, SERVICES, THEMES, configured_rates, get_setting, set_setting
from app.brand import SLOGAN_TEXT, SLOGAN_TITLE
from app.intake import (INTAKE_GROUPS, PROFILE_GROUPS, dog_profile_row, encode, read_dog_profile,
                        read_optional_fields, shift_months)
from app.i18n import EN, LANGUAGES, display_date, display_month, language, language_url, stay_duration, translate
from app.stay_terms import (TERMS_EN_SNAPSHOT, TERMS_SNAPSHOT, TERMS_VERSIONS, consent_terms,
                            parse_signature, translated_terms, updated_term_sections)


ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('LITTLE_PAWS_DATA', ROOT / 'data')).resolve()
DATA.mkdir(parents=True, exist_ok=True)
UPLOADS = DATA / 'receipts'; UPLOADS.mkdir(exist_ok=True)
DB = DATA / 'little_paws.sqlite3'
app = Flask(__name__)
app.jinja_env.globals.update(slogan_title=SLOGAN_TITLE, slogan_text=SLOGAN_TEXT, stay_duration=stay_duration)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config.update(MAX_CONTENT_LENGTH=8*1024*1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax')
app.config['TRUSTED_HOSTS'] = ['localhost', '127.0.0.1']

CARE_EVENT_LABELS = {'food': 'ให้อาหารแล้ว', 'medicine': 'ให้ยาแล้ว'}
CARE_ACTIVITIES = {'food': 'ทานอาหาร', 'medicine': 'กินยา', 'walk': 'เดินเล่น',
                   'play': 'เล่น', 'rest': 'พักผ่อน', 'custom': 'กิจกรรมอื่น'}
CARE_EVENTS_SCHEMA = '''
CREATE TABLE IF NOT EXISTS care_events (
    id INTEGER PRIMARY KEY, stay_id INTEGER NOT NULL, dog_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('food','medicine','custom')), recorded_at TEXT NOT NULL, note TEXT NOT NULL,
    FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE CASCADE,
    FOREIGN KEY(dog_id) REFERENCES dogs(id)
)
'''
def care_activity_options(db):
    extra = get_setting(db, 'care_activities', [])
    return {**CARE_ACTIVITIES, **{f'activity:{label}': label for label in extra}}


def care_event_title(event):
    return event['activity_label'] or CARE_EVENT_LABELS.get(event['kind'], 'กิจกรรมอื่น')


app.jinja_env.globals['care_event_title'] = care_event_title

SCHEMA = f'''
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT DEFAULT '', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS dogs (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), name TEXT NOT NULL, size TEXT DEFAULT 'small', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS dog_photos (
    dog_id INTEGER PRIMARY KEY REFERENCES dogs(id) ON DELETE CASCADE,
    photo BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS stays (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), checkin TEXT NOT NULL, checkout TEXT NOT NULL, charged_nights INTEGER NOT NULL DEFAULT 1, agreed_total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'booked', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS stay_dogs (stay_id INTEGER REFERENCES stays(id) ON DELETE CASCADE, dog_id INTEGER REFERENCES dogs(id), PRIMARY KEY(stay_id,dog_id));
CREATE TABLE IF NOT EXISTS stay_consents (
    id INTEGER PRIMARY KEY,
    stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    terms TEXT NOT NULL,
    signature TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stay_consents_stay ON stay_consents(stay_id, id);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, occurred_on TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','refund','expense')), category TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), customer_id INTEGER REFERENCES customers(id), stay_id INTEGER REFERENCES stays(id), merchant TEXT DEFAULT '', payment_method TEXT DEFAULT 'transfer', reference TEXT DEFAULT '', note TEXT DEFAULT '', receipt TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
    checkin TEXT NOT NULL, checkout TEXT NOT NULL, charged_nights INTEGER NOT NULL,
    agreed_total REAL NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cancelled')),
    note TEXT NOT NULL DEFAULT '', create_key TEXT UNIQUE,
    stay_id INTEGER UNIQUE REFERENCES stays(id)
);
CREATE TABLE IF NOT EXISTS appointment_dogs (
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    dog_id INTEGER NOT NULL REFERENCES dogs(id), nightly_rate_cents INTEGER,
    PRIMARY KEY(appointment_id,dog_id)
);
CREATE TABLE IF NOT EXISTS stay_payment_deletions (
    id INTEGER PRIMARY KEY, stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    payment_type TEXT NOT NULL, occurred_on TEXT NOT NULL, received_time TEXT,
    amount REAL NOT NULL, payment_key TEXT, deleted_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stay_payment_deletions ON stay_payment_deletions(stay_id);
{CARE_EVENTS_SCHEMA};
CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
    value INTEGER NOT NULL, minimum_cents INTEGER NOT NULL DEFAULT 0,
    expires_on TEXT NOT NULL, max_uses INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coupon_uses (
    stay_id INTEGER PRIMARY KEY REFERENCES stays(id) ON DELETE CASCADE,
    coupon_id INTEGER NOT NULL REFERENCES coupons(id),
    discount_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_coupon_uses_coupon ON coupon_uses(coupon_id);
CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shop_holidays (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
    CHECK(starts_on <= ends_on)
);
CREATE INDEX IF NOT EXISTS ix_appointments_dates ON appointments(checkin, checkout);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(occurred_on);
'''

def conn():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    return db

def assign_reference_code(db, table, column, record_id):
    current = db.execute(f'SELECT {column} FROM {table} WHERE id=?', (record_id,)).fetchone()[0]
    if current and len(current) == 6 and all(char in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' for char in current):
        return
    letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    digits = '0123456789'
    while True:
        code = ''.join(secrets.choice(letters + digits) for _ in range(6))
        if code.isalpha() or code.isdigit():
            continue
        if not db.execute('''SELECT 1 FROM appointments WHERE booking_number=?
                             UNION ALL SELECT 1 FROM stays WHERE stay_number=?''', (code, code)).fetchone():
            db.execute(f'UPDATE {table} SET {column}=? WHERE id=?', (code, record_id))
            return


with conn() as db:
    db.executescript(SCHEMA)
    db.execute('BEGIN IMMEDIATE')
    init_users(db)
    care_schema = db.execute("SELECT sql FROM sqlite_master WHERE name='care_events' AND type='table'").fetchone()[0]
    if "'custom'" not in care_schema:
        db.execute('ALTER TABLE care_events RENAME TO care_events_old')
        db.execute(CARE_EVENTS_SCHEMA)
        db.execute('''INSERT INTO care_events(id,stay_id,dog_id,kind,recorded_at,note)
                      SELECT id,stay_id,dog_id,kind,recorded_at,note FROM care_events_old''')
        db.execute('DROP TABLE care_events_old')
    for table, column, definition in (
        ('stay_dogs', 'nightly_rate_cents', 'INTEGER'),
        ('customers', 'registered_at', 'TEXT'),
        ('appointments', 'booked_at', 'TEXT'),
        ('stays', 'actual_checkin_at', 'TEXT'),
        ('stays', 'stay_number', 'TEXT'),
        ('care_events', 'activity_label', 'TEXT'),
        ('care_events', 'customer_visible', 'INTEGER NOT NULL DEFAULT 0'),
        ('stays', 'actual_checkout_at', 'TEXT'),
        ('stays', 'cancelled_at', 'TEXT'),
        ('stays', 'cancel_reason', 'TEXT'),
        ('customers', 'archived', 'INTEGER NOT NULL DEFAULT 0'),
        ('stays', 'intake', "TEXT NOT NULL DEFAULT '{}'"),
        ('customers', 'owner_phone', "TEXT NOT NULL DEFAULT ''"),
        ('customers', 'line_id', "TEXT NOT NULL DEFAULT ''"),
        ('customers', 'emergency_address', "TEXT NOT NULL DEFAULT ''"),
        ('dogs', 'archived', 'INTEGER NOT NULL DEFAULT 0'),
        ('dogs', 'profile', "TEXT NOT NULL DEFAULT '{}'"),
        ('stays', 'discount_cents', 'INTEGER NOT NULL DEFAULT 0'),
        ('stays', 'create_key', 'TEXT'),
        ('coupon_uses', 'used_at', 'TEXT'),
        ('coupons', 'archived', 'INTEGER NOT NULL DEFAULT 0'),
        ('stays', 'rounding_cents', 'INTEGER NOT NULL DEFAULT 0'),
        ('appointments', 'rounding_cents', 'INTEGER NOT NULL DEFAULT 0'),
        ('stays', 'payment_tracking', 'INTEGER NOT NULL DEFAULT 0'),
        ('transactions', 'deposit_appointment_id', 'INTEGER REFERENCES appointments(id) ON DELETE SET NULL'),
        ('transactions', 'received_time', 'TEXT'),
        ('transactions', 'payment_key', 'TEXT'),
        ('transactions', 'payment_type', "TEXT NOT NULL DEFAULT ''"),
        ('transactions', 'auto_stay', 'INTEGER NOT NULL DEFAULT 0'),
        ('stay_consents', 'signed_language', "TEXT NOT NULL DEFAULT 'th'"),
        ('stay_consents', 'terms_en', 'TEXT'),
        ('appointments', 'service_type', "TEXT NOT NULL DEFAULT 'overnight'"),
        ('appointments', 'booking_number', 'TEXT'),
    ):
        if column not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
            if table == 'customers' and column in ('owner_phone', 'line_id', 'emergency_address'):
                # Existing check-ins can contain contact details entered before they lived on the customer.
                db.execute(f"""
                    UPDATE customers SET {column}=COALESCE((
                        SELECT json_extract(s.intake, '$.{column}') FROM stays s
                        WHERE s.customer_id=customers.id AND json_extract(s.intake, '$.{column}') <> ''
                        ORDER BY s.checkin DESC, s.id DESC LIMIT 1
                    ), '')
                """)
    db.execute("""CREATE TABLE IF NOT EXISTS care_photos (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES care_events(id) ON DELETE CASCADE,
        photo BLOB NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS care_share_links (
        stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
        dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE, PRIMARY KEY(stay_id,dog_id)
    )""")
    db.execute('CREATE INDEX IF NOT EXISTS ix_care_photos_event ON care_photos(event_id)')
    db.execute('CREATE INDEX IF NOT EXISTS ix_care_dog_stay ON care_events(stay_id,dog_id,recorded_at)')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_payment_key ON transactions(stay_id,payment_key)')
    db.execute('DROP INDEX IF EXISTS ix_deposit_appointment')
    db.execute('CREATE INDEX IF NOT EXISTS ix_deposit_records ON transactions(deposit_appointment_id)')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_deposit_submission ON transactions(deposit_appointment_id,payment_key)')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_create_key ON stays(create_key) WHERE create_key IS NOT NULL')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_appointment_booking_number ON appointments(booking_number)')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_number ON stays(stay_number)')
    for row in db.execute('''SELECT id FROM stays
                             WHERE stay_number IS NOT NULL OR actual_checkin_at IS NOT NULL
                                OR status IN ('checked_in','completed')''').fetchall():
        assign_reference_code(db, 'stays', 'stay_number', row['id'])
    for row in db.execute('SELECT id FROM appointments').fetchall():
        assign_reference_code(db, 'appointments', 'booking_number', row['id'])
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_auto_stay ON transactions(stay_id) WHERE auto_stay=1')


@app.before_request
def select_language():
    selected = request.args.get('lang')
    if request.method == 'GET' and request.endpoint not in ('stay_summary_pdf', 'stay_summary_image', *PUBLIC_CARE_ENDPOINTS) and selected in LANGUAGES:
        session['language'] = selected


@app.before_request
def csrf_guard():
    if request.endpoint == 'verify_backup':
        request.max_content_length = ARCHIVE_LIMIT + 1024 * 1024
    if 'csrf' not in session:
        session['csrf'] = secrets.token_urlsafe(24)
    if request.method == 'POST' and not secrets.compare_digest(
        request.form.get('_csrf', ''), session['csrf']
    ):
        abort(403)


@app.context_processor
def globals_():
    now = now_local()
    return dict(csrf=session['csrf'], booking_warning=getattr(g,'booking_warning',None), today=now.date().isoformat(), current_payment_time=now.strftime('%H:%M'), fmt=lambda x:f'{float(x or 0):,.2f}')


app.add_template_filter(display_date, 'thai_date')
app.add_template_filter(display_month, 'thai_month')
app.add_template_filter(translate, 'tr')
app.jinja_env.globals.update(service_names=SERVICES, rate_units=RATE_UNITS, _=translate, language_url=language_url, languages=LANGUAGES)


def thai_date(value):
    return display_date(value, 'th')


def current_theme():
    with conn() as db:
        theme = get_setting(db, 'theme', 'classic')
    return theme if theme in THEMES else 'classic'


@app.context_processor
def locale_context():
    lang = language()
    theme = current_theme()
    return dict(lang=lang, ui_messages=EN if lang == 'en' else {},
                active_theme=theme,
                mascot_file='balen-gucci-relax.webp' if theme == 'classic' else f'mascot-{theme}.webp')


def dashboard_month(value):
    try:
        month = date.fromisoformat(value + '-01')
        if month.year < 9999:
            return month
    except ValueError:
        pass
    return date.today().replace(day=1)


def next_month(month):
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


@app.get('/')
def dashboard():
    current = now_local().date()
    first = dashboard_month(request.args.get('from_month', request.args.get('month', current.strftime('%Y-%m'))))
    last = dashboard_month(request.args.get('to_month', first.isoformat()[:7]))
    if first > last:
        first, last = last, first
    period = (first.isoformat(), next_month(last).isoformat())
    with conn() as db:
        monthly = {}
        for row in db.execute("""SELECT substr(occurred_on,1,7) month,kind,SUM(amount) total
                                  FROM transactions WHERE occurred_on>=? AND occurred_on<?
                                  GROUP BY month,kind""", period):
            monthly.setdefault(row['month'], {})[row['kind']] = row['total']
        income, refunds, expenses = (sum(row.get(kind, 0) for row in monthly.values())
                                     for kind in ('income', 'refund', 'expense'))
        tx = db.execute("""SELECT t.*,c.name customer FROM transactions t
                           LEFT JOIN customers c ON c.id=t.customer_id
                           WHERE occurred_on>=? AND occurred_on<?
                           ORDER BY occurred_on DESC,t.id DESC LIMIT 10""", period).fetchall()
        cats = db.execute("""SELECT category,SUM(amount) amount FROM transactions
                             WHERE kind='expense' AND occurred_on>=? AND occurred_on<?
                             GROUP BY category ORDER BY amount DESC""", period).fetchall()
        stats = db.execute("""SELECT COUNT(*) stays, COALESCE(SUM(s.charged_nights),0) nights,
                              COALESCE(SUM((SELECT COUNT(*) FROM stay_dogs WHERE stay_id=s.id)),0) dogs
                              FROM stays s WHERE COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)>=?
                              AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<? AND s.status IN ('checked_in','completed')""",
                           period).fetchone()
        boarding = db.execute("""SELECT s.id stay_id,d.name dog,c.id customer_id,c.name owner,COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact,s.checkout,
                                        d.id dog_id,p.dog_id IS NOT NULL has_photo,d.profile,s.intake,json_extract(s.intake,'$.pickup_time') pickup_time,
                                        MAX(0, CAST(julianday(s.checkout)-julianday(?) AS INTEGER)) days_left
                                 FROM stays s JOIN customers c ON c.id=s.customer_id
                                 JOIN stay_dogs sd ON sd.stay_id=s.id JOIN dogs d ON d.id=sd.dog_id
                                 LEFT JOIN dog_photos p ON p.dog_id=d.id
                                 WHERE s.status='checked_in' AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<=?
                                 ORDER BY s.checkout,d.name""", (current.isoformat(), current.isoformat())).fetchall()
        upcoming = db.execute('''SELECT a.id, a.checkin, a.checkout, d.name dog, c.name owner, COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact,
                                        'appointment' source,d.id dog_id,p.dog_id IS NOT NULL has_photo,a.charged_nights,a.service_type
                                 FROM appointments a JOIN customers c ON c.id=a.customer_id
                                 JOIN appointment_dogs ad ON ad.appointment_id=a.id JOIN dogs d ON d.id=ad.dog_id
                                 LEFT JOIN dog_photos p ON p.dog_id=d.id
                                 WHERE a.status='pending' AND a.stay_id IS NULL
                                 UNION ALL
                                 SELECT s.id,s.checkin,s.checkout,d.name,c.name,COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact,'stay',d.id,p.dog_id IS NOT NULL,
                                        s.charged_nights,json_extract(s.intake,'$.service_type')
                                 FROM stays s JOIN customers c ON c.id=s.customer_id
                                 JOIN stay_dogs sd ON sd.stay_id=s.id JOIN dogs d ON d.id=sd.dog_id
                                 LEFT JOIN dog_photos p ON p.dog_id=d.id
                                 WHERE s.status='booked'
                                 ORDER BY checkin,owner,dog''').fetchall()

        care_options = care_activity_options(db)
        care = {}
        for event in db.execute("""SELECT e.*, (SELECT group_concat(id) FROM care_photos WHERE event_id=e.id) photos
                                   FROM care_events e WHERE substr(recorded_at,1,10)=?
                                   ORDER BY recorded_at DESC,id DESC""",
                                (current.isoformat(),)):
            care.setdefault((event['stay_id'], event['dog_id']), []).append(event)
    boarding = [dict(dog, care=care.get((dog['stay_id'], dog['dog_id']), []),
                     details={**json.loads(dog['intake'] or '{}'), **json.loads(dog['profile'] or '{}')})
                for dog in boarding]
    upcoming = [dict(row, days_until=(date.fromisoformat(row['checkin'])-current).days)
                for row in upcoming]
    trend = []
    month = first
    while month <= last:
        key = month.isoformat()[:7]
        values = monthly.get(key, {})
        trend.append(dict(month=key, label=display_month(key), income=round(values.get('income', 0)-values.get('refund', 0), 2),
                          expense=round(values.get('expense', 0), 2)))
        month = next_month(month)
    return render_template('dashboard.html', from_month=first.isoformat()[:7], to_month=last.isoformat()[:7],
                           transaction_period=dict(start=period[0], end=(next_month(last)-timedelta(days=1)).isoformat()),
                           income=income, refunds=refunds, expenses=expenses, net=income-refunds-expenses,
                           tx=tx, cats=cats, stats=stats, boarding=boarding, upcoming=upcoming, trend=trend, care_options=care_options)


CUSTOMER_DETAIL_FIELDS = ('owner_phone', 'line_id', 'emergency_address')


def customer_details(form, existing=None):
    return tuple(form.get(key, existing[key] if existing else '').strip() for key in CUSTOMER_DETAIL_FIELDS)


def insert_customer(db, name, contact='', note='', details=('', '', '')):
    return db.execute("""INSERT INTO customers(name,contact,note,owner_phone,line_id,emergency_address,registered_at)
                         VALUES(?,?,?,?,?,?,?)""", (name, contact, note, *details, now_local().isoformat(timespec='seconds'))).lastrowid


def update_customer(db, customer, name, form):
    db.execute("""UPDATE customers SET name=?,contact=?,note=?,owner_phone=?,line_id=?,emergency_address=?
                  WHERE id=?""", (name, form.get('contact', customer['contact'] or '').strip(),
                                   form.get('note', customer['note'] or ''),
                                   *customer_details(form, customer), customer['id']))


def insert_dog(db, customer_id, name, size='small', note=''):
    return db.execute('INSERT INTO dogs(customer_id,name,size,note) VALUES(?,?,?,?)',
                      (customer_id, name, size, note)).lastrowid


DOG_PHOTO_ERROR = 'กรุณาเลือกรูป JPG, PNG, WebP, HEIC หรือ HEIF ขนาดไม่เกิน 7 MB'


def uploaded_dog_photo():
    files = [upload for key in ('dog_photo', 'dog_camera') if (upload := request.files.get(key)) and upload.filename]
    if not files:
        return None
    if len(files) > 1:
        raise ValueError('กรุณาเลือกหรือถ่ายรูปอย่างใดอย่างหนึ่ง')
    return read_photo_upload(files[0])


def read_photo_upload(upload):
    limit = 7 * 1024 * 1024
    data = upload.read(limit + 1)
    is_image = (data.startswith((b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n'))
                or (data.startswith(b'RIFF') and data[8:12] == b'WEBP')
                or (data[4:8] == b'ftyp' and data[8:12] in (b'heic', b'heix', b'mif1', b'hevc', b'heif')))
    if len(data) > limit or not is_image:
        raise ValueError(DOG_PHOTO_ERROR)
    return resize_dog_photo(data)


def resize_dog_photo(data):
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / 'upload'
        target = Path(directory) / 'photo.jpg'
        source.write_bytes(data)
        try:
            converted = subprocess.run(
                ['/usr/bin/sips', '-Z', '768', '-s', 'format', 'jpeg', '-s', 'formatOptions', '76',
                 str(source), '--out', str(target)],
                capture_output=True, timeout=12, check=False,
            )
            if converted.returncode != 0 or not target.is_file():
                raise ValueError(DOG_PHOTO_ERROR)
            return upright_jpeg(target.read_bytes())
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError('เปิดรูปนี้ไม่ได้ กรุณาลองเลือกรูปอื่น') from exc


register_auth(app, conn, read_photo_upload)


def save_dog_photo(db, dog_id, photo):
    if photo is not None:
        db.execute("""INSERT INTO dog_photos(dog_id,photo) VALUES(?,?)
                      ON CONFLICT(dog_id) DO UPDATE SET photo=excluded.photo""", (dog_id, photo))


@app.get('/dogs/<int:dog_id>/photo')
def dog_photo(dog_id):
    with conn() as db:
        row = db.execute('SELECT photo FROM dog_photos WHERE dog_id=?', (dog_id,)).fetchone()
    if row is None:
        abort(404)
    return Response(row['photo'], mimetype='image/jpeg',
                    headers={'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'})


@app.post('/stays/contacts')
def stay_contacts():
    form = request.form
    mode = form.get('mode')
    owner_name = form.get('customer_name', '').strip()
    dog_name = form.get('dog_name', '').strip()
    size = form.get('size', 'small')
    if mode not in ('customer', 'edit_customer', 'dog'):
        return jsonify(error='กรุณาเลือกประเภทข้อมูล'), 400
    if mode != 'dog' and not owner_name:
        return jsonify(error='กรุณากรอกชื่อลูกค้า'), 400
    if mode == 'dog' and not dog_name:
        return jsonify(error='กรุณากรอกชื่อสุนัข'), 400
    if mode == 'edit_customer':
        dog_name = ''
    if dog_name and size not in ('small', 'medium', 'large'):
        return jsonify(error='กรุณาเลือกขนาดสุนัข'), 400

    try:
        photo = uploaded_dog_photo()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    if photo and not dog_name:
        return jsonify(error='กรุณากรอกชื่อสุนัขสำหรับรูปที่เลือก'), 400

    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        if mode == 'customer':
            customer_id = insert_customer(db, owner_name, form.get('contact', '').strip(), details=customer_details(form))
        else:
            customer_id = form.get('customer_id', type=int)
            customer = db.execute('SELECT * FROM customers WHERE id=? AND archived=0', (customer_id,)).fetchone()
            if customer is None:
                return jsonify(error='กรุณาเลือกลูกค้าก่อนเพิ่มสุนัข'), 400
            if mode == 'edit_customer':
                update_customer(db, customer, owner_name, form)
            else:
                owner_name = customer['name']
        dog = None
        if dog_name:
            dog_id = insert_dog(db, customer_id, dog_name, size)
            save_dog_photo(db, dog_id, photo)
            dog = dict(id=dog_id, name=dog_name, customer_id=customer_id, size=size,
                       profile_url=url_for('dog_profile_modal', cid=customer_id, dog_id=dog_id),
                       photo_url=url_for('dog_photo', dog_id=dog_id) if photo else None)
        customer = db.execute('SELECT * FROM customers WHERE id=?', (customer_id,)).fetchone()
    return jsonify(customer=dict(id=customer_id, name=owner_name, contact=customer['contact'],
                                 **{key: customer[key] for key in CUSTOMER_DETAIL_FIELDS}),
                   dog=dog), 200 if mode == 'edit_customer' else 201


DOG_SIZES = {'small': 'เล็ก', 'medium': 'กลาง', 'large': 'ใหญ่'}


@app.route('/customers', methods=['GET', 'POST'])
def customers():
    with conn() as db:
        if request.method == 'POST':
            name = request.form.get('name', '').strip()
            if not name:
                abort(400)
            insert_customer(db, name, request.form.get('contact', ''), request.form.get('note', ''), customer_details(request.form))
            flash('เพิ่มลูกค้าแล้ว', 'ok')
            return redirect(url_for('customers'))
        rows = db.execute("""SELECT c.*, (SELECT COUNT(*) FROM dogs d
                                         WHERE d.customer_id=c.id AND d.archived=0) dog_count
                             FROM customers c WHERE c.archived=0 ORDER BY c.id DESC""").fetchall()
    return render_template('customers.html', rows=rows)


@app.route('/customers/<int:cid>', methods=['GET', 'POST'])
def customer_detail(cid):
    photo = None
    if request.method == 'POST' and request.form.get('action') == 'dog':
        try:
            photo = uploaded_dog_photo()
        except ValueError as exc:
            flash(str(exc), 'error')
            return redirect(url_for('customer_detail', cid=cid))
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        customer = db.execute('SELECT * FROM customers WHERE id=?', (cid,)).fetchone()
        if not customer:
            abort(404)
        if request.method == 'POST':
            if customer['archived']:
                abort(404)
            form = request.form
            if form.get('action') == 'dog':
                name = form.get('dog_name', '').strip()
                size = form.get('size', 'small')
                if not name or size not in DOG_SIZES:
                    abort(400)
                dog_id = insert_dog(db, cid, name, size, form.get('note', ''))
                try:
                    profile = read_dog_profile(form, date.today())
                except (ValueError, OverflowError):
                    abort(400, description=translate('กรุณาตรวจวันเกิด อายุ และข้อมูลสุนัข'))
                db.execute('UPDATE dogs SET profile=? WHERE id=?', (encode(profile), dog_id))
                save_dog_photo(db, dog_id, photo)
            else:
                name = form.get('name', '').strip()
                if not name:
                    abort(400)
                update_customer(db, customer, name, form)
            flash('บันทึกแล้ว', 'ok')
            return redirect(url_for('customer_detail', cid=cid))
        dogs = db.execute('''SELECT d.*, p.dog_id IS NOT NULL has_photo FROM dogs d
                             LEFT JOIN dog_photos p ON p.dog_id=d.id
                             WHERE d.customer_id=? AND d.archived=0 ORDER BY d.name''',
                          (cid,)).fetchall()
        history = db.execute(STAY_HISTORY_SELECT.format(extra=f", {STAY_BALANCE_SQL} AS due_cents") + '''
                             WHERE s.customer_id=? ORDER BY s.checkin DESC,s.id DESC''', (cid,)).fetchall()
    return render_template('customer_detail.html', customer=customer,
                           dogs=[dog_profile_row(dog, date.today()) for dog in dogs],
                           sizes=DOG_SIZES, profile_groups=PROFILE_GROUPS,
                           history=history, outstanding=[row for row in history if row['due_cents'] > 0],
                           stay_statuses=STAY_STATUSES)


@app.post('/customers/<int:cid>/delete')
def customer_delete(cid):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        if not db.execute('SELECT 1 FROM customers WHERE id=? AND archived=0', (cid,)).fetchone():
            abort(404)
        has_history = db.execute("""SELECT 1 FROM stays WHERE customer_id=?
                                    UNION ALL SELECT 1 FROM transactions WHERE customer_id=?
                                    UNION ALL SELECT 1 FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
                                    WHERE d.customer_id=?
                                    UNION ALL SELECT 1 FROM appointments WHERE customer_id=?
                                    UNION ALL SELECT 1 FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id
                                    WHERE d.customer_id=?
                                    UNION ALL SELECT 1 FROM stay_consents WHERE customer_id=? LIMIT 1""",
                                 (cid, cid, cid, cid, cid, cid)).fetchone()
        if has_history:
            db.execute('UPDATE customers SET archived=1 WHERE id=?', (cid,))
            flash('นำลูกค้าและสุนัขออกจากรายการใช้งานแล้ว ประวัติเดิมยังเปิดดูได้', 'ok')
        else:
            db.execute('DELETE FROM dogs WHERE customer_id=?', (cid,))
            db.execute('DELETE FROM customers WHERE id=?', (cid,))
            flash('ลบลูกค้าและสุนัขของลูกค้าแล้ว', 'ok')
    return redirect(url_for('customers'))


@app.get('/customers/<int:cid>/dogs/<int:dog_id>/profile')
def dog_profile_modal(cid, dog_id):
    with conn() as db:
        dog = db.execute("""SELECT d.* FROM dogs d JOIN customers c ON c.id=d.customer_id
                            WHERE d.id=? AND d.customer_id=? AND d.archived=0 AND c.archived=0""",
                         (dog_id, cid)).fetchone()
    if dog is None:
        abort(404)
    return render_template('_dog_profile_modal.html', dog=dog_profile_row(dog, date.today()),
                           sizes=DOG_SIZES, profile_groups=PROFILE_GROUPS)


@app.post('/customers/<int:cid>/dogs/<int:dog_id>/<action>')
def manage_dog(cid, dog_id, action):
    if action not in ('edit', 'delete'):
        abort(404)
    ajax = request.accept_mimetypes.best == 'application/json'
    photo = None
    profile = None
    if action == 'edit':
        try:
            photo = uploaded_dog_photo()
            if 'profile_fields' in request.form:
                try:
                    profile = read_dog_profile(request.form, date.today())
                except (ValueError, OverflowError) as exc:
                    raise ValueError('กรุณาตรวจวันเกิด อายุ และข้อมูลสุนัข') from exc
        except ValueError as exc:
            if ajax:
                return jsonify(error=translate(str(exc))), 400
            flash(str(exc), 'error')
            return redirect(url_for('customer_detail', cid=cid))
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        dog = db.execute("""SELECT d.id FROM dogs d JOIN customers c ON c.id=d.customer_id
                            WHERE d.id=? AND d.customer_id=? AND d.archived=0 AND c.archived=0""",
                         (dog_id, cid)).fetchone()
        if not dog:
            abort(404)
        if action == 'edit':
            name = request.form.get('dog_name', '').strip()
            size = request.form.get('size', '')
            if not name or size not in DOG_SIZES:
                if ajax:
                    return jsonify(error=translate('กรุณาตรวจชื่อและขนาดสุนัข')), 400
                abort(400)
            db.execute('UPDATE dogs SET name=?,size=?,note=? WHERE id=?',
                       (name, size, request.form.get('note', ''), dog_id))
            if profile is not None:
                db.execute('UPDATE dogs SET profile=? WHERE id=?', (encode(profile), dog_id))
            save_dog_photo(db, dog_id, photo)
            if ajax:
                row = db.execute('SELECT * FROM dogs WHERE id=?', (dog_id,)).fetchone()
                profile_html = render_template('_dog_profile_summary.html',
                                               dog=dog_profile_row(row, date.today()),
                                               profile_groups=PROFILE_GROUPS)
                return jsonify(name=name, profile_html=profile_html,
                               photo_url=url_for('dog_photo', dog_id=dog_id) if photo else None)
            flash('แก้ไขข้อมูลสุนัขแล้ว', 'ok')
        elif db.execute('''SELECT 1 FROM stay_dogs WHERE dog_id=?
                          UNION ALL SELECT 1 FROM appointment_dogs WHERE dog_id=?
                          UNION ALL SELECT 1 FROM care_events WHERE dog_id=? LIMIT 1''',
                        (dog_id, dog_id, dog_id)).fetchone():
            db.execute('UPDATE dogs SET archived=1 WHERE id=?', (dog_id,))
            flash('นำสุนัขออกจากรายการใช้งานแล้ว ประวัติเดิมยังเปิดดูได้', 'ok')
        else:
            db.execute('DELETE FROM dogs WHERE id=?', (dog_id,))
            flash('ลบสุนัขแล้ว', 'ok')
    return redirect(url_for('customer_detail', cid=cid))


STAY_BALANCE_SQL = """
    CASE WHEN s.payment_tracking=1 AND s.status!='cancelled' AND s.cancelled_at IS NULL THEN
        MAX(0, ROUND(s.agreed_total*100) - COALESCE((
            SELECT SUM(ROUND(t.amount*100)) FROM transactions t
            WHERE t.stay_id=s.id AND t.payment_type!=''
        ), 0))
    ELSE 0 END
"""

STAY_HISTORY_SELECT = """
    SELECT s.*, c.name customer, COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact,
           COALESCE(json_extract(s.intake,'$.service_type'),'overnight') AS service_type,
           (SELECT group_concat(d.name, ', ') FROM stay_dogs sd
            JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=s.id) dog_names{extra}
    FROM stays s JOIN customers c ON c.id=s.customer_id
"""

STAY_STATUSES = {'booked': 'จอง', 'checked_in': 'เข้าพัก', 'completed': 'กลับบ้านแล้ว', 'cancelled': 'ยกเลิกแล้ว'}


def money_cents(value):
    amount = Decimal(value)
    if not amount.is_finite() or not 0 <= amount <= 999999999:
        raise ValueError
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise ValueError
    return int(cents)


PAYMENT_LABELS = {'deposit': 'มัดจำ', 'checkin': 'ชำระวันเข้าพัก', 'additional': 'ชำระเพิ่มเติม'}


def payment_rows(db, *, stay_id=None, appointment_id=None):
    key, value = ('stay_id', stay_id) if stay_id is not None else ('deposit_appointment_id', appointment_id)
    return db.execute(f"""SELECT id, occurred_on, received_time, payment_type, amount FROM transactions
                           WHERE {key}=? AND payment_type!='' ORDER BY occurred_on,received_time,id""", (value,)).fetchall()


def payment_details(rows):
    return [dict(row, label=PAYMENT_LABELS[row['payment_type']]) for row in rows]


def stay_payment_recorded(db, stay_id, key):
    return db.execute("""SELECT 1 FROM transactions WHERE stay_id=? AND payment_key=?
                         UNION ALL SELECT 1 FROM stay_payment_deletions WHERE stay_id=? AND payment_key=?""",
                      (stay_id, key, stay_id, key)).fetchone() is not None


def payment_time(value):
    if not value:
        return now_local().strftime('%H:%M')
    if len(value) != 5 or value[2] != ':':
        raise ValueError('Invalid payment time')
    return time.fromisoformat(value).strftime('%H:%M')


def save_payment(db, kind, cents, day, customer_id, *, stay_id=None, appointment_id=None, payment_key=None, received_time=None):
    if cents:
        db.execute("""INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,
                                               stay_id,payment_method,deposit_appointment_id,payment_type,payment_key,received_time)
                      VALUES(?,'income','ค่าฝากเลี้ยง',?,?,?,?,'',?,?,?,?)""",
                   (day, PAYMENT_LABELS[kind], cents/100, customer_id, stay_id, appointment_id, kind, payment_key, received_time))


def sync_stay_income(db, stay):
    if stay['payment_tracking']:
        return True
    existing = db.execute('SELECT id FROM transactions WHERE stay_id=? AND auto_stay=1',
                          (stay['id'],)).fetchone()
    if existing:
        amount = stay['agreed_total'] if stay['status'] != 'cancelled' else 0
        db.execute('UPDATE transactions SET amount=?, customer_id=? WHERE id=?',
                   (amount, stay['customer_id'], existing['id']))
        return True
    if db.execute("SELECT 1 FROM transactions WHERE stay_id=? AND kind='income'", (stay['id'],)).fetchone():
        return False
    if stay['status'] != 'cancelled':
        db.execute("""INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,
                                               stay_id,payment_method,auto_stay)
                      VALUES(?, 'income', 'ค่าฝากเลี้ยง', ?, ?, ?, ?, '', 1)""",
                   (date.today().isoformat(), f"ค่าฝากเลี้ยง #{stay['id']}", stay['agreed_total'],
                    stay['customer_id'], stay['id']))
    return True


def booking_tables(is_appointment):
    if is_appointment:
        return 'appointments', 'appointment_dogs', 'appointment_id'
    return 'stays', 'stay_dogs', 'stay_id'


def save_booking(db, original, *, is_appointment=False, from_appointment=False):
    table, link, key = booking_tables(is_appointment)
    _, source_link, source_key = booking_tables(is_appointment or from_appointment)
    record_id = original['id'] if original and not from_appointment else None
    form = request.form
    create_key = form.get('create_key') if record_id is None and not from_appointment else None
    if record_id is None and not from_appointment:
        if not create_key or len(create_key) != 32 or any(char not in '0123456789abcdef' for char in create_key):
            return None, 'กรุณาเปิดแบบฟอร์มใหม่แล้วลองอีกครั้ง'
        previous = db.execute(f'SELECT id FROM {table} WHERE create_key=?', (create_key,)).fetchone()
        if previous:
            flash('บันทึกรายการนี้แล้ว', 'ok')
            return previous['id'], None
    service_type = form.get('service_type', original['service_type'] if is_appointment and original else 'overnight')
    try:
        customer_id = int(form['customer_id'])
        checkin = date.fromisoformat(form['checkin'])
        checkout = date.fromisoformat(form['checkout'])
        quantity = Decimal(form['charged_nights']) if service_type == 'monthly' else Decimal(int(form['charged_nights']))
        if not quantity.is_finite() or not 0 <= quantity <= 36600 or quantity*100 != (quantity*100).to_integral_value():
            raise ValueError
        hundredths = int(quantity*100)
        nights = hundredths/100 if hundredths % 100 else hundredths//100
        status = 'pending' if is_appointment else ('checked_in' if from_appointment else form['status'])
        discount = money_cents(form.get('discount') or '0')
        rates = {}
        for dog in form.getlist('dog_ids'):
            rate = form.get(f'rate_{dog}', '')
            rates[int(dog)] = None if is_appointment and not rate else money_cents(rate)
    except (ValueError, InvalidOperation, KeyError):
        return None, 'กรุณากรอกวันเข้าพัก จำนวนคืน และราคา/คืนให้ถูกต้อง'
    if is_appointment and service_type not in SERVICES:
        return None, 'กรุณาเลือกประเภทบริการ'
    if checkout < checkin or not 0 <= nights <= 36600 or (not is_appointment and status not in STAY_STATUSES) or not rates:
        return None, 'กรุณาตรวจวันที่ จำนวนคืน สถานะ และเลือกสุนัขอย่างน้อยหนึ่งตัว'
    if not is_appointment and status == 'cancelled':
        return None, 'กรุณายกเลิกพร้อมเหตุผลจากหน้าสรุปการเข้าพัก'
    if record_id and not is_appointment and original['status'] == 'completed' and status != 'completed':
        return None, 'ใช้ปุ่มเช็กอินอีกครั้งเพื่อยกเลิกการเช็กเอาต์'
    if from_appointment and checkin > now_local().date():
        return None, 'วันเช็กอินจริงต้องเป็นวันนี้หรือก่อนหน้า'
    owner = db.execute('SELECT name, archived FROM customers WHERE id=?', (customer_id,)).fetchone()
    same_owner = original is not None and original['customer_id'] == customer_id
    if owner is None or (owner['archived'] and not same_owner):
        return None, 'กรุณาเลือกลูกค้าที่อยู่ในรายการใช้งาน'
    owned = {row['id'] for row in db.execute(
        f"""SELECT id FROM dogs WHERE customer_id=? AND (
              (archived=0 AND ?=0) OR id IN (SELECT dog_id FROM {source_link} WHERE {source_key}=?)
           )""", (customer_id, owner['archived'], original['id'] if original else None))}
    if not rates.keys() <= owned:
        return None, 'กรุณาเลือกเฉพาะสุนัขของลูกค้ารายนี้'
    if not is_appointment and status == 'cancelled' and (not original or original['status'] != 'cancelled'):
        if record_id and has_stay_receipts(db, record_id):
            return None, 'กรุณายกเลิกพร้อมเหตุผลจากหน้าสรุปการเข้าพัก'
    if record_id and not is_appointment and original['cancelled_at']:
        return None, 'รายการที่ยกเลิกพร้อมเหตุผลแล้วไม่สามารถเปิดใหม่ได้'
    if 'booking_warning_check' in form and status not in ('completed','cancelled'):
        warnings, token = booking_warnings(
            db, checkin.isoformat(), checkout.isoformat(), rates,
            appointment_id=original['id'] if original and (is_appointment or from_appointment) else None,
            stay_id=record_id if not is_appointment else None, capacity=get_setting(db,'capacity',0))
        if warnings and (form.get('booking_warning_token') != token or form.get('booking_warning_override') != '1'):
            g.booking_warning = (warnings, token)
            return None, 'ตรวจพบเงื่อนไขที่ควรตรวจสอบก่อนบันทึก'
    subtotal = sum(((rate or 0)*hundredths+50)//100 for rate in rates.values())
    coupon = None
    applied_discount = 0
    if not is_appointment:
        previous_coupon = stay_coupon(db, record_id)
        code = form.get('coupon_code', previous_coupon['code'] if previous_coupon else '').strip()
        if 'coupon_code' not in form and previous_coupon:
            discount = max(0, discount - previous_coupon['discount_cents'])
        if code:
            try:
                coupon = find_coupon(db, code, record_id)
                applied_discount = (previous_coupon['discount_cents']
                                    if previous_coupon and previous_coupon['code'] == code
                                    else coupon_discount(coupon, subtotal))
            except ValueError as exc:
                return None, str(exc)
            discount += applied_discount
    if discount > subtotal and None not in rates.values():
        return None, 'ส่วนลดต้องไม่เกินยอดก่อนลด'

    appointment_id = original['id'] if original and (is_appointment or from_appointment) else None
    existing_payments = payment_rows(db, appointment_id=appointment_id) if appointment_id else (
        payment_rows(db, stay_id=record_id) if record_id and not is_appointment else [])
    tracking = not is_appointment and (
        (record_id is None and ('payment_amount' in form or existing_payments))
        or (record_id is not None and original['payment_tracking'])
    )
    payment_key = form.get('payment_key') or None
    if is_appointment and appointment_id and payment_key and db.execute(
            'SELECT 1 FROM transactions WHERE deposit_appointment_id=? AND payment_key=?',
            (appointment_id, payment_key)).fetchone():
        return appointment_id, None
    if tracking and record_id is not None and payment_key and stay_payment_recorded(db, record_id, payment_key):
        return record_id, None
    paid_cents = sum(round(row['amount']*100) for row in existing_payments)
    raw_net = max(0, subtotal-discount)
    # Preserve historical totals when the bill itself has not changed.
    unchanged_total = (original and round(original['agreed_total']*100) + original['rounding_cents'] == raw_net
                       and original['discount_cents'] == discount and not from_appointment)
    net_cents = (round(original['agreed_total']*100) if unchanged_total
                 else raw_net//100*100 if form.get('whole_baht') == '1' else raw_net)
    rounding_cents = raw_net-net_cents
    received_time = None
    try:
        if is_appointment and 'deposit_amount' in form:
            received = money_cents(form.get('deposit_amount') or '0')
            payment_day = date.fromisoformat(form.get('deposit_date') or now_local().date().isoformat())
            if received:
                received_time = payment_time(form.get('deposit_time'))
        elif tracking:
            received = money_cents(form.get('payment_amount') or '0')
            payment_day = date.fromisoformat(form.get('payment_date') or now_local().date().isoformat())
            if received:
                received_time = payment_time(form.get('payment_time'))
        else:
            received = 0
            payment_day = now_local().date()
    except (ValueError, InvalidOperation):
        return None, 'กรุณาตรวจยอดและวันที่ชำระเงิน'
    if payment_day > now_local().date():
        return None, 'วันที่รับชำระต้องเป็นวันนี้หรือก่อนหน้า'
    if (is_appointment and None not in rates.values() and paid_cents+received > net_cents
            or tracking and paid_cents+received > net_cents):
        return None, 'ยอดชำระรวมต้องไม่เกินยอดสุทธิ'
    if not same_owner and existing_payments:
        return None, 'กรุณาใช้ลูกค้าเดิมสำหรับรายการที่มีการชำระแล้ว'

    intake = None
    if not is_appointment and 'intake_fields' in form:
        try:
            intake = read_optional_fields(form, INTAKE_GROUPS)
            if original and not from_appointment:
                previous = json.loads(original['intake'])
                intake.update({key: previous[key] for key in (*CUSTOMER_DETAIL_FIELDS, 'received_by', 'received_on')
                               if key in previous})
        except ValueError:
            return None, 'กรุณาตรวจข้อมูลรายละเอียดตอนเช็กอิน'

    signature = None
    signed_language = form.get('terms_language', 'th')
    if not is_appointment:
        acknowledged = form.get('terms_ack') == '1'
        raw_signature = form.get('signature', '')
        if record_id is None or not same_owner or acknowledged or raw_signature:
            if not acknowledged:
                return None, 'กรุณาติ๊กรับทราบเงื่อนไขการฝากเลี้ยง'
            if signed_language not in LANGUAGES or form.get('terms_version') != TERMS_VERSIONS[signed_language]:
                return None, 'เงื่อนไขมีการอัปเดต กรุณาอ่านและเซ็นใหม่'
            signature = parse_signature(raw_signature)
            if signature is None:
                return None, 'กรุณาให้ลูกค้าเซ็นลายเซ็นในช่องที่กำหนด'

    values = (customer_id, checkin.isoformat(), checkout.isoformat(), nights,
              net_cents/100, status, form.get('note', ''), discount)
    if record_id is None:
        record_id = db.execute(f"""INSERT INTO {table}(customer_id,checkin,checkout,charged_nights,agreed_total,
                                                  status,note,discount_cents,create_key) VALUES(?,?,?,?,?,?,?,?,?)""",
                             (*values, create_key)).lastrowid
        if is_appointment:
            assign_reference_code(db, 'appointments', 'booking_number', record_id)
            db.execute('UPDATE appointments SET booked_at=? WHERE id=?', (now_local().isoformat(timespec='seconds'), record_id))
    else:
        db.execute(f"""UPDATE {table} SET customer_id=?,checkin=?,checkout=?,charged_nights=?,agreed_total=?,
                                       status=?,note=?,discount_cents=? WHERE id=?""", (*values, record_id))
        db.execute(f'DELETE FROM {link} WHERE {key}=?', (record_id,))
    db.execute(f'UPDATE {table} SET rounding_cents=? WHERE id=?', (rounding_cents, record_id))
    db.executemany(f'INSERT INTO {link}({key},dog_id,nightly_rate_cents) VALUES(?,?,?)',
                   ((record_id, dog, rate) for dog, rate in rates.items()))
    if is_appointment:
        db.execute('UPDATE appointments SET service_type=? WHERE id=?', (service_type, record_id))
        if 'deposit_amount' in form:
            save_payment(db, 'deposit', received, payment_day.isoformat(), customer_id,
                         appointment_id=record_id, payment_key=payment_key, received_time=received_time)
        flash('บันทึกการจองแล้ว', 'ok')
    else:
        if original and not from_appointment:
            if not same_owner or status in ('booked','cancelled') or (
                    status == 'checked_in' and original['status'] != 'checked_in'):
                db.execute('DELETE FROM care_share_links WHERE stay_id=?', (record_id,))
            else:
                db.execute("""DELETE FROM care_share_links WHERE stay_id=? AND NOT EXISTS (
                    SELECT 1 FROM stay_dogs sd WHERE sd.stay_id=care_share_links.stay_id
                    AND sd.dog_id=care_share_links.dog_id)""", (record_id,))
        recorded_at = now_local().isoformat(timespec='seconds')
        if status == 'checked_in' and (not original or original['status'] != 'checked_in'):
            arrival_time = (intake or {}).get('arrival_time')
            actual_arrival = recorded_at
            if checkin < now_local().date():
                actual_arrival = (f'{checkin}T{arrival_time}:00+07:00' if arrival_time else checkin.isoformat())
            db.execute('UPDATE stays SET actual_checkin_at=COALESCE(actual_checkin_at,?),actual_checkout_at=NULL WHERE id=?',
                       (actual_arrival, record_id))
        elif status == 'completed':
            db.execute('UPDATE stays SET actual_checkout_at=COALESCE(actual_checkout_at,?) WHERE id=?',
                       (recorded_at, record_id))
        if status in ('checked_in', 'completed'):
            assign_reference_code(db, 'stays', 'stay_number', record_id)
        db.execute('DELETE FROM coupon_uses WHERE stay_id=?', (record_id,))
        if coupon is not None:
            used_at = (previous_coupon['used_at'] if previous_coupon and previous_coupon['code'] == code
                       else datetime.now(ZoneInfo('Asia/Bangkok')).isoformat(timespec='seconds'))
            db.execute('INSERT INTO coupon_uses(stay_id,coupon_id,discount_cents,used_at) VALUES(?,?,?,?)',
                       (record_id, coupon['id'], applied_discount, used_at))
        if intake is not None:
            db.execute('UPDATE stays SET intake=? WHERE id=?', (encode(intake), record_id))
        if signature is not None:
            signed_at = datetime.now(ZoneInfo('Asia/Bangkok')).isoformat(timespec='seconds')
            db.execute("""INSERT INTO stay_consents(stay_id,customer_id,customer_name,signed_at,terms,signature,signed_language,terms_en)
                          VALUES(?,?,?,?,?,?,?,?)""", (record_id, customer_id, owner['name'], signed_at,
                                                       TERMS_SNAPSHOT, json.dumps(signature),
                                                       signed_language, TERMS_EN_SNAPSHOT))
        if tracking:
            db.execute('UPDATE stays SET payment_tracking=1 WHERE id=?', (record_id,))
            if from_appointment and existing_payments:
                db.execute('UPDATE transactions SET stay_id=? WHERE deposit_appointment_id=?',
                           (record_id, appointment_id))
            save_payment(db, 'checkin' if not original or from_appointment else 'additional', received, payment_day.isoformat(),
                         customer_id, stay_id=record_id, payment_key=payment_key, received_time=received_time)
        stay = db.execute('SELECT * FROM stays WHERE id=?', (record_id,)).fetchone()
        if from_appointment:
            db.execute('UPDATE appointments SET stay_id=? WHERE id=?', (record_id, original['id']))
        synced = sync_stay_income(db, stay)
        flash('บันทึกการเข้าพักแล้ว' if synced else 'บันทึกการเข้าพักแล้ว รายรับที่เคยลงเองยังใช้ยอดเดิม', 'ok')
    return record_id, None


def latest_stay_consent(db, stay):
    row = db.execute("""SELECT customer_name,signed_at,terms,signature,signed_language,terms_en FROM stay_consents
                        WHERE stay_id=? AND customer_id=? ORDER BY id DESC LIMIT 1""",
                     (stay['id'], stay['customer_id'])).fetchone()
    if not row:
        return None
    terms = json.loads(row['terms'])
    english = json.loads(row['terms_en']) if row['terms_en'] else translated_terms(terms, 'en')
    return dict(row, terms=terms, terms_en=english, strokes=json.loads(row['signature']))


def booking_fields(db, original, mode='stay'):
    _, link, key = booking_tables(mode != 'stay')
    record_id = original['id'] if original else None
    rates = {str(row['dog_id']): row['nightly_rate_cents'] for row in db.execute(
        f'SELECT dog_id,nightly_rate_cents FROM {link} WHERE {key}=?', (record_id,))}
    customers = db.execute('SELECT * FROM customers WHERE archived=0 OR id=? ORDER BY name',
                           (original['customer_id'] if original else None,)).fetchall()
    dogs = db.execute(f"""SELECT d.*,p.dog_id IS NOT NULL has_photo,c.archived owner_archived
                         FROM dogs d JOIN customers c ON c.id=d.customer_id
                         LEFT JOIN dog_photos p ON p.dog_id=d.id
                         WHERE (d.archived=0 AND c.archived=0)
                            OR d.id IN (SELECT dog_id FROM {link} WHERE {key}=?)
                         ORDER BY d.name""", (record_id,)).fetchall()
    consent = latest_stay_consent(db, original) if mode == 'stay' and original else None
    draft_signature = None
    acknowledged = False
    lang = language()
    if request.method == 'POST' and request.form.get('terms_version') == TERMS_VERSIONS[lang]:
        draft_signature = parse_signature(request.form.get('signature'))
        acknowledged = request.form.get('terms_ack') == '1'
    now = datetime.now(ZoneInfo('Asia/Bangkok'))
    new_checkin = mode == 'conversion' or (mode == 'stay' and not original)
    intake_defaults = dict(arrival_time=now.strftime('%H:%M'), pickup_time=now.strftime('%H:%M'),
                           service_type=original['service_type'] if mode == 'conversion' else 'overnight') if new_checkin else {}
    intake = (request.form if request.method == 'POST' else
              json.loads(original['intake']) if mode == 'stay' and original else intake_defaults)
    payments = (payment_rows(db, appointment_id=original['id']) if mode in ('appointment', 'conversion') and original
                else payment_rows(db, stay_id=original['id']) if original else [])
    selected_service = intake.get('service_type') if mode != 'appointment' else request.form.get(
        'service_type', original['service_type'] if original else 'overnight')
    saved_coupon = stay_coupon(db, record_id) if mode == 'stay' and record_id else None
    return dict(saved_coupon=saved_coupon, payments=payments, payment_labels=PAYMENT_LABELS, customers=customers, dogs=[dict(dog_profile_row(dog, date.today()),
                                              can_edit=not dog['archived'] and not dog['owner_archived'])
                                          for dog in dogs], rates=rates, stay=original, statuses=STAY_STATUSES,
                profile_groups=PROFILE_GROUPS, intake_groups=INTAKE_GROUPS, intake=intake,
                current_checkin_day=now.date().isoformat(), current_payment_time=now.strftime('%H:%M'), default_dog_rates=configured_rates(db),
                services=SERVICES, service_type=selected_service if selected_service in SERVICES else 'overnight',
                submitted=request.form if request.method == 'POST' else None,
                create_key=secrets.token_hex(16), mode=mode, terms=consent_terms(None, lang), terms_version=TERMS_VERSIONS[lang],
                consent=consent, signed_terms=consent_terms(consent, lang), draft_signature=draft_signature, acknowledged=acknowledged)


def reference_search():
    return request.args.get('q', '').strip()[:120] or None


def search_reference_rows(rows, query, *fields):
    if not query:
        return rows
    term = query.casefold()
    return [row for row in rows if any(term in (row[field] or '').casefold() for field in fields)]


def stay_history_period():
    current = now_local().date()
    start = date.fromisoformat(request.args.get('start', current.replace(day=1).isoformat()))
    end = date.fromisoformat(request.args.get('end', (next_month(current)-timedelta(days=1)).isoformat()))
    return dict(start=min(start,end).isoformat(), end=max(start,end).isoformat(), q=reference_search())


def stay_history_rows(db, period, history_status=None):
    rows = db.execute(STAY_HISTORY_SELECT.format(extra=f", {STAY_BALANCE_SQL} AS due_cents") + """
                      WHERE s.checkin<=? AND s.checkout>=? AND (? IS NULL OR s.status=?)
                        AND s.status<>'cancelled' AND s.cancelled_at IS NULL
                      ORDER BY s.checkin DESC,s.id DESC""",
                      (period['end'], period['start'], history_status, history_status)).fetchall()
    return search_reference_rows(rows, period['q'], 'stay_number', 'customer', 'dog_names')


@app.get('/stays/history')
def stay_history():
    try:
        period = stay_history_period()
    except ValueError:
        return redirect(url_for('stay_history'))
    history_status = request.args.get('status')
    if history_status not in ('checked_in', 'completed'):
        history_status = None
    with conn() as db:
        rows = stay_history_rows(db, period, history_status)
    return render_template('stay_history.html', rows=rows, period=period,
                           statuses=STAY_STATUSES, history_status=history_status)


def stay_history_return():
    endpoint = 'stay_history' if request.args.get('origin') == 'history' else 'stays'
    return url_for(endpoint, start=request.args.get('start'), end=request.args.get('end'),
                   status=request.args.get('status') if endpoint == 'stay_history' else None, q=reference_search(), _anchor='stay-history')


def completed_stay_redirect(sid, target=None):
    flash('รายการนี้เช็กเอาต์แล้ว กรุณาเช็กอินอีกครั้งก่อนแก้ไข', 'error')
    return redirect(target or url_for('stay_summary', sid=sid))


@app.route('/stays', methods=['GET', 'POST'], defaults={'stay_id': None})
@app.route('/stays/<int:stay_id>/edit', methods=['GET', 'POST'])
def stays(stay_id):
    try:
        period = stay_history_period()
    except ValueError:
        return redirect(url_for('stays', stay_id=stay_id))
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT * FROM stays WHERE id=?', (stay_id,)).fetchone() if stay_id else None
        if stay_id is not None and stay is None:
            abort(404)
        if stay is not None and stay['status'] == 'completed':
            return completed_stay_redirect(stay_id, url_for('stay_summary', sid=stay_id,
                                           status=request.args.get('status'), **period))
        if request.method == 'POST':
            record_id, error = save_booking(db, stay)
            if not error:
                return redirect(url_for('stay_summary', sid=record_id, status=request.args.get('status'),
                                        **(period if request.args.get('start') or request.args.get('end') else {})))
            flash(error, 'error')
        fields = booking_fields(db, stay)
        rows = stay_history_rows(db, period)
    return render_template('stays.html', rows=rows, period=period, **fields)


def stay_summary_data(db, sid, *, include_photos=False):
    stay = db.execute(STAY_HISTORY_SELECT.format(extra=f", {STAY_BALANCE_SQL} AS due_cents") + ' WHERE s.id=?', (sid,)).fetchone()
    if stay is None:
        abort(404)
    photo_column = ",p.photo" if include_photos else ""
    dogs = db.execute(f"""SELECT d.id,d.name,sd.nightly_rate_cents,p.dog_id IS NOT NULL has_photo{photo_column}
                         FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
                         LEFT JOIN dog_photos p ON p.dog_id=d.id
                         WHERE sd.stay_id=? ORDER BY d.name,d.id""", (sid,)).fetchall()
    linked = db.execute('SELECT id,booking_number FROM appointments WHERE stay_id=?', (sid,)).fetchone()
    details = dict(stay, payments=payment_details(payment_rows(db, stay_id=sid)),
                   booking_number=linked['booking_number'] if linked else None,
                   appointment_id=linked['id'] if linked else None)
    return details, dogs, STAY_STATUSES.get(stay['status'], stay['status'])


@app.get('/stays/<int:sid>/summary')
def stay_summary(sid):
    with conn() as db:
        db.execute('BEGIN')
        stay, dogs, status = stay_summary_data(db, sid)
        consent = latest_stay_consent(db, stay)
        refundable = max(0, recorded_receipts(db,sid))/100
        care_history = db.execute('''SELECT e.*,d.name dog,(SELECT group_concat(id) FROM care_photos WHERE event_id=e.id) photos
                                     FROM care_events e JOIN dogs d ON d.id=e.dog_id
                                     WHERE e.stay_id=? ORDER BY e.recorded_at DESC,e.id DESC''',(sid,)).fetchall()
        care_options = care_activity_options(db)
        refunds = db.execute("SELECT occurred_on,amount,note FROM transactions WHERE stay_id=? AND kind='refund' ORDER BY id DESC",(sid,)).fetchall()
        payment_deletions = payment_details(db.execute(
            'SELECT * FROM stay_payment_deletions WHERE stay_id=? ORDER BY id DESC', (sid,)).fetchall())
    period = {key: request.args.get(key) or stay[column]
              for key, column in (('start', 'checkin'), ('end', 'checkout'))}
    period['q'] = reference_search()
    payment_qr_url = url_for('payment_qr') if payment_qr_path().is_file() else None
    return render_template('stay_summary.html', stay=stay, dogs=dogs, status=status, consent=consent, period=period, receipt_key=secrets.token_hex(16),
                           payment_qr_url=payment_qr_url,
                           payment_deletions=payment_deletions, refundable=refundable, refunds=refunds, care_history=care_history, care_options=care_options,
                           terms=consent_terms(consent, language()),
                           updated_terms=updated_term_sections(consent, language()))


def payment_qr_path():
    path = DATA / PAYMENT_QR_NAME
    return path if path.is_file() else Path(app.static_folder) / PAYMENT_QR_NAME


@app.get('/payment-qr.jpg')
def payment_qr():
    path = payment_qr_path()
    if not path.is_file():
        abort(404)
    response = send_file(path, mimetype='image/jpeg')
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@app.post('/stays/<int:sid>/payments')
def receive_stay_payment(sid):
    target = url_for('stay_summary', sid=sid, start=request.args.get('start'),
                     end=request.args.get('end'), q=reference_search(), _anchor='stay-payment-history')
    form = request.form
    key = form.get('payment_key', '')
    try:
        amount = money_cents(form.get('payment_amount', ''))
        day = date.fromisoformat(form.get('payment_date', ''))
        received_time = payment_time(form.get('payment_time'))
        if not amount or day > coupon_today() or len(key) != 32 or any(c not in '0123456789abcdef' for c in key):
            raise ValueError
    except (ValueError, InvalidOperation):
        flash('กรุณาตรวจยอดและวันที่ชำระเงิน', 'error')
        return redirect(target)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute(f'SELECT s.customer_id, {STAY_BALANCE_SQL} AS due_cents FROM stays s WHERE s.id=?',
                          (sid,)).fetchone()
        if stay is None:
            abort(404)
        if stay_payment_recorded(db, sid, key):
            return redirect(target)
        if amount > stay['due_cents']:
            flash('ยอดรับชำระต้องไม่เกินยอดค้าง', 'error')
            return redirect(target)
        save_payment(db, 'additional', amount, day.isoformat(), stay['customer_id'], stay_id=sid, payment_key=key, received_time=received_time)
    flash('บันทึกรับชำระแล้ว', 'ok')
    return redirect(target)


@app.post('/stays/<int:sid>/payments/<int:payment_id>/delete')
def delete_stay_payment(sid, payment_id):
    target = url_for('stay_summary', sid=sid, start=request.args.get('start'),
                     end=request.args.get('end'), q=reference_search(), _anchor='stay-payment-history')
    reason = request.form.get('reason', '').strip()
    if not 1 <= len(reason) <= 500:
        flash('กรุณาระบุเหตุผลการลบรายการชำระเงิน', 'error')
        return redirect(target)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        payment = db.execute("""SELECT * FROM transactions WHERE id=? AND stay_id=?
                                AND payment_type IN ('deposit','checkin','additional')""",
                             (payment_id, sid)).fetchone()
        if payment is None:
            abort(404)
        stay = db.execute('SELECT status,cancelled_at FROM stays WHERE id=?', (sid,)).fetchone()
        if stay['status'] == 'completed':
            return completed_stay_redirect(sid, target)
        if stay['cancelled_at']:
            flash('รายการที่ยกเลิกแล้วเก็บประวัติการชำระไว้','error')
            return redirect(target)
        deleted_at = datetime.now(ZoneInfo('Asia/Bangkok')).isoformat(timespec='seconds')
        db.execute("""INSERT INTO stay_payment_deletions
                      (stay_id,payment_type,occurred_on,received_time,amount,payment_key,deleted_at,reason)
                      VALUES(?,?,?,?,?,?,?,?)""",
                   (sid, payment['payment_type'], payment['occurred_on'], payment['received_time'],
                    payment['amount'], payment['payment_key'], deleted_at, reason))
        db.execute('DELETE FROM transactions WHERE id=?', (payment_id,))
    flash('ลบรายการชำระเงินแล้ว', 'ok')
    return redirect(target)


@app.get('/stays/<int:sid>/summary.pdf')
def stay_summary_pdf(sid):
    from app.stay_pdf import build_stay_pdf

    with conn() as db:
        db.execute('BEGIN')
        stay, dogs, status = stay_summary_data(db, sid, include_photos=True)
        consent = latest_stay_consent(db, stay)
    pdf_language = request.args.get('lang', language())
    if pdf_language not in LANGUAGES:
        pdf_language = language()
    response = send_file(build_stay_pdf(stay, dogs, status, consent, pdf_language, theme=current_theme()), mimetype='application/pdf',
                         as_attachment=True, download_name=f'little-paws-stay-{sid}-{pdf_language}.pdf')
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['Content-Language'] = pdf_language
    return response


@app.get('/stays/<int:sid>/summary.png')
def stay_summary_image(sid):
    from app.appointment_image import build_booking_image

    with conn() as db:
        db.execute('BEGIN')
        stay, dogs, status = stay_summary_data(db, sid, include_photos=True)
    lang = request.args.get('lang', language())
    if lang not in LANGUAGES:
        lang = language()
    try:
        png = build_booking_image(stay, dogs, status, lang, appointment=False, theme=current_theme())
    except ValueError:
        abort(422, description=translate('ข้อมูลยาวเกินขนาดรูปภาพ กรุณาดาวน์โหลด PDF'))
    return export_download(png, f'little-paws-stay-{sid}-{lang}.png', lang, 'image/png')


def recorded_receipts(db, sid):
    return db.execute("""SELECT COALESCE(SUM(CASE WHEN kind='income' THEN ROUND(amount*100)
                      WHEN kind='refund' THEN -ROUND(amount*100) ELSE 0 END),0)
                      FROM transactions WHERE stay_id=? AND auto_stay=0""", (sid,)).fetchone()[0]


def has_stay_receipts(db, sid):
    return db.execute("SELECT 1 FROM transactions WHERE stay_id=? AND auto_stay=0 AND kind='income' AND amount>0",
                      (sid,)).fetchone() is not None


@app.post('/stays/<int:sid>/cancel')
def cancel_stay(sid):
    reason = request.form.get('reason','').strip()
    target = url_for('stay_summary',sid=sid)
    if not reason or len(reason)>500:
        flash('กรุณาระบุเหตุผลการยกเลิก','error')
        return redirect(target)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT * FROM stays WHERE id=?',(sid,)).fetchone()
        if not stay:
            abort(404)
        if stay['status'] == 'completed':
            return completed_stay_redirect(sid, target)
        if not stay['cancelled_at']:
            cancelled_at = now_local().isoformat(timespec='seconds')
            db.execute("""INSERT INTO stay_payment_deletions
                          (stay_id,payment_type,occurred_on,received_time,amount,payment_key,deleted_at,reason)
                          SELECT stay_id,payment_type,occurred_on,received_time,amount,payment_key,?,?
                          FROM transactions
                          WHERE stay_id=? AND payment_type IN ('deposit','checkin','additional')""",
                       (cancelled_at, reason, sid))
            db.execute("""DELETE FROM transactions
                          WHERE stay_id=? AND payment_type IN ('deposit','checkin','additional')""", (sid,))
            db.execute("UPDATE stays SET status='cancelled',cancel_reason=?,cancelled_at=? WHERE id=?",
                       (reason,cancelled_at,sid))
            db.execute('UPDATE transactions SET amount=0 WHERE stay_id=? AND auto_stay=1',(sid,))
    return redirect(target)


@app.post('/stays/<int:sid>/refund')
def refund_stay(sid):
    target = url_for('stay_summary',sid=sid,_anchor='stay-payment-history')
    try:
        amount = money_cents(request.form.get('amount',''))
        day = date.fromisoformat(request.form.get('date',''))
        reason = request.form.get('reason','').strip()
        key = request.form.get('payment_key','')
        if not amount or day > now_local().date() or not 1<=len(reason)<=500 or len(key)!=32 or any(c not in '0123456789abcdef' for c in key):
            raise ValueError
    except (ValueError,InvalidOperation):
        flash('กรุณาตรวจยอดและวันที่ชำระเงิน','error')
        return redirect(target)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT * FROM stays WHERE id=?',(sid,)).fetchone()
        if stay is None:
            abort(404)
        if stay_payment_recorded(db,sid,key):
            return redirect(target)
        if not stay['cancelled_at'] or amount > recorded_receipts(db,sid):
            flash('ยอดคืนเงินต้องไม่เกินยอดที่รับจริงคงเหลือ','error')
            return redirect(target)
        db.execute("""INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,note,payment_key)
                      VALUES(?,'refund','ค่าฝากเลี้ยง',?,?,?,?,?,?)""",
                   (day.isoformat(),'คืนเงินลูกค้า',amount/100,stay['customer_id'],sid,reason,key))
    flash('บันทึกแล้ว','ok')
    return redirect(target)


def care_uploads():
    files = [upload for upload in request.files.getlist('photos') if upload.filename]
    if len(files) > 4:
        raise ValueError('แนบได้สูงสุด 4 รูปต่อกิจกรรม')
    photos = []
    total_size = 0
    for upload in files:
        photos.append(read_photo_upload(upload))
        total_size += upload.stream.tell()
        if total_size > 7 * 1024 * 1024:
            raise ValueError('เลือกได้สูงสุด 4 รูป รวมไม่เกิน 7 MB')
    return photos


@app.post('/stays/<int:sid>/dogs/<int:dog_id>/care')
def record_care(sid, dog_id):
    activity = request.form.get('kind')
    note = request.form.get('note', '').strip()
    if len(note) > 500 or (activity == 'custom' and not note):
        abort(400)
    now = now_local()
    recorded_at = now
    if 'care_date' in request.form or 'care_time' in request.form:
        try:
            day = date.fromisoformat(request.form.get('care_date', ''))
            clock = time.fromisoformat(request.form.get('care_time', ''))
            if clock.tzinfo is not None:
                raise ValueError
            recorded_at = datetime.combine(day, clock, tzinfo=now.tzinfo)
            if recorded_at > now:
                raise ValueError
        except ValueError:
            flash('กรุณาระบุวันเวลากิจกรรมให้ถูกต้องและไม่เกินปัจจุบัน', 'error')
            return redirect(care_event_target(sid, dog_id))
    try:
        photos = care_uploads()
    except ValueError as error:
        flash(str(error), 'error')
        return redirect(care_event_target(sid, dog_id))
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        options = care_activity_options(db)
        if activity not in options:
            abort(400)
        if not db.execute("""SELECT 1 FROM stays s JOIN stay_dogs sd ON sd.stay_id=s.id
                             WHERE s.id=? AND sd.dog_id=? AND s.status='checked_in'""", (sid,dog_id)).fetchone():
            abort(409)
        kind = activity if activity in CARE_EVENT_LABELS else 'custom'
        label = options[activity] if activity != 'custom' and (activity not in CARE_EVENT_LABELS or request.form.get('origin')) else None
        event = db.execute("""INSERT INTO care_events(stay_id,dog_id,kind,recorded_at,note,activity_label,customer_visible)
                              VALUES(?,?,?,?,?,?,?)""", (sid,dog_id,kind,recorded_at.isoformat(timespec='seconds'),note,label,
                                                   request.form.get('customer_visible') == '1'))
        db.executemany('INSERT INTO care_photos(event_id,photo) VALUES(?,?)',
                       ((event.lastrowid, photo) for photo in photos))
    flash('บันทึกแล้ว','ok')
    if recorded_at.date() != now.date():
        return redirect(url_for('care_timeline', sid=sid, dog_id=dog_id, day=recorded_at.date().isoformat()))
    if request.form.get('origin') == 'timeline':
        return redirect(url_for('care_timeline', sid=sid, dog_id=dog_id))
    return redirect(url_for('dashboard',_anchor=f'care-{sid}-{dog_id}'))


def care_event_target(sid, dog_id):
    if request.form.get('origin') == 'timeline':
        return url_for('care_timeline', sid=sid, dog_id=dog_id, day=request.form.get('day') or None)
    if request.form.get('origin') == 'dashboard':
        return url_for('dashboard', _anchor=f'care-{sid}-{dog_id}')
    return url_for('stay_summary', sid=sid, show_care=1, _anchor='stay-care-history')


@app.post('/stays/<int:sid>/dogs/<int:dog_id>/care/<int:event_id>/edit-time')
def edit_care_time(sid, dog_id, event_id):
    entered_time = request.form.get('care_time', '')
    now = now_local()
    try:
        if len(entered_time) != 5 or entered_time[2] != ':':
            raise ValueError
        new_time = time.fromisoformat(entered_time)
    except ValueError:
        flash('กรุณาระบุเวลากิจกรรมให้ถูกต้อง', 'error')
        return redirect(care_event_target(sid, dog_id))

    activity = request.form.get('kind')
    note = request.form.get('note', '').strip()
    if activity is not None and (len(note) > 500 or (activity == 'custom' and not note)):
        abort(400)
    try:
        photos = care_uploads() if activity is not None else []
        removed_ids = {int(value) for value in request.form.getlist('remove_photos')} if activity is not None else set()
    except ValueError as error:
        flash(str(error), 'error')
        return redirect(care_event_target(sid, dog_id))

    event_key = (event_id, sid, dog_id)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        event = db.execute('''SELECT e.*, s.status FROM care_events e JOIN stays s ON s.id=e.stay_id
                              WHERE e.id=? AND e.stay_id=? AND e.dog_id=?''',
                           event_key).fetchone()
        if event is None:
            abort(404)
        if event['status'] == 'completed':
            return completed_stay_redirect(sid)
        recorded = datetime.fromisoformat(event['recorded_at'])
        try:
            day = date.fromisoformat(request.form['care_date']) if 'care_date' in request.form else recorded.date()
            updated = datetime.combine(day, new_time, tzinfo=now.tzinfo)
            if updated > now:
                raise ValueError
        except ValueError:
            flash('กรุณาระบุวันเวลากิจกรรมให้ถูกต้องและไม่เกินปัจจุบัน', 'error')
            return redirect(care_event_target(sid, dog_id))
        kind, label = event['kind'], event['activity_label']
        if activity is None:
            note = event['note']
        else:
            options = care_activity_options(db)
            if activity != 'existing-activity':
                if activity not in options:
                    abort(400)
                kind = activity if activity in CARE_EVENT_LABELS else 'custom'
                label = options[activity] if activity != 'custom' else None
            elif not label:
                abort(400)
            current_ids = {row[0] for row in db.execute('SELECT id FROM care_photos WHERE event_id=?', (event_id,))}
            if not removed_ids <= current_ids:
                abort(400)
            if len(current_ids - removed_ids) + len(photos) > 4:
                flash('แนบได้สูงสุด 4 รูปต่อกิจกรรม', 'error')
                return redirect(care_event_target(sid, dog_id))
            db.executemany('INSERT INTO care_photos(event_id,photo) VALUES(?,?)',
                           ((event_id, photo) for photo in photos))
            db.executemany('DELETE FROM care_photos WHERE id=? AND event_id=?',
                           ((photo_id, event_id) for photo_id in removed_ids))
        db.execute("""UPDATE care_events SET recorded_at=?,kind=?,activity_label=?,note=?,customer_visible=?
                      WHERE id=? AND stay_id=? AND dog_id=?""",
                   (updated.isoformat(timespec='seconds'),kind,label,note,
                    event['customer_visible'] if activity is None else request.form.get('customer_visible') == '1',
                    *event_key))
    flash('บันทึกแล้ว', 'ok')
    if day != recorded.date():
        return redirect(url_for('care_timeline', sid=sid, dog_id=dog_id, day=day.isoformat()))
    return redirect(care_event_target(sid, dog_id))


@app.post('/stays/<int:sid>/dogs/<int:dog_id>/care/<int:event_id>/delete')
def delete_care(sid, dog_id, event_id):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT status FROM stays WHERE id=?', (sid,)).fetchone()
        if stay and stay['status'] == 'completed':
            return completed_stay_redirect(sid)
        removed = db.execute('DELETE FROM care_events WHERE id=? AND stay_id=? AND dog_id=?',
                             (event_id, sid, dog_id))
        if not removed.rowcount:
            abort(404)
    flash('ลบบันทึกการดูแลแล้ว', 'ok')
    return redirect(care_event_target(sid, dog_id))


def care_stay_dog(db, sid, dog_id):
    dog = db.execute("""SELECT d.name,d.profile,d.size,c.name owner,s.status,s.checkin,s.checkout,s.actual_checkout_at,
                               (SELECT p.photo FROM dog_photos p WHERE p.dog_id=d.id) profile_photo,
                               EXISTS(SELECT 1 FROM dog_photos p WHERE p.dog_id=d.id) has_photo FROM stays s
                        JOIN customers c ON c.id=s.customer_id
                        JOIN stay_dogs sd ON sd.stay_id=s.id JOIN dogs d ON d.id=sd.dog_id
                        WHERE s.id=? AND d.id=?""", (sid,dog_id)).fetchone()
    if dog is None:
        abort(404)
    return dog


@app.get('/stays/<int:sid>/dogs/<int:dog_id>/care')
def care_timeline(sid, dog_id):
    today = now_local().date().isoformat()
    day = request.args.get('day', today)
    all_days = day == 'all'
    if not all_days:
        try:
            day = date.fromisoformat(day).isoformat()
        except ValueError:
            abort(400)
        if day > today:
            abort(400)
    with conn() as db:
        dog = care_stay_dog(db, sid, dog_id)
        day_filter = '' if all_days else 'AND substr(e.recorded_at,1,10)=?'
        params = (sid, dog_id) if all_days else (sid, dog_id, day)
        events = db.execute(f"""SELECT e.*, substr(e.recorded_at,1,10) AS event_day,
                               (SELECT group_concat(id) FROM care_photos WHERE event_id=e.id) photos
                               FROM care_events e WHERE e.stay_id=? AND e.dog_id=? {day_filter}
                               ORDER BY e.recorded_at DESC,e.id DESC""", params).fetchall()
        days = {today, *(row[0] for row in db.execute(
            'SELECT DISTINCT substr(recorded_at,1,10) FROM care_events WHERE stay_id=? AND dog_id=?',
            (sid,dog_id)))}
        if not all_days:
            days.add(day)
        options = care_activity_options(db)
        share = db.execute('SELECT token FROM care_share_links WHERE stay_id=? AND dog_id=?',(sid,dog_id)).fetchone()
        expiry_hours = care_link_hours(db)
    share_allowed = care_link_active(dog, now_local(), expiry_hours)
    share_path = url_for('public_care_timeline', token=share['token']) if share and share_allowed else None
    share_url = (app.config.get('CARE_SHARE_ORIGIN') or request.host_url).rstrip('/') + share_path if share_path else None
    return render_template('care_timeline.html', dog=dog, sid=sid, dog_id=dog_id, day=day, events=events,
                           all_days=all_days, days=sorted(days, reverse=True), care_options=options,
                           share_url=share_url, share_path=share_path, share_exists=bool(share),
                           share_allowed=share_allowed, expiry_hours=expiry_hours)


def care_link_hours(db):
    return get_setting(db, 'care_link_hours', 48)


def care_link_active(stay, now, expiry_hours):
    if stay['status'] == 'checked_in':
        return True
    if stay['status'] == 'completed' and stay['actual_checkout_at']:
        return (now - datetime.fromisoformat(stay['actual_checkout_at'])).total_seconds()/3600 < expiry_hours
    return False


@app.post('/stays/<int:sid>/dogs/<int:dog_id>/care/share')
def manage_care_share(sid, dog_id):
    action = request.form.get('action')
    selected_day = request.form.get('day') or None
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = care_stay_dog(db, sid, dog_id)
        if action == 'revoke':
            db.execute('DELETE FROM care_share_links WHERE stay_id=? AND dog_id=?',(sid,dog_id))
        elif action == 'create' and care_link_active(stay, now_local(), care_link_hours(db)):
            db.execute("""INSERT INTO care_share_links(stay_id,dog_id,token) VALUES(?,?,?)
                          ON CONFLICT(stay_id,dog_id) DO NOTHING""", (sid,dog_id,secrets.token_urlsafe(32)))
        elif action == 'publish-day' and stay['status'] == 'completed':
            return completed_stay_redirect(sid)
        elif action == 'publish-day' and care_link_active(stay,now_local(),care_link_hours(db)):
            try:
                day = date.fromisoformat(selected_day or '').isoformat()
            except ValueError:
                abort(400)
            if not db.execute('SELECT 1 FROM care_share_links WHERE stay_id=? AND dog_id=?',(sid,dog_id)).fetchone():
                abort(409)
            db.execute("""UPDATE care_events SET customer_visible=1
                          WHERE stay_id=? AND dog_id=? AND substr(recorded_at,1,10)=?""", (sid,dog_id,day))
        else:
            abort(409)
    flash('แชร์กิจกรรมของวันที่เลือกแล้ว' if action == 'publish-day' else 'บันทึกแล้ว','ok')
    return redirect(url_for('care_timeline',sid=sid,dog_id=dog_id,day=selected_day,
                            _anchor='share-timeline'))


def public_care_link(db, token):
    if len(token) != 43:
        abort(404)
    share = db.execute("""SELECT l.stay_id,l.dog_id,d.name,s.status,s.actual_checkout_at
                          FROM care_share_links l JOIN stays s ON s.id=l.stay_id
                          JOIN stay_dogs sd ON sd.stay_id=l.stay_id AND sd.dog_id=l.dog_id
                          JOIN dogs d ON d.id=l.dog_id WHERE l.token=?""",(token,)).fetchone()
    expiry_hours = care_link_hours(db)
    if share is None or not care_link_active(share, now_local(), expiry_hours):
        abort(404)
    return dict(share, expiry_hours=expiry_hours)


PUBLIC_CARE_HEADERS = {
    'Cache-Control':'private, no-store',
    'Referrer-Policy':'no-referrer',
    'X-Robots-Tag':'noindex, nofollow, noarchive',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self' data:; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}


@app.after_request
def public_care_response(response):
    if request.endpoint in PUBLIC_CARE_ENDPOINTS:
        response.headers.update(PUBLIC_CARE_HEADERS)
    return response


def public_care_data(token, *, include_photos=False):
    today = now_local().date().isoformat()
    selected = request.args.get('day', today)
    if selected != 'all':
        try:
            selected = date.fromisoformat(selected).isoformat()
        except ValueError:
            abort(400)
    with closing(conn()) as db:
        db.execute('BEGIN')
        share = public_care_link(db, token)
        scope = (share['stay_id'],share['dog_id'])
        days = db.execute("""SELECT DISTINCT substr(recorded_at,1,10) AS day FROM care_events
                             WHERE stay_id=? AND dog_id=? AND customer_visible=1 ORDER BY day DESC""", scope).fetchall()
        events = db.execute("""SELECT e.id,e.kind,e.activity_label,e.recorded_at,e.note,
                                      (SELECT group_concat(id) FROM care_photos WHERE event_id=e.id) photos
                               FROM care_events e WHERE stay_id=? AND dog_id=? AND customer_visible=1
                               AND (?='all' OR substr(recorded_at,1,10)=?)
                               ORDER BY recorded_at DESC,id DESC""", (*scope,selected,selected)).fetchall()
        dog = {'name':share['name'],'profile':{},'profile_photo':None,'size_label':''}
        photos = {}
        if include_photos:
            profile_photo = db.execute('SELECT photo FROM dog_photos WHERE dog_id=?', (share['dog_id'],)).fetchone()
            if profile_photo is not None:
                dog['profile_photo'] = profile_photo['photo']
            for row in db.execute("""SELECT p.event_id,p.photo FROM care_photos p JOIN care_events e ON p.event_id=e.id
                                     WHERE e.stay_id=? AND e.dog_id=? AND e.customer_visible=1
                                     AND (?='all' OR substr(e.recorded_at,1,10)=?) ORDER BY p.id""",
                                  (*scope,selected,selected)):
                photos.setdefault(row['event_id'],[]).append(row['photo'])
    days = [row['day'] for row in days]
    if selected not in ('all',today) and selected not in days:
        abort(404)
    return dog, today, selected, days, events, photos, share['expiry_hours']


def public_care_language():
    selected = request.args.get('lang')
    return selected if selected in LANGUAGES else 'th'


@app.get('/updates/<token>')
def public_care_timeline(token):
    dog, today, selected, days, events, _, expiry_hours = public_care_data(token)
    guest_lang = public_care_language()
    return Response(render_template('public_care_timeline.html', dog_name=dog['name'], events=events, token=token,
                                    selected=selected, days=days, today=today, guest_lang=guest_lang, expiry_hours=expiry_hours,
                                    guest_text=partial(translate,lang=guest_lang),
                                    guest_date=partial(display_date,lang=guest_lang)),
                    mimetype='text/html', headers={'Content-Language':guest_lang})


@app.get('/updates/<token>/timeline.pdf')
def public_care_pdf(token):
    from app.care_export import build_care_export

    dog, today, selected, _, events, photos, _ = public_care_data(token, include_photos=True)
    guest_lang = public_care_language()
    pdf = build_care_export(dog, events, photos, guest_lang, current_theme(), 'pdf',
                            today if selected == 'all' else selected, selected, care_event_title)
    return export_download(pdf, f'little-paws-timeline-{selected}-{guest_lang}.pdf', guest_lang, 'application/pdf')


@app.get('/updates/<token>/photos/<int:photo_id>')
def public_care_photo(token, photo_id):
    with closing(conn()) as db:
        db.execute('BEGIN')
        share = public_care_link(db,token)
        photo = db.execute("""SELECT p.photo FROM care_photos p JOIN care_events e ON e.id=p.event_id
                              WHERE p.id=? AND e.stay_id=? AND e.dog_id=? AND e.customer_visible=1""",
                           (photo_id,share['stay_id'],share['dog_id'])).fetchone()
    if photo is None:
        abort(404)
    return Response(upright_jpeg(photo[0]),mimetype='image/jpeg')


@app.get('/care/photos/<int:photo_id>')
def care_photo(photo_id):
    with conn() as db:
        photo = db.execute('SELECT photo FROM care_photos WHERE id=?', (photo_id,)).fetchone()
    if not photo:
        abort(404)
    return Response(upright_jpeg(photo[0]), mimetype='image/jpeg', headers={'Cache-Control':'private, no-store'})


@app.get('/stays/<int:sid>/dogs/<int:dog_id>/care/export.<format>')
def care_export(sid, dog_id, format):
    from app.care_export import build_care_export

    scope = request.args.get('scope','today')
    if format not in ('pdf','png') or scope not in ('today','all'):
        abort(404)
    today = now_local().date().isoformat()
    with conn() as db:
        db.execute('BEGIN')
        dog = care_stay_dog(db, sid, dog_id)
        events = db.execute("""SELECT * FROM care_events WHERE stay_id=? AND dog_id=?
                               AND (?='all' OR substr(recorded_at,1,10)=?)
                               ORDER BY recorded_at DESC,id DESC""", (sid,dog_id,scope,today)).fetchall()
        photos = {}
        for row in db.execute("""SELECT p.event_id,p.photo FROM care_photos p JOIN care_events e ON e.id=p.event_id
                                 WHERE e.stay_id=? AND e.dog_id=? AND (?='all' OR substr(e.recorded_at,1,10)=?)
                                 ORDER BY p.id""", (sid,dog_id,scope,today)):
            photos.setdefault(row['event_id'], []).append(row['photo'])
    lang = language()
    try:
        profile = dog_profile_row(dog, date.fromisoformat(today))
        profile['size_label'] = DOG_SIZES.get(dog['size'], '')
        output = build_care_export(profile, events, photos, lang, current_theme(), format, today,
                                   scope, care_event_title)
    except ValueError:
        abort(422, description=translate('ข้อมูลยาวเกินขนาดรูปภาพ กรุณาดาวน์โหลด PDF'))
    return export_download(output, f'little-paws-care-{sid}-{dog_id}-{today if scope=="today" else scope}.{format}',
                           lang, 'application/pdf' if format=='pdf' else 'image/png')


@app.post('/stays/<int:sid>/check-out')
def stay_checkout(sid):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT status FROM stays WHERE id=?', (sid,)).fetchone()
        if stay is None:
            abort(404)
        if stay['status'] == 'checked_in':
            db.execute("UPDATE stays SET status='completed',actual_checkout_at=? WHERE id=?", (now_local().isoformat(timespec='seconds'),sid))
            flash('เช็กเอาต์แล้ว สถานะกลับบ้านแล้ว', 'ok')
        elif stay['status'] != 'completed':
            flash('เช็กเอาต์ได้เฉพาะรายการที่กำลังเข้าพัก', 'error')
    if request.args.get('origin') == 'dashboard':
        return redirect(url_for('dashboard', from_month=request.args.get('from_month'),
                                to_month=request.args.get('to_month'), _anchor='current-stays'))
    return redirect(stay_history_return())


@app.post('/stays/<int:sid>/recheck-in')
def stay_recheckin(sid):
    target = url_for('stay_summary', sid=sid, start=request.args.get('start'),
                     end=request.args.get('end'), status=request.args.get('status'), q=reference_search())
    key = request.remote_addr
    if not admin_attempts.allow(key):
        flash('ลองเข้าสู่ระบบหลายครั้ง กรุณารอ 1 นาที', 'error')
        return redirect(target)
    username = request.form.get('admin_username','').strip()
    password = request.form.get('admin_password','')
    with closing(conn()) as db, db:
        admin = db.execute("""SELECT id,password_hash FROM app_users
                              WHERE username=? AND active=1 AND is_admin=1 AND needs_password=0""",(username,)).fetchone()
        if not matching_password(admin,password):
            flash('ชื่อผู้ใช้หรือรหัสผ่านแอดมินไม่ถูกต้อง', 'error')
            return redirect(target)
        db.execute('BEGIN IMMEDIATE')
        if not db.execute("""SELECT 1 FROM app_users WHERE id=? AND password_hash=?
                             AND active=1 AND is_admin=1 AND needs_password=0""",(admin['id'],admin['password_hash'])).fetchone():
            abort(403)
        stay = db.execute('SELECT status,actual_checkout_at,cancelled_at FROM stays WHERE id=?',(sid,)).fetchone()
        if stay is None:
            abort(404)
        if stay['status'] != 'completed' or stay['cancelled_at']:
            abort(409)
        if not care_link_active(stay,now_local(),care_link_hours(db)):
            db.execute('DELETE FROM care_share_links WHERE stay_id=?',(sid,))
        db.execute("UPDATE stays SET status='checked_in',actual_checkout_at=NULL WHERE id=?",(sid,))
    admin_attempts.reset(key)
    flash('ยกเลิกการเช็กเอาต์แล้ว น้องกลับมาอยู่ในสถานะกำลังเข้าพัก', 'ok')
    return redirect(target)


@app.post('/stays/<int:sid>/status')
def stay_status(sid):
    status = request.form.get('status')
    if status not in STAY_STATUSES:
        abort(400)
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        original = db.execute('SELECT status,cancelled_at FROM stays WHERE id=?', (sid,)).fetchone()
        if original is None:
            abort(404)
        if original['cancelled_at'] or (status == 'cancelled' and has_stay_receipts(db,sid)):
            flash('กรุณายกเลิกพร้อมเหตุผลจากหน้าสรุปการเข้าพัก','error')
            return redirect(url_for('stay_summary',sid=sid))
        if original['status'] == 'completed':
            return completed_stay_redirect(sid)
        recorded_at = now_local().isoformat(timespec='seconds')
        if status == 'completed' and original['status'] != 'completed':
            db.execute('UPDATE stays SET actual_checkout_at=? WHERE id=?', (recorded_at,sid))
        if status == 'checked_in' and (not original or original['status'] != 'checked_in'):
            db.execute('UPDATE stays SET actual_checkin_at=COALESCE(actual_checkin_at,?),actual_checkout_at=NULL WHERE id=?', (recorded_at,sid))
        if status in ('booked','cancelled') or (status == 'checked_in' and original['status'] != 'checked_in'):
            db.execute('DELETE FROM care_share_links WHERE stay_id=?', (sid,))
        db.execute('UPDATE stays SET status=? WHERE id=?', (status, sid))
        if status in ('checked_in', 'completed'):
            assign_reference_code(db, 'stays', 'stay_number', sid)
        stay = db.execute('SELECT * FROM stays WHERE id=?', (sid,)).fetchone()
        if stay is None:
            abort(404)
        if db.execute('SELECT 1 FROM stay_dogs WHERE stay_id=? AND nightly_rate_cents IS NOT NULL',
                      (sid,)).fetchone():
            sync_stay_income(db, stay)
    return redirect(stay_history_return())


@app.post('/stays/<int:sid>/delete')
def stay_delete(sid):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        stay = db.execute('SELECT status,cancelled_at FROM stays WHERE id=?', (sid,)).fetchone()
        if stay is None:
            abort(404)
        if stay['status'] == 'completed':
            return completed_stay_redirect(sid)
        if has_stay_receipts(db,sid) or stay['cancelled_at']:
            flash('กรุณายกเลิกพร้อมเหตุผลจากหน้าสรุปการเข้าพัก','error')
            return redirect(url_for('stay_summary',sid=sid))
        db.execute("DELETE FROM transactions WHERE stay_id=? AND (auto_stay=1 OR payment_type IN ('checkin','additional'))", (sid,))
        db.execute('UPDATE transactions SET stay_id=NULL WHERE stay_id=?', (sid,))
        appointment = db.execute('UPDATE appointments SET stay_id=NULL WHERE stay_id=?', (sid,))
        db.execute('DELETE FROM stays WHERE id=?', (sid,))
    flash('ลบการเข้าพักแล้ว การจองเดิมกลับเป็นรอเช็กอิน' if appointment.rowcount
          else 'ลบการเข้าพักแล้ว', 'ok')
    return redirect(stay_history_return())


CALENDAR_VIEWS = {'month': 'รายเดือน', 'week': 'รายสัปดาห์', 'day': 'รายวัน', 'list': 'ลิสต์'}
WEEKDAYS = ('จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์')
def calendar_day(value):
    try:
        day = date.fromisoformat(value)
        if 2 <= day.year <= 9998:
            return day
    except (TypeError, ValueError):
        pass
    return date.today()


def stay_coupon(db, stay_id):
    return db.execute("""SELECT c.code,u.discount_cents,u.used_at FROM coupon_uses u
                         JOIN coupons c ON c.id=u.coupon_id WHERE u.stay_id=?""", (stay_id,)).fetchone()


@app.post('/coupons/lookup')
def coupon_lookup():
    with conn() as db:
        try:
            coupon = find_coupon(db, request.form.get('code', '').strip(), request.form.get('stay_id', type=int))
        except ValueError as exc:
            return jsonify(error=translate(str(exc))), 400
        if coupon['already_used']:
            saved = stay_coupon(db, request.form.get('stay_id', type=int))
            return jsonify(kind='fixed', value=saved['discount_cents'], minimum_cents=0)
    return jsonify({key: coupon[key] for key in ('kind', 'value', 'minimum_cents')})


@app.route('/settings/coupons', defaults={'coupon_id': None}, methods=['GET', 'POST'])
@app.route('/settings/coupons/<int:coupon_id>/edit', methods=['GET', 'POST'])
def coupons(coupon_id):
    today = coupon_today()
    submitted = request.form if request.method == 'POST' else {}
    selected = request.args.get('status', 'active')
    if selected not in ('active', 'used', 'expired'):
        selected = 'active'
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        editing = None
        if coupon_id is not None:
            editing = db.execute('''SELECT c.*, (SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id) AS used
                                    FROM coupons c WHERE c.id=? AND c.archived=0''', (coupon_id,)).fetchone()
            if editing is None:
                abort(404)
        if request.method == 'POST':
            if editing and submitted.get('action') == 'delete':
                db.execute('UPDATE coupons SET archived=1 WHERE id=?', (coupon_id,))
                flash('ลบคูปองแล้ว', 'ok')
                return redirect(url_for('coupons', status=selected, _anchor='coupon-list'))
            try:
                kind = submitted.get('kind')
                value = money_cents(submitted.get('value', ''))
                minimum = money_cents(submitted.get('minimum') or '0')
                expires = date.fromisoformat(submitted.get('expires_on', ''))
                uses = int(submitted.get('max_uses', ''))
                if (kind not in ('percent', 'fixed') or not value or (kind == 'percent' and value > 10000)
                        or (expires < today and (not editing or expires.isoformat() != editing['expires_on']))
                        or not max(1, editing['used'] if editing else 0) <= uses <= 999999):
                    raise ValueError
            except (ValueError, InvalidOperation):
                flash('กรุณาตรวจข้อมูลคูปอง', 'error')
            else:
                if editing:
                    db.execute('''UPDATE coupons SET kind=?,value=?,minimum_cents=?,expires_on=?,max_uses=?
                                  WHERE id=?''', (kind, value, minimum, expires.isoformat(), uses, coupon_id))
                    group = 'expired' if expires < today else 'used' if editing['used'] else 'active'
                    flash('บันทึกแล้ว', 'ok')
                    return redirect(url_for('coupons', status=group, _anchor='coupon-list'))
                for _ in range(100):
                    code = f'{secrets.randbelow(1000000):06d}'
                    result = db.execute("""INSERT INTO coupons(code,kind,value,minimum_cents,expires_on,max_uses)
                                           VALUES(?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING""",
                                        (code, kind, value, minimum, expires.isoformat(), uses))
                    if result.rowcount:
                        break
                else:
                    abort(503)
                flash(f"{translate('สร้างคูปองแล้ว')} · {code}", 'ok')
                return redirect(url_for('coupons', preview=result.lastrowid))
        rows = db.execute("""SELECT c.*, (SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id) AS used
                             FROM coupons c WHERE c.archived=0 ORDER BY c.id DESC""").fetchall()
    groups = {'active': [], 'used': [], 'expired': []}
    for row in rows:
        group = 'expired' if row['expires_on'] < today.isoformat() else 'used' if row['used'] else 'active'
        groups[group].append(row)
    preview_id = request.args.get('preview', type=int) if request.method == 'GET' and not editing else None
    preview_coupon = next((row for row in groups[selected] if row['id'] == preview_id), None)
    return render_template('coupons.html', preview_coupon=preview_coupon, coupons=groups[selected], coupon_group=selected, groups=groups,
                           tab='coupons', submitted=submitted, editing=editing, coupon_date=today.isoformat(),
                           default_expiry=shift_months(today, 6).isoformat())


@app.get('/settings/coupons/<int:coupon_id>/image.png')
def coupon_image(coupon_id):
    from app.coupon_image import build_coupon_image

    with conn() as db:
        coupon = db.execute("""SELECT c.*, (SELECT count(*) FROM coupon_uses u WHERE u.coupon_id=c.id) AS used
                               FROM coupons c WHERE c.id=? AND c.archived=0""", (coupon_id,)).fetchone()
    if coupon is None:
        abort(404)
    lang = language()
    png = build_coupon_image(coupon, lang, current_theme())
    return export_download(png, f"little-paws-coupon-{coupon['code']}-{lang}.png", lang, 'image/png')


@app.route('/settings', defaults={'tab': 'rates'}, methods=['GET', 'POST'])
@app.route('/settings/<tab>', methods=['GET', 'POST'])
def settings(tab):
    if tab not in ('rates', 'holidays', 'theme', 'capacity', 'backup', 'care'):
        abort(404)
    editing = request.args.get('edit', type=int)
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
            try:
                if tab == 'rates':
                    rates = configured_rates(db)
                    for service in SERVICES:
                        for size in DOG_SIZES:
                            key = f'{service}_{size}'
                            if service == 'monthly' and key not in request.form:
                                continue
                            value = request.form[key]
                            rates[service][size] = None if service == 'monthly' and not value else money_cents(value)/100
                    set_setting(db, 'rates', rates)
                elif tab == 'capacity':
                    capacity = int(request.form.get('capacity','0'))
                    if not 0 <= capacity <= 10000:
                        raise ValueError
                    if 'care_link_hours' in request.form:
                        if not g.user['is_admin']:
                            abort(403)
                        hours = int(request.form['care_link_hours'])
                        if hours < 0:
                            raise ValueError
                        set_setting(db,'care_link_hours',hours)
                    set_setting(db,'capacity',capacity)
                elif tab == 'backup':
                    abort(405)
                elif tab == 'care':
                    name = request.form.get('activity','').strip()
                    activities = get_setting(db,'care_activities',[])
                    if request.form.get('action') == 'delete':
                        if name in activities:
                            activities.remove(name)
                    else:
                        if (not name or len(name)>60 or len(activities)>=100 or
                                name.casefold() in {item.casefold() for item in (*activities,*CARE_ACTIVITIES.values())}):
                            raise ValueError
                        activities.append(name)
                    set_setting(db,'care_activities',activities)
                elif tab == 'theme':
                    theme = request.form.get('theme')
                    if theme not in THEMES:
                        raise ValueError
                    set_setting(db, 'theme', theme)
                else:
                    if editing and not db.execute('SELECT 1 FROM shop_holidays WHERE id=?', (editing,)).fetchone():
                        abort(404)
                    if editing and request.form.get('action') == 'delete':
                        db.execute('DELETE FROM shop_holidays WHERE id=?', (editing,))
                    else:
                        name = request.form.get('name', '').strip()
                        start = date.fromisoformat(request.form.get('starts_on', ''))
                        end = date.fromisoformat(request.form.get('ends_on', ''))
                        if not name or len(name) > 100 or start > end:
                            raise ValueError
                        values = (name, start.isoformat(), end.isoformat())
                        if editing:
                            db.execute('UPDATE shop_holidays SET name=?,starts_on=?,ends_on=? WHERE id=?', (*values, editing))
                        else:
                            db.execute('INSERT INTO shop_holidays(name,starts_on,ends_on) VALUES(?,?,?)', values)
            except (ValueError, InvalidOperation, KeyError):
                flash('กรุณาตรวจข้อมูลที่ตั้งค่า', 'error')
            else:
                flash('บันทึกแล้ว', 'ok')
                return redirect(url_for('settings', tab=tab))
        holidays = db.execute('SELECT * FROM shop_holidays ORDER BY starts_on,id').fetchall()
        holiday = next((row for row in holidays if row['id'] == editing), None)
        if editing and tab == 'holidays' and holiday is None:
            abort(404)
        return render_template('settings.html', tab=tab, rates=configured_rates(db),
                               sizes=DOG_SIZES, services=SERVICES, themes=THEMES, holidays=holidays,
                               holiday=holiday, care_activities=get_setting(db,'care_activities',[]),
                               standard_activities=CARE_ACTIVITIES.values(), expiry_hours=care_link_hours(db), capacity=get_setting(db,'capacity',0), last_backup=get_setting(db,'last_backup',None), submitted=request.form if request.method == 'POST' else {})


def booking_navigation():
    view = request.args.get('view')
    scope = request.args.get('scope')
    return dict(view=view if view in CALENDAR_VIEWS else None,
                date=calendar_day(request.args['date']).isoformat() if request.args.get('date') else None,
                scope=scope if scope in ('pending', 'month') else None,
                q=reference_search() if view == 'list' else None,
                origin='dashboard' if request.args.get('origin') == 'dashboard' else None)


def booking_list_url(default_date=None):
    nav = booking_navigation()
    if nav.pop('origin') == 'dashboard':
        return url_for('dashboard', _anchor='upcoming-stays')
    if not nav['view']:
        nav['view'] = 'list' if default_date or nav['scope'] else None
    nav['date'] = nav['date'] or default_date
    return url_for('appointments', **nav)


app.jinja_env.globals.update(booking_navigation=booking_navigation, booking_list_url=booking_list_url)


@app.get('/appointments')
def appointments():
    view = request.args.get('view', 'month')
    if view not in CALENDAR_VIEWS:
        view = 'month'
    default_scope = 'month' if request.args.get('date') else 'pending'
    show_all = view == 'list' and request.args.get('scope', default_scope) == 'pending'
    today = date.today()
    anchor = calendar_day(request.args.get('date'))
    if view in ('month', 'list'):
        start = anchor.replace(day=1)
        end = next_month(start) - timedelta(days=1)
        previous, following = (start - timedelta(days=1)).replace(day=1), next_month(start)
        title = display_month(start, full=True)
    elif view == 'week':
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
        previous, following = start - timedelta(days=7), start + timedelta(days=7)
        title = f'{display_date(start)} – {display_date(end)}'
    else:
        start = end = anchor
        previous, following = anchor - timedelta(days=1), anchor + timedelta(days=1)
        title = display_date(anchor)
    first_cell = start - timedelta(days=start.weekday()) if view == 'month' else start
    last_cell = end + timedelta(days=6-end.weekday()) if view == 'month' else end
    payment_columns = """
        , COALESCE((SELECT SUM(ROUND(t.amount * 100)) FROM transactions t
                    WHERE t.deposit_appointment_id=a.id AND t.payment_type='deposit'), 0) deposit_cents
        , s.payment_tracking AS actual_payments
        , CASE WHEN s.payment_tracking=1 THEN s.agreed_total ELSE a.agreed_total END AS display_total
        , COALESCE((SELECT SUM(ROUND(t.amount * 100)) FROM transactions t
                    WHERE t.stay_id=s.id AND t.payment_type!=''), 0) AS paid_cents
        , (NOT EXISTS (SELECT 1 FROM appointment_dogs ad WHERE ad.appointment_id=a.id)
           OR EXISTS (SELECT 1 FROM appointment_dogs ad
                      WHERE ad.appointment_id=a.id AND ad.nightly_rate_cents IS NULL)) quote_pending
    """ if view == 'list' else ''
    payment_join = 'LEFT JOIN stays s ON s.id=a.stay_id' if view == 'list' else ''
    query = f"""SELECT a.*,c.name owner,COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact,
                      (SELECT group_concat(d.name, ', ') FROM appointment_dogs ad
                       JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) dog_names{payment_columns}
                 FROM appointments a JOIN customers c ON c.id=a.customer_id {payment_join}"""
    if show_all:
        where, params = "a.status='pending' AND a.stay_id IS NULL", ()
        title = translate('การจองที่รอเช็กอินทั้งหมด')
    else:
        where, params = 'a.checkin<=? AND a.checkout>=?', (last_cell.isoformat(), first_cell.isoformat())
    with conn() as db:
        rows = db.execute(f'{query} WHERE {where} ORDER BY a.checkin,a.id', params).fetchall()
        holidays = db.execute('''SELECT * FROM shop_holidays WHERE starts_on<=? AND ends_on>=?
                                 ORDER BY starts_on,id''', (last_cell.isoformat(), first_cell.isoformat())).fetchall() if not show_all else []
    cells = []
    booking_totals = None
    search_query = reference_search() if view == 'list' else None
    if view == 'list':
        rows = search_reference_rows(rows, search_query, 'booking_number', 'owner', 'dog_names')
        pending = [row for row in rows if row['status'] == 'pending' and row['stay_id'] is None]
        priced = [(round(row['display_total'] * 100), row['deposit_cents'])
                  for row in pending if not row['quote_pending']]
        booking_totals = dict(
            booked=sum(total for total, _ in priced),
            deposited=sum(row['deposit_cents'] for row in pending),
            expected=sum(max(0, total - deposit) for total, deposit in priced),
            unpriced=len(pending) - len(priced),
        )
    if view in ('month', 'week'):
        for offset in range((last_cell-first_cell).days+1):
            day = first_cell + timedelta(days=offset)
            iso = day.isoformat()
            cells.append(dict(day=day, iso=iso, muted=day < start or day > end,
                              events=[row for row in rows if row['checkin'] <= iso <= row['checkout']],
                              holidays=[row for row in holidays if row['starts_on'] <= iso <= row['ends_on']]))
    return render_template('appointments.html', view=view, views=CALENDAR_VIEWS, weekdays=WEEKDAYS,
                           today_date=today, anchor=anchor, title=title, rows=rows, cells=cells,
                           previous=previous, following=following, show_all=show_all, holidays=holidays,
                           booking_totals=booking_totals, search_query=search_query)


@app.route('/appointments/new', methods=['GET', 'POST'], defaults={'aid': None})
@app.route('/appointments/<int:aid>/edit', methods=['GET', 'POST'])
def appointment_edit(aid):
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        appointment = db.execute('SELECT * FROM appointments WHERE id=?', (aid,)).fetchone() if aid else None
        if aid is not None and not appointment:
            abort(404)
        if appointment and appointment['stay_id'] is not None:
            return redirect(url_for('stay_summary', sid=appointment['stay_id'], **booking_navigation()))
        if appointment and appointment['status'] == 'cancelled':
            return redirect(booking_list_url(appointment['checkin']))
        if request.method == 'POST':
            record_id, error = save_booking(db, appointment, is_appointment=True)
            if not error:
                return redirect(url_for('appointment_preview', aid=record_id, **booking_navigation()))
            flash(error, 'error')
        fields = booking_fields(db, appointment, 'appointment')
    return render_template('appointment_form.html', **fields,
                           default_checkin=calendar_day(request.args.get('date')).isoformat())


@app.route('/appointments/<int:aid>/check-in', methods=['GET', 'POST'])
def appointment_checkin(aid):
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        appointment = db.execute('SELECT * FROM appointments WHERE id=?', (aid,)).fetchone()
        if not appointment:
            abort(404)
        if appointment['stay_id'] is not None:
            return redirect(url_for('stay_summary', sid=appointment['stay_id'], **booking_navigation()))
        if appointment['status'] != 'pending':
            return redirect(booking_list_url(appointment['checkin']))
        if request.method == 'POST':
            record_id, error = save_booking(db, appointment, from_appointment=True)
            if not error:
                return redirect(url_for('stay_summary', sid=record_id, **booking_navigation()))
            flash(error, 'error')
        fields = booking_fields(db, appointment, 'conversion')
    return render_template('appointment_form.html', **fields)


def appointment_export_data(aid):
    with conn() as db:
        db.execute('BEGIN')
        appointment = db.execute("""SELECT a.*,c.name customer,COALESCE(NULLIF(TRIM(c.owner_phone || ' / ' || c.line_id, ' /'), ''), c.contact) contact FROM appointments a
                                     JOIN customers c ON c.id=a.customer_id WHERE a.id=?""", (aid,)).fetchone()
        if appointment is None:
            abort(404)
        dogs = db.execute("""SELECT d.id,d.name,ad.nightly_rate_cents,p.photo,p.dog_id IS NOT NULL has_photo FROM appointment_dogs ad
                              JOIN dogs d ON d.id=ad.dog_id
                              LEFT JOIN dog_photos p ON p.dog_id=d.id
                              WHERE ad.appointment_id=?
                              ORDER BY d.name,d.id""", (aid,)).fetchall()
        payments = (payment_rows(db, stay_id=appointment['stay_id']) if appointment['stay_id']
                    else payment_rows(db, appointment_id=aid))
        actual = db.execute('SELECT payment_tracking,agreed_total FROM stays WHERE id=?',
                            (appointment['stay_id'],)).fetchone() if appointment['stay_id'] else None
    appointment = dict(appointment, payments=payment_details(payments),
                       payment_tracking=bool(actual and actual['payment_tracking']),
                       payment_total=actual['agreed_total'] if actual else appointment['agreed_total'])
    status = ('เช็กอินแล้ว' if appointment['stay_id'] is not None
              else 'ยกเลิกแล้ว' if appointment['status'] == 'cancelled' else 'รอเช็กอิน')
    return appointment, dogs, status


@app.get('/appointments/<int:aid>')
def appointment_preview(aid):
    appointment, dogs, status = appointment_export_data(aid)
    return render_template('appointment_preview.html', stay=appointment, dogs=dogs, status=status,
                           quote_pending=any(dog['nightly_rate_cents'] is None for dog in dogs) or not dogs)


@app.get('/appointments/<int:aid>/deposit.<format>', defaults={'payment_id': None})
@app.get('/appointments/<int:aid>/deposits/<int:payment_id>.<format>')
def appointment_deposit(aid, format, payment_id):
    from app.stay_pdf import build_booking_pdf
    from app.appointment_image import build_booking_image

    appointment, dogs, status = appointment_export_data(aid)
    deposits = [row for row in appointment['payments'] if row['payment_type'] == 'deposit']
    deposit = next((row for row in reversed(deposits) if payment_id is None or row['id'] == payment_id), None)
    if deposit is None or format not in ('pdf', 'png'):
        abort(404)
    lang = request.args.get('lang', language())
    if lang not in LANGUAGES:
        lang = language()
    quote_known = appointment['payment_tracking'] or bool(dogs and all(
        dog['nightly_rate_cents'] is not None for dog in dogs))
    received = sum(round(row['amount'] * 100) for row in appointment['payments'])
    balance_cents = max(0, round(appointment['payment_total'] * 100) - received)
    appointment.update(payments=[deposit], receipt_balance=balance_cents / 100 if quote_known else None)
    if format == 'pdf':
        output = build_booking_pdf(appointment, dogs, status, lang, appointment=True, receipt=True, theme=current_theme())
    else:
        try:
            output = build_booking_image(appointment, dogs, status, lang, appointment=True, receipt=True, theme=current_theme())
        except ValueError:
            abort(422, description=translate('ข้อมูลการจองยาวเกินขนาดรูปภาพ กรุณาดาวน์โหลด PDF'))
    return export_download(output, f"little-paws-deposit-{aid}-{deposit['id']}-{lang}.{format}", lang,
                           'application/pdf' if format == 'pdf' else 'image/png')


@app.post('/appointments/<int:aid>/deposits/<int:payment_id>/delete')
def appointment_deposit_delete(aid, payment_id):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        linked = db.execute('SELECT stay_id FROM transactions WHERE id=? AND deposit_appointment_id=?',
                            (payment_id, aid)).fetchone()
        if linked and linked['stay_id']:
            return redirect(url_for('stay_summary', sid=linked['stay_id'], _anchor='stay-payment-history'))
        deleted = db.execute("""DELETE FROM transactions WHERE id=? AND deposit_appointment_id=?
                                AND payment_type='deposit'""", (payment_id, aid))
        if not deleted.rowcount:
            abort(404)
    flash('ลบรายการมัดจำแล้ว', 'ok')
    return redirect(url_for('appointment_preview', aid=aid, **booking_navigation()))


@app.get('/appointments/<int:aid>/appointment.pdf')
def appointment_pdf(aid):
    from app.stay_pdf import build_booking_pdf

    appointment, dogs, status = appointment_export_data(aid)
    lang = language()
    pdf = build_booking_pdf(appointment, dogs, status, lang, appointment=True, theme=current_theme())
    return export_download(pdf, f'little-paws-booking-{aid}-{lang}.pdf', lang, 'application/pdf')


@app.get('/appointments/<int:aid>/appointment.png')
def appointment_image(aid):
    from app.appointment_image import build_booking_image

    appointment, dogs, status = appointment_export_data(aid)
    lang = language()
    try:
        png = build_booking_image(appointment, dogs, status, lang, appointment=True, theme=current_theme())
    except ValueError:
        abort(422, description=translate('ข้อมูลการจองยาวเกินขนาดรูปภาพ กรุณาดาวน์โหลด PDF'))
    return export_download(png, f'little-paws-booking-{aid}-{lang}.png', lang, 'image/png')


def export_download(stream, filename, lang, mimetype):
    response = send_file(stream, mimetype=mimetype, as_attachment=True, download_name=filename)
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['Content-Language'] = lang
    return response


@app.post('/appointments/<int:aid>/delete')
def appointment_delete(aid):
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT checkin FROM appointments WHERE id=?', (aid,)).fetchone()
        if row is None:
            abort(404)
        if payment_rows(db, appointment_id=aid):
            flash('กรุณาตรวจและแก้ยอดมัดจำก่อนลบการจอง', 'error')
            return redirect(url_for('appointment_preview', aid=aid, **booking_navigation()))
        db.execute('DELETE FROM appointments WHERE id=?', (aid,))
    flash('ลบการจองแล้ว', 'ok')
    return redirect(booking_list_url(row['checkin']))


def transaction_filters():
    month = dashboard_month(request.args.get('month', ''))
    first, last = month, next_month(month) - timedelta(days=1)
    try:
        start = date.fromisoformat(request.args.get('start') or first.isoformat())
        end = date.fromisoformat(request.args.get('end') or last.isoformat())
    except ValueError:
        start, end = first, last
    if start > end:
        start, end = end, start
    kind = request.args.get('kind', 'all')
    if kind not in ('all', 'income', 'expense'):
        kind = 'all'
    return dict(start=start.isoformat(), end=end.isoformat(), kind=kind)


@app.route('/transactions',methods=['GET','POST'])
def transactions():
    filters = transaction_filters()
    with conn() as db:
        if request.method=='POST':
            kind=request.form.get('kind'); amount=float(request.form.get('amount',0))
            if kind not in ('income','refund','expense') or amount<0: abort(400)
            db.execute('BEGIN IMMEDIATE')
            customer_id = request.form.get('customer_id', type=int)
            if request.form.get('customer_id') and not db.execute(
                'SELECT 1 FROM customers WHERE id=? AND archived=0', (customer_id,)
            ).fetchone():
                abort(400)
            receipt=''; f=request.files.get('receipt')
            if f and f.filename:
                ext=Path(secure_filename(f.filename)).suffix.lower()
                if ext not in ('.jpg','.jpeg','.png','.webp','.pdf'): abort(400,'Unsupported receipt format')
                receipt=secrets.token_hex(16)+ext;f.save(UPLOADS/receipt)
            db.execute('''INSERT INTO transactions(occurred_on,kind,category,description,amount,customer_id,stay_id,merchant,payment_method,reference,note,receipt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',(
                request.form['occurred_on'],kind,request.form.get('category','ทั่วไป').strip(),request.form['description'].strip(),amount,
                customer_id,
                int(request.form['stay_id']) if request.form.get('stay_id') else None,
                request.form.get('merchant',''),request.form.get('payment_method','transfer'),request.form.get('reference',''),request.form.get('note',''),receipt))
            db.commit();flash('บันทึกรายการแล้ว','ok');return redirect(url_for('transactions', _anchor='transaction-history', **filters))
        query = """SELECT t.*,c.name customer FROM transactions t
                   LEFT JOIN customers c ON c.id=t.customer_id WHERE t.occurred_on BETWEEN ? AND ?"""
        params = [filters['start'], filters['end']]
        if filters['kind'] != 'all':
            query += ' AND t.kind=?'
            params.append(filters['kind'])
        rows = db.execute(query + ' ORDER BY t.occurred_on DESC,t.id DESC', params).fetchall()
        customers=db.execute('SELECT * FROM customers WHERE archived=0 ORDER BY name').fetchall()
        stays=db.execute('SELECT s.id,c.name customer,s.checkin FROM stays s JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 200').fetchall()
    return render_template('transactions.html', rows=rows, customers=customers, stays=stays, filters=filters)

def managed_transaction_url(tx):
    if tx['stay_id'] and tx['kind']=='refund' and tx['payment_key']:
        return url_for('stay_summary',sid=tx['stay_id'],_anchor='stay-payment-history')
    if tx['payment_type'] == 'deposit' and tx['deposit_appointment_id']:
        return url_for('appointment_preview', aid=tx['deposit_appointment_id'], _anchor='deposit-records')
    if tx['stay_id'] and (tx['payment_type'] or tx['auto_stay']):
        return url_for('stay_summary', sid=tx['stay_id'])
    return None


app.jinja_env.globals['managed_transaction_url'] = managed_transaction_url


@app.route('/transactions/<int:tid>/edit',methods=['GET','POST'])
def transaction_edit(tid):
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        tx=db.execute('SELECT * FROM transactions WHERE id=?',(tid,)).fetchone()
        if not tx: abort(404)
        if tx and tx['stay_id'] and db.execute('SELECT 1 FROM stays WHERE id=? AND cancelled_at IS NOT NULL',
                                               (tx['stay_id'],)).fetchone():
            return redirect(url_for('stay_summary',sid=tx['stay_id'],_anchor='stay-payment-history'))
        if target := managed_transaction_url(tx):
            return redirect(target)
        if request.method == 'POST':
            form = request.form
            try:
                amount = money_cents(form['amount']) / 100
                day = date.fromisoformat(form['occurred_on']).isoformat()
                customer_id = int(form['customer_id']) if form.get('customer_id') else (
                    tx['customer_id'] if 'customer_id' not in form else None)
                stay_id = int(form['stay_id']) if form.get('stay_id') else (
                    tx['stay_id'] if 'stay_id' not in form else None)
                if form['kind'] not in ('income','refund','expense') or not form['category'].strip() or not form['description'].strip():
                    raise ValueError
            except (ValueError, InvalidOperation, KeyError):
                abort(400)
            if customer_id is not None and not db.execute('SELECT 1 FROM customers WHERE id=?', (customer_id,)).fetchone():
                abort(400)
            if stay_id is not None and not db.execute('SELECT 1 FROM stays WHERE id=?', (stay_id,)).fetchone():
                abort(400)
            uploaded = request.files.get('receipt')
            filename = tx['receipt']
            if uploaded and uploaded.filename:
                ext = Path(secure_filename(uploaded.filename)).suffix.lower()
                if ext not in ('.jpg','.jpeg','.png','.webp','.pdf'):
                    abort(400, 'Unsupported receipt format')
                filename = secrets.token_hex(16)+ext
                uploaded.save(UPLOADS/filename)
            db.execute("""UPDATE transactions SET occurred_on=?,kind=?,category=?,description=?,amount=?,merchant=?,
                          payment_method=?,reference=?,note=?,customer_id=?,stay_id=?,receipt=? WHERE id=?""",
                       (day,form['kind'],form['category'].strip(),form['description'].strip(),amount,
                        form.get('merchant',''),form.get('payment_method',tx['payment_method']),form.get('reference',''),
                        form.get('note',''),customer_id,stay_id,filename,tid))
            db.commit()
            if tx['receipt'] and filename != tx['receipt']:
                (UPLOADS/tx['receipt']).unlink(missing_ok=True)
            flash('แก้ไขแล้ว','ok')
            filters = transaction_filters() if request.args else {'month':day[:7]}
            return redirect(url_for('transactions', _anchor='transaction-history', **filters))
        customers = db.execute('SELECT id,name FROM customers WHERE archived=0 OR id=? ORDER BY name',
                               (tx['customer_id'],)).fetchall()
        stays = db.execute("""SELECT s.id,c.name customer,s.checkin FROM stays s JOIN customers c ON c.id=s.customer_id
                             WHERE s.id=? OR s.id IN (SELECT id FROM stays ORDER BY id DESC LIMIT 200)
                             ORDER BY s.id DESC""", (tx['stay_id'],)).fetchall()
    return render_template('transaction_edit.html', tx=tx, filters=transaction_filters(), customers=customers, stays=stays)

@app.post('/transactions/<int:tid>/delete')
def transaction_delete(tid):
    with conn() as db:
        if request.method == 'POST':
            db.execute('BEGIN IMMEDIATE')
        tx=db.execute('SELECT * FROM transactions WHERE id=?',(tid,)).fetchone()
        if tx and tx['stay_id'] and db.execute('SELECT 1 FROM stays WHERE id=? AND cancelled_at IS NOT NULL',
                                               (tx['stay_id'],)).fetchone():
            return redirect(url_for('stay_summary',sid=tx['stay_id'],_anchor='stay-payment-history'))
        if tx and (target := managed_transaction_url(tx)):
            return redirect(target)
        if tx:
            db.execute('DELETE FROM transactions WHERE id=?',(tid,));db.commit()
            if tx['receipt']: (UPLOADS/tx['receipt']).unlink(missing_ok=True)
    flash('ลบรายการแล้ว','ok');return redirect(url_for('transactions', _anchor='transaction-history', **transaction_filters()))

@app.get('/receipts/<path:filename>')
def receipt(filename):
    if filename!=Path(filename).name: abort(404)
    path=UPLOADS/filename
    if not path.is_file():abort(404)
    return send_file(path,as_attachment=True,download_name=filename)

@app.get('/export/<kind>.csv')
def export_csv(kind):
    if kind not in ('transactions','customers','dogs','stays'):abort(404)
    with conn() as db: rows=db.execute(f'SELECT * FROM {kind} ORDER BY id').fetchall()
    out=io.StringIO();writer=csv.writer(out)
    if rows:
        writer.writerow(rows[0].keys());writer.writerows([list(row) for row in rows])
    return Response('\ufeff'+out.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':f'attachment; filename="little-paws-{kind}.csv"'})

@app.get('/reports', defaults={'name': 'finance'})
@app.get('/reports/<name>')
def reports(name):
    from app.reports import REPORTS, make_report

    if name not in REPORTS:
        abort(404)
    today = coupon_today()
    start = today.replace(day=1)
    end = next_month(start)-timedelta(days=1)
    preset = request.args.get('range', 'month')
    try:
        if preset == 'year':
            year = int(request.args.get('year', today.year))
            start, end = date(year,1,1), date(year,12,31)
        elif preset == 'custom':
            start, end = sorted(date.fromisoformat(request.args[key]) for key in ('start','end'))
        else:
            start = date.fromisoformat(request.args.get('month',today.isoformat()[:7])+'-01')
            end = next_month(start)-timedelta(days=1)
    except (ValueError, KeyError, OverflowError):
        start = today.replace(day=1)
        end = next_month(start)-timedelta(days=1)
        preset = 'month'
    filters = {key: request.args.get(key, '') for key in ('kind','category','customer','service','status','code','segment')}
    lang = language()
    with conn() as db:
        db.execute('BEGIN')
        report = make_report(db, name, start, end, filters, lang, STAY_BALANCE_SQL)
        customers = db.execute('SELECT id,name FROM customers ORDER BY name').fetchall()
        categories = db.execute('SELECT DISTINCT category FROM transactions ORDER BY category').fetchall()
    export = request.args.get('export')
    if export in ('xlsx','pdf','png'):
        from app.report_exports import document, spreadsheet

        mime = {'xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'pdf':'application/pdf','png':'image/png'}
        output = spreadsheet(report) if export == 'xlsx' else document(report, lang, current_theme(), image=export=='png')
        return export_download(output, f'little-paws-{name}-{start.isoformat()}-{end.isoformat()}.{export}', lang, mime[export])
    return render_template('reports.html', reports=REPORTS, name=name, report=report, filters=filters,
                           customers=customers, categories=categories, preset=preset, start=start, end=end,
                           report_params={key:value for key,value in request.args.items() if key!='export'})


@app.get('/reports/guide', defaults={'chapter': 'usage'})
@app.get('/reports/guide/<chapter>')
def report_guide(chapter):
    from app.reports import REPORTS

    if chapter not in ('usage', 'backup'):
        abort(404)
    guide_images = {path.stem for path in (Path(app.static_folder) / 'guide').glob('*.webp')}
    return render_template('report_guide.html', chapter=chapter, reports=REPORTS, guide_images=guide_images)


@app.get('/backup')
def backup():
    # SQLite backup API ensures consistent snapshot even with WAL enabled.
    with tempfile.NamedTemporaryFile(suffix='.sqlite3') as temp:
        source=conn();dest=sqlite3.connect(temp.name)
        source.backup(dest);dest.close();source.close()
        temp.seek(0); data=temp.read()
    return Response(data,mimetype='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="little-paws-backup-{date.today().isoformat()}.sqlite3"'})

@app.post('/backup/archive.zip')
def backup_archive():
    stamp = now_local()
    output = tempfile.TemporaryFile()
    try:
        with tempfile.TemporaryDirectory() as folder, closing(conn()) as guard, guard:
            guard.execute('BEGIN IMMEDIATE')
            snapshot = Path(folder) / DATABASE_NAME
            with closing(conn()) as source, closing(sqlite3.connect(snapshot)) as dest:
                source.backup(dest)
                dest.execute('PRAGMA journal_mode=DELETE')
                receipts = receipt_names(dest)
            if any(Path(name).name != name or not (UPLOADS/name).is_file() for name in receipts):
                raise ValueError('Missing receipts')
            qr = payment_qr_path()
            files = [(snapshot, DATABASE_NAME)]
            files.extend((UPLOADS / name, f'receipts/{name}') for name in sorted(receipts))
            if qr.is_file():
                files.append((qr, PAYMENT_QR_NAME))
            if sum(path.stat().st_size for path, _ in files) > ARCHIVE_LIMIT:
                raise ValueError('Archive exceeds size limit')
            with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
                for path, name in files:
                    archive.write(path, name)
            set_setting(guard,'last_backup',stamp.isoformat(timespec='seconds'))
        output.seek(0)
        return send_file(output,mimetype='application/zip',as_attachment=True,
                         download_name=f'little-paws-{stamp:%Y-%m-%d-%H%M%S}.zip')
    except (OSError, ValueError, sqlite3.Error):
        output.close()
        flash('สร้างชุดสำรองไม่สำเร็จ กรุณาตรวจสอบไฟล์ใบเสร็จและพื้นที่จัดเก็บ','error')
        return redirect(url_for('settings',tab='backup'))


@app.post('/backup/verify')
def verify_backup():
    upload = request.files.get('archive')
    try:
        if not upload:
            raise ValueError('Missing archive')
        with tempfile.TemporaryDirectory() as folder:
            count = validate_archive(upload.stream, folder)
        flash(translate('ทดสอบกู้คืนสำเนาสำเร็จ พบไฟล์ใบเสร็จ {count} ไฟล์').format(count=count),'ok')
    except (OSError, ValueError, BadZipFile, sqlite3.Error, RuntimeError, NotImplementedError):
        flash('ทดสอบกู้คืนไม่สำเร็จ กรุณาตรวจสอบไฟล์ ZIP','error')
    return redirect(url_for('settings',tab='backup'))


if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.environ.get('PORT','8000')),debug=False)
