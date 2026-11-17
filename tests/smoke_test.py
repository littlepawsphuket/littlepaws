import io
import json
import os
import re
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with tempfile.TemporaryDirectory() as temp:
    os.environ['LITTLE_PAWS_DATA'] = temp
    from PIL import Image
    Image.new('RGB', (24, 24), 'white').save(Path(temp) / 'payment-qr.jpg')
    from app.main import app, conn, thai_date
    from app.stay_terms import TERMS_SNAPSHOT, TERMS_VERSION, TERMS_VERSIONS

    consent = dict(terms_ack='1', terms_version=TERMS_VERSION,
                   signature='[[[25,40],[40,95],[80,45]]]')

    app.config['TESTING'] = True
    client = app.test_client()
    today = date.today()
    checkout = today + timedelta(days=3)

    assert client.get('/').location == '/login'
    assert client.get('/backup').location == '/login'
    assert client.get('/payment-qr.jpg').location == '/login'
    assert client.get('/login').status_code == 200
    with client.session_transaction() as session:
        login_csrf = session['csrf']
    assert client.post('/login', data=dict(_csrf=login_csrf,username='admin',password='bad')).status_code == 401
    assert client.post('/login', data=dict(_csrf=login_csrf,username='admin',password='123456')).location == '/account/password'
    assert client.get('/').location == '/account/password'
    client.get('/account/password')
    with client.session_transaction() as session:
        password_csrf = session['csrf']
    assert client.post('/account/password', data=dict(_csrf=password_csrf,current_password='123456',
                       password='Test-admin-123',confirmation='Test-admin-123')).location == '/'
    assert client.get('/').status_code == 200
    history_page = client.get('/stays/history?start=2026-01-31&end=2026-01-01')
    assert history_page.status_code == 200
    assert 'href="/stays/history" aria-current="page"' in history_page.text
    assert 'name="start" value="2026-01-01"' in history_page.text
    assert 'id="stay-form"' not in history_page.text
    assert thai_date('2026-01-31') == '31 ม.ค. 2569'
    assert '31 ม.ค. 2569' in client.get('/appointments?view=day&date=2026-01-31').text
    assert '1 ม.ค. 2569 ถึง 31 ม.ค. 2569' in client.get('/transactions?month=2026-01').text
    assert client.get('/login').location == '/'
    assert client.get('/', headers={'Host': 'example.com'}).status_code == 400
    assert client.post('/customers', data={'name': 'Blocked'}).status_code == 403
    with client.session_transaction() as session:
        csrf = session['csrf']

    def post(path, **data):
        return client.post(path, data=dict(_csrf=csrf, **data))

    assert 'class="account-menu"' in client.get('/').text
    assert client.get('/account/photo').status_code == 404
    avatar_fixture = Path(__file__).resolve().parents[1] / 'app' / 'static' / 'little-paws-icon.png'
    assert post('/account/profile', display_name='Test Profile',
                photo=(io.BytesIO(avatar_fixture.read_bytes()),'avatar.png')).status_code == 302
    assert client.get('/account/photo').mimetype == 'image/jpeg'
    avatar_page = client.get('/').text
    assert 'src="/account/photo"' in avatar_page and 'Test Profile' in avatar_page
    assert app.test_client().get('/account/photo').location == '/login'
    assert post('/account/profile', display_name='Test Profile',remove_photo='1').status_code == 302
    assert client.get('/account/photo').status_code == 404

    assert client.get('/settings/users').status_code == 200
    assert post('/settings/users', username='team-test', display_name='Test User',
                role='staff', password='First-pass-123').status_code == 302
    with conn() as db:
        staff_id = db.execute("SELECT id FROM app_users WHERE username='team-test'").fetchone()[0]
    staff = app.test_client()

    def staff_login(password):
        staff.get('/login')
        with staff.session_transaction() as cookie:
            token = cookie['csrf']
        return staff.post('/login', data=dict(_csrf=token, username='TEAM-TEST', password=password))

    assert staff_login('First-pass-123').location == '/account/password'
    staff.get('/account/password')
    with staff.session_transaction() as cookie:
        token = cookie['csrf']
    assert staff.post('/account/password', data=dict(_csrf=token, current_password='First-pass-123',
                      password='Second-pass-123', confirmation='Second-pass-123')).location == '/'
    assert staff.get('/').status_code == 200
    assert staff.get('/settings/users').status_code == 403
    assert staff.get('/settings/backup').status_code == 403
    edit_user = f'/settings/users?edit={staff_id}'
    assert post(edit_user, username='team-test', display_name='Edited User', role='staff').status_code == 302
    assert 'Edited User' in client.get('/settings/users').text
    assert 'reset-password' in client.get(edit_user+'&reset=1').text
    assert post(edit_user, action='reset', password='Reset-pass-123', confirmation='Mismatch').status_code == 200
    assert staff.get('/').status_code == 200
    assert post(edit_user, action='reset', password='Reset-pass-123', confirmation='Reset-pass-123').status_code == 302
    assert staff.get('/').location == '/login'
    assert staff_login('Second-pass-123').status_code == 401
    assert post(edit_user, action='toggle').status_code == 302
    assert staff_login('Reset-pass-123').status_code == 401
    assert post(edit_user, action='toggle').status_code == 302
    assert staff_login('Reset-pass-123').location == '/account/password'
    staff.get('/account/password')
    with staff.session_transaction() as cookie:
        token = cookie['csrf']
    assert staff.post('/logout', data={'_csrf':token}).location == '/login'
    assert staff.get('/').location == '/login'

    assert post('/customers', name='Test owner', contact='Test contact').status_code == 302
    for name in ('Test dog A', 'Test dog B'):
        assert post('/customers/1', action='dog', dog_name=name, size='small').status_code == 302
    new_form = client.get('/stays').text
    key = re.search(r'name="create_key" value="([a-f0-9]+)"', new_form)[1]
    stay = dict(customer_id='1', dog_ids=['1', '2'], checkin=today.isoformat(), checkout=checkout.isoformat(),
                charged_nights='3', status='checked_in', rate_1='450.50', rate_2='550', discount='100')
    assert 'อัปเดตรูปภาพและวิดีโอให้เจ้าของทุกวัน' in new_form
    assert 'ความรับผิดชอบกรณีอุบัติเหตุและเจ็บป่วย' in new_form
    assert 'กรุณาติ๊กรับทราบ' in post('/stays', create_key=key, **stay).text
    bad_consent = {**consent, 'signature': '[[[10,10]]]'}
    assert 'กรุณาให้ลูกค้าเซ็นลายเซ็น' in post('/stays', create_key=key, **stay, **bad_consent).text
    with conn() as db:
        assert db.execute('SELECT COUNT(*) FROM stays').fetchone()[0] == 0
    saved_stay = post('/stays', create_key=key, **stay, **consent)
    assert saved_stay.location == '/stays/1/summary'
    assert post('/stays', create_key=key, **stay, **consent).status_code == 302
    with conn() as db:
        assert db.execute('SELECT COUNT(*) FROM stays').fetchone()[0] == 1
        original = tuple(db.execute('SELECT id,occurred_on,amount FROM transactions WHERE auto_stay=1').fetchone())
        assert original == (1, today.isoformat(), 2901.5)
        saved = db.execute('SELECT * FROM stay_consents WHERE stay_id=1').fetchall()
        assert len(saved) == 1 and saved[0]['terms'] == TERMS_SNAPSHOT
        assert saved[0]['customer_name'] == 'Test owner' and saved[0]['signed_at'].endswith('+07:00')
    summary = client.get(saved_stay.location).text
    assert all(value in summary for value in ('Test dog A', 'Test dog B', '2,901.50',
                                               '3,001.50', 'payment-qr.jpg', 'กลับไปหน้า Dashboard'))
    assert 'class="signature-preview"' in summary and '<polyline points="25,40 40,95 80,45 "' in summary
    assert client.get('/stays/99999/summary').status_code == 404
    assert '/stays/1/summary.pdf' in summary
    assert '/stays/1/summary.png?lang=th' in summary and '/stays/1/summary.png?lang=en' in summary and 'เลขจอง' not in summary
    assert client.get('/stays/1/summary.png?lang=en').headers['Content-Language'] == 'en'
    assert client.get('/stays/1/summary.png').data.startswith(b'\x89PNG')
    exported = client.get('/stays/1/summary.pdf')
    assert exported.status_code == 200 and exported.mimetype == 'application/pdf'
    assert exported.data.startswith(b'%PDF-') and 'little-paws-stay-1-th.pdf' in exported.headers['Content-Disposition']
    assert 'no-store' in exported.headers['Cache-Control']
    assert client.get('/stays/99999/summary.pdf').status_code == 404
    edit = client.get('/stays/1/edit').text
    assert 'รับทราบและลงลายเซ็นแล้ว' in edit and 'signature-preview' in edit
    assert '450.50' in edit and '550.00' in edit and '100.00' in edit
    stay['discount'] = '200'
    assert post('/stays/1/edit', **stay).status_code == 302
    with conn() as db:
        assert [tuple(r) for r in db.execute('SELECT id,occurred_on,amount FROM transactions')] == [
            (1, original[1], 2801.5)
        ]
    bad = dict(stay, discount='9999')
    assert 'ส่วนลดต้องไม่เกิน' in post('/stays/1/edit', **bad).text

    dash = client.get(f'/?from_month={today.year}-01&to_month={today.year}-12').text
    assert all(value in dash for value in ('2,801.50', 'Test owner', 'Test contact', 'Test dog B', f'{today.year}-12'))
    assert 'Test dog B' not in client.get('/stays?start=2000-01-01&end=2000-01-31').text.split('id="stay-history"')[1]
    assert client.get('/transactions/1/edit').location == '/stays/1/summary'
    assert post('/transactions/1/delete').location == '/stays/1/summary'
    assert post('/stays/1/status', status='cancelled').status_code == 302
    assert 'Test contact' not in client.get('/').text
    with conn() as db:
        assert db.execute('SELECT amount FROM transactions WHERE id=1').fetchone()[0] == 0
        db.execute("""INSERT INTO stays(id,customer_id,checkin,checkout,agreed_total)
                      VALUES(2,1,?,?,200)""", (today.isoformat(), checkout.isoformat()))
        db.execute('INSERT INTO stay_dogs(stay_id,dog_id) VALUES(2,1)')
        db.execute("""INSERT INTO transactions(occurred_on,kind,category,description,amount,stay_id)
                      VALUES(?,'income','legacy','legacy',200,2)""", (today.isoformat(),))
    assert 'รายการเดิมมียอดสุทธิ' in client.get('/stays/2/edit').text
    assert post('/stays/2/edit', **stay).status_code == 302
    with conn() as db:
        assert [tuple(r) for r in db.execute('SELECT amount,auto_stay FROM transactions WHERE stay_id=2')] == [(200, 0)]
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert client.get('/backup').data.startswith(b'SQLite format 3')
    assert client.get('/export/transactions.csv').status_code == 200
    assert '<h1>ภาพรวมธุรกิจ</h1>' in dash and 'class="page-banner"' not in dash
    for asset in ('little-paws-logo.png', 'little-paws-icon.png', 'paw-cursor.png'):
        assert client.get(f'/static/{asset}').status_code == 200
    assert 'stay-contact-dialog' in new_form
    assert client.post('/stays/contacts', data={'mode': 'customer', 'customer_name': 'Blocked'}).status_code == 403
    assert post('/stays/contacts', mode='customer', customer_name='  ').status_code == 400
    assert post('/stays/contacts', mode='dog', customer_id='999', dog_name='Missing owner').status_code == 400
    created = post('/stays/contacts', mode='customer', customer_name='Quick owner',
                   contact='Quick contact', dog_name='Quick puppy', size='medium')
    assert created.status_code == 201
    new_owner = created.json['customer']
    new_dog = created.json['dog']
    assert new_dog['customer_id'] == new_owner['id']
    assert post('/stays/contacts', mode='dog', customer_id=new_owner['id'],
                dog_name='Second puppy', size='large').status_code == 201
    assert post('/stays/contacts', mode='customer', customer_name='Owner only').json['dog'] is None
    with conn() as db:
        assert db.execute('SELECT contact FROM customers WHERE id=?', (new_owner['id'],)).fetchone()[0] == 'Quick contact'
        assert db.execute('SELECT COUNT(*) FROM dogs WHERE customer_id=?', (new_owner['id'],)).fetchone()[0] == 2
    assert 'Quick puppy' in client.get('/stays').text
    for asset in ('balen-gucci-dashboard.jpg', 'balen-gucci-stays.jpg'):
        assert client.get(f'/static/{asset}').status_code == 200
    assert post('/customers/1', name='Updated owner', contact='Updated contact').status_code == 302
    assert post('/customers/1/dogs/1/edit', dog_name='Updated dog', size='large', note='Updated note').status_code == 302
    assert post('/customers/1/dogs/1/edit', dog_name=' ', size='large').status_code == 400
    assert post(f"/customers/{new_owner['id']}/dogs/1/delete").status_code == 404
    assert client.post('/customers/1/delete').status_code == 403
    assert 'Updated dog' in client.get('/customers/1').text
    assert 'Updated owner' in client.get('/customers').text

    assert post('/customers/1/dogs/1/delete').status_code == 302
    active_dogs, history = client.get('/customers/1').text.split('<h2>ประวัติการเข้าพัก</h2>')
    assert 'Updated dog' not in active_dogs
    assert 'Updated dog, Test dog B' in history
    assert '/stays/1/summary?' in history and 'ยกเลิก' in history
    assert thai_date(today) in history
    other_customer = client.get(f"/customers/{new_owner['id']}").text.split('<h2>ประวัติการเข้าพัก</h2>')[1]
    assert 'Updated dog' not in other_customer
    assert 'ลูกค้ารายนี้ยังไม่มีประวัติการเข้าพัก' in other_customer
    new_page = client.get('/stays').text
    assert 'Updated dog' not in new_page.split('ประวัติการเข้าพัก')[0]
    assert 'Updated dog' in client.get('/stays/1/edit').text.split('id="stay-history"')[0]
    assert post('/customers/1/delete').status_code == 302
    assert 'Updated owner' not in client.get('/customers').text
    assert 'Updated owner' not in client.get('/stays').text.split('id="stay-history"')[0]
    assert 'Updated owner' in client.get('/stays/1/edit').text.split('id="stay-history"')[0]
    assert post('/stays/1/edit', **stay).status_code == 302
    assert post('/stays/contacts', mode='dog', customer_id='1', dog_name='Blocked').status_code == 400

    assert post(f"/customers/{new_owner['id']}/dogs/{new_dog['id']}/delete").status_code == 302
    assert post(f"/customers/{new_owner['id']}/delete").status_code == 302
    with conn() as db:
        assert db.execute('SELECT archived FROM customers WHERE id=1').fetchone()[0] == 1
        assert db.execute('SELECT archived FROM dogs WHERE id=1').fetchone()[0] == 1
        assert db.execute('SELECT 1 FROM stay_dogs WHERE dog_id=1').fetchone()
        assert db.execute('SELECT 1 FROM transactions WHERE id=1').fetchone()
        assert db.execute('SELECT 1 FROM dogs WHERE id=?', (new_dog['id'],)).fetchone() is None
        assert db.execute('SELECT 1 FROM customers WHERE id=?', (new_owner['id'],)).fetchone() is None
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    booking_owner = post('/stays/contacts', mode='customer', customer_name='Calendar owner',
                         contact='Calendar contact', dog_name='Calendar dog').json
    owner_id = str(booking_owner['customer']['id'])
    dog_id = str(booking_owner['dog']['id'])
    arrival = (today + timedelta(days=14)).isoformat()
    departure = (today + timedelta(days=17)).isoformat()
    form = client.get(f'/appointments/new?date={arrival}').text
    assert arrival in form and 'stay-signature-pad' not in form
    appointment_key = re.search(r'name="create_key" value="([a-f0-9]+)"', form)[1]
    payload = dict(customer_id=owner_id, dog_ids=[dog_id], checkin=arrival, checkout=departure,
                   charged_nights='3', discount='50', note='Calendar note')
    with conn() as db:
        counts = tuple(db.execute('SELECT (SELECT count(*) FROM stays),(SELECT count(*) FROM transactions)').fetchone())
    assert post('/appointments/new', create_key=appointment_key, **payload).status_code == 302
    assert post('/appointments/new', create_key=appointment_key, **payload).status_code == 302
    with conn() as db:
        assert db.execute('SELECT COUNT(*) FROM appointments').fetchone()[0] == 1
        number = db.execute('SELECT booking_number FROM appointments WHERE id=1').fetchone()[0]
        assert re.fullmatch(r'(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}', number)
        assert tuple(db.execute('SELECT (SELECT count(*) FROM stays),(SELECT count(*) FROM transactions)').fetchone()) == counts
    for term in (number.lower(), 'calendar owner', 'CALENDAR DOG'):
        search = client.get('/appointments', query_string={'view':'list','scope':'pending','q':term})
        assert search.status_code == 200 and 'Calendar dog' in search.text and 'name="q"' in search.text
    no_booking = client.get('/appointments?view=list&scope=pending&q=no-such-booking')
    assert 'Calendar dog' not in no_booking.text and 'ไม่พบรายการที่ตรงกับคำค้นหา' in no_booking.text
    for view in ('month', 'week', 'day', 'list'):
        page = client.get(f'/appointments?view={view}&date={arrival}')
        assert page.status_code == 200 and 'Calendar dog' in page.text
    dashboard = client.get('/').text
    assert 'Calendar dog' not in dashboard.split('สุนัขที่มีกำหนดเข้าพัก')[0]
    assert 'Calendar dog' in dashboard.split('สุนัขที่มีกำหนดเข้าพัก')[1]
    assert 'boarding-duration">3 วัน</strong>' in dashboard
    priced = {**payload, f'rate_{dog_id}': '600.25'}
    assert post('/appointments/1/edit', **priced).status_code == 302
    with conn() as db:
        assert db.execute('SELECT booking_number FROM appointments WHERE id=1').fetchone()[0] == number
    assert number in client.get('/appointments/1/edit').text
    assert client.get('/appointments/1/appointment.pdf').data.startswith(b'%PDF-')
    assert client.get('/appointments/1/appointment.png').data.startswith(b'\x89PNG')
    checkin = client.get('/appointments/1/check-in').text
    assert all(value in checkin for value in ('Calendar note', '600.25', arrival))
    assert 'วันเช็กอินจริงต้องเป็นวันนี้หรือก่อนหน้า' in post('/appointments/1/check-in', **priced).text
    priced.update(checkin=today.isoformat(), charged_nights='4')
    assert 'กรุณาติ๊กรับทราบ' in post('/appointments/1/check-in', **priced).text
    converted = post('/appointments/1/check-in', **priced, **consent)
    assert converted.status_code == 302 and converted.location.endswith('/summary')
    converted_summary = client.get(converted.location).text
    assert number in converted_summary and '<dd>4 วัน</dd>' in converted_summary
    converted_number = re.search(r'หมายเลขการเข้าพัก</dt><dd>([A-Z0-9]{6})</dd>', converted_summary)[1]
    assert converted_number != number
    for term in (converted_number.lower(), 'calendar owner', 'CALENDAR DOG'):
        search = client.get('/stays/history', query_string={
            'start':today.isoformat(), 'end':departure, 'status':'checked_in', 'q':term,
        })
        assert search.status_code == 200 and converted_number in search.text
    assert converted_number not in client.get('/stays/history?q=no-such-stay').text
    booking_fact = converted_summary.split('class="stay-summary-facts"', 1)[1].split('</dl>', 1)[0]
    reference = booking_fact.split('class="stay-reference"', 1)[1].split('</div>', 1)[0]
    assert converted_number in reference and '<span>เลขจอง</span>' in reference and number in reference

    assert client.get(converted.location+'.pdf').data.startswith(b'%PDF-')
    assert client.get(converted.location+'.png').data.startswith(b'\x89PNG')
    assert post('/appointments/1/check-in', **priced).location == converted.location
    with conn() as db:
        linked = db.execute('SELECT stay_id,checkin FROM appointments WHERE id=1').fetchone()
        assert linked['stay_id'] and linked['checkin'] == arrival
        assert db.execute('SELECT status FROM stays WHERE id=?', (linked['stay_id'],)).fetchone()[0] == 'checked_in'
        assert db.execute('SELECT amount FROM transactions WHERE stay_id=?', (linked['stay_id'],)).fetchone()[0] == 2351
        assert tuple(db.execute('SELECT (SELECT count(*) FROM stays),(SELECT count(*) FROM transactions)').fetchone()) == (counts[0]+1, counts[1]+1)
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    dashboard = client.get('/').text
    assert 'Calendar dog' in dashboard.split('สุนัขที่มีกำหนดเข้าพัก')[0]
    assert 'Calendar dog' not in dashboard.split('สุนัขที่มีกำหนดเข้าพัก')[1]
    assert post('/appointments/new', create_key='a'*32, **payload).status_code == 302
    assert post('/appointments/2/cancel').status_code == 404
    with conn() as db:
        db.execute("UPDATE appointments SET status='cancelled' WHERE id=2")
    assert post('/appointments/2/check-in', **priced).status_code == 302
    assert 'Calendar dog' not in client.get('/').text.split('สุนัขที่มีกำหนดเข้าพัก')[1]
    with conn() as db:
        db.execute('''INSERT INTO transactions(occurred_on,kind,category,description,amount,stay_id)
                      VALUES(?,'income','manual','manual',100,?)''', (today.isoformat(), linked['stay_id']))
    assert client.post(f"/stays/{linked['stay_id']}/delete").status_code == 403
    removed = post(f"/stays/{linked['stay_id']}/delete?start={today.isoformat()}&end={departure}")
    assert removed.status_code == 302 and '/summary' in removed.location
    with conn() as db:
        assert db.execute('SELECT 1 FROM stays WHERE id=?', (linked['stay_id'],)).fetchone()
        # Set up a receipt-free stay to exercise the original mistaken-entry deletion flow.
        db.execute("DELETE FROM transactions WHERE stay_id=? AND payment_type!=''", (linked['stay_id'],))
        db.execute("UPDATE transactions SET amount=0 WHERE stay_id=? AND description='manual'", (linked['stay_id'],))
    removed = post(f"/stays/{linked['stay_id']}/delete?start={today.isoformat()}&end={departure}")
    assert removed.status_code == 302 and 'start=' in removed.location
    with conn() as db:
        assert db.execute('SELECT 1 FROM stays WHERE id=?', (linked['stay_id'],)).fetchone() is None
        assert db.execute('SELECT 1 FROM stay_dogs WHERE stay_id=?', (linked['stay_id'],)).fetchone() is None
        assert db.execute('SELECT stay_id FROM appointments WHERE id=1').fetchone()[0] is None
        assert db.execute('SELECT stay_id FROM transactions WHERE description=?', ('manual',)).fetchone()[0] is None
        assert db.execute('SELECT 1 FROM transactions WHERE stay_id=?', (linked['stay_id'],)).fetchone() is None
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    assert 'Calendar dog' in client.get('/').text.split('สุนัขที่มีกำหนดเข้าพัก')[1]

    assets = Path(__file__).resolve().parents[1] / 'app' / 'static'
    from PIL import Image
    with Image.open(assets / 'balen-gucci-dashboard.jpg') as fixture_image:
        source_photo = io.BytesIO()
        fixture_image.resize((1600, 900)).save(source_photo, 'JPEG')
        photo = source_photo.getvalue()
    assert client.get(f'/dogs/{dog_id}/photo').status_code == 404
    assert post(f'/customers/{owner_id}/dogs/{dog_id}/edit', dog_name='Calendar dog', size='small',
                dog_camera=(io.BytesIO(photo), 'camera.jpg')).status_code == 302
    saved = client.get(f'/dogs/{dog_id}/photo')
    assert saved.mimetype == 'image/jpeg' and saved.data.startswith(b'\xff\xd8')
    with Image.open(io.BytesIO(saved.data)) as resized:
        assert resized.size == (768, 432)
    photo_path = f'/dogs/{dog_id}/photo'
    for path in (f'/customers/{owner_id}', '/', '/stays', '/appointments/new',
                 '/appointments/1/edit', '/appointments/1/check-in'):
        assert photo_path in client.get(path).text
    assert '🐾' in client.get('/stays').text
    assert post('/appointments/1/check-in', **priced, **consent).status_code == 302
    current_boarding = client.get('/').text.split('สุนัขที่มีกำหนดเข้าพัก')[0]
    assert photo_path in current_boarding and 'Calendar dog' in current_boarding
    assert f'เหลือ {(date.fromisoformat(departure)-today).days} วัน' in current_boarding
    assert 'class="pickup-today">กลับบ้านวันนี้' not in current_boarding
    with conn() as db:
        db.execute('UPDATE stays SET checkout=? WHERE id=(SELECT stay_id FROM appointments WHERE id=1)',
                   (today.isoformat(),))
    current_boarding = client.get('/').text.split('สุนัขที่มีกำหนดเข้าพัก')[0]
    assert 'class="pickup-today">กลับบ้านวันนี้' in current_boarding
    post(f'/customers/{owner_id}/dogs/{dog_id}/edit', dog_name='Calendar dog', size='small',
         dog_photo=(io.BytesIO(b'invalid'), 'invalid.jpg'))
    assert client.get(f'/dogs/{dog_id}/photo').data == saved.data
    with_photo = post('/stays/contacts', mode='dog', customer_id=owner_id, dog_name='Photo test',
                      dog_photo=(io.BytesIO((assets / 'little-paws-icon.png').read_bytes()), 'test.png'))
    assert with_photo.status_code == 201
    photo_dog = with_photo.json['dog']['id']
    assert with_photo.json['dog']['photo_url'] == f'/dogs/{photo_dog}/photo'
    assert client.get(f'/dogs/{photo_dog}/photo').status_code == 200
    assert post(f'/customers/{owner_id}/dogs/{photo_dog}/delete').status_code == 302
    assert client.get(f'/dogs/{photo_dog}/photo').status_code == 404
    with conn() as db:
        db.executemany('''INSERT INTO transactions(occurred_on,kind,category,description,amount)
                          VALUES(?,?,'test',?,1)''', [
            ('2000-01-31', 'income', 'Filter income'),
            ('2000-02-01', 'expense', 'Filter expense'),
            ('2000-02-01', 'refund', 'Filter refund'),
            ('2000-02-02', 'expense', 'Filter outside'),
        ])
    base = '/transactions?start=2000-01-31&end=2000-02-01'
    all_rows = client.get(base).text
    assert all(name in all_rows for name in ('Filter income', 'Filter expense', 'Filter refund'))
    assert 'Filter outside' not in all_rows
    income_only = client.get(base + '&kind=income').text
    assert 'Filter income' in income_only and 'Filter expense' not in income_only and 'Filter refund' not in income_only
    expense_only = client.get(base + '&kind=expense').text
    assert 'Filter expense' in expense_only and 'Filter income' not in expense_only
    assert 'Filter income' not in client.get('/transactions').text
    assert 'Filter income' in client.get('/transactions?month=2000-01').text
    current_terms = json.loads(TERMS_SNAPSHOT)
    old_terms = {**current_terms, 'sections': current_terms['sections'][:2]}
    with conn() as db:
        db.execute('UPDATE stay_consents SET terms=? WHERE stay_id=1', (json.dumps(old_terms),))
    old_summary = client.get('/stays/1/summary').text
    signed_terms, added_terms = old_summary.split('เงื่อนไขปัจจุบันที่เพิ่มหลังลงลายเซ็น')
    assert 'ความรับผิดชอบกรณีอุบัติเหตุและเจ็บป่วย' not in signed_terms
    assert 'ความรับผิดชอบกรณีอุบัติเหตุและเจ็บป่วย' in added_terms
    assert client.get('/stays/1/summary.pdf').status_code == 200
    english_dashboard = client.get('/?lang=en').text
    assert '<html lang="en">' in english_dashboard and 'Dogs currently boarding' in english_dashboard
    for path, heading in (('/stays', 'Boarding stays'), ('/customers', 'Customer list'),
                          ('/appointments?date=2026-01-31&view=day', '31 Jan 2026'),
                          ('/transactions', 'Income and expenses'), ('/appointments/new', 'Add booking')):
        assert heading in client.get(path).text
    form = client.get('/stays').text
    assert 'Dog boarding terms' in form and 'Responsibility for accidents and illness' in form
    assert 'name="terms_language" value="en"' in form
    en_pdf = client.get('/stays/1/summary.pdf?lang=en')
    th_pdf = client.get('/stays/1/summary.pdf?lang=th')
    assert en_pdf.headers['Content-Language'] == 'en' and th_pdf.headers['Content-Language'] == 'th'
    assert en_pdf.data != th_pdf.data and all(pdf.data.startswith(b'%PDF-') for pdf in (en_pdf, th_pdf))
    assert '<html lang="en">' in client.get('/customers').text
    english_summary = client.get('/stays/1/summary').text
    assert 'Current terms added after signing' in english_summary and 'Emergencies:' in english_summary
    new_stay = dict(customer_id=owner_id, dog_ids=[dog_id], checkin=today.isoformat(), checkout=departure,
                    charged_nights='1', status='checked_in', **{f'rate_{dog_id}': '500'})
    en_consent = dict(consent, terms_language='en', terms_version=TERMS_VERSIONS['en'])
    assert post('/stays', create_key='b'*32, **new_stay, **en_consent).status_code == 302
    with conn() as db:
        recorded = db.execute('SELECT signed_language,terms_en FROM stay_consents ORDER BY id DESC LIMIT 1').fetchone()
        assert recorded['signed_language'] == 'en' and 'Responsibility for accidents and illness' in recorded['terms_en']
    assert '<html lang="th">' in client.get('/?lang=th').text
    assert '/appointments/2/delete' in client.get(f'/appointments?view=list&date={arrival}').text
    assert client.post('/appointments/2/delete').status_code == 403
    assert post('/appointments/2/delete').status_code == 302
    assert client.get('/appointments/2/edit').status_code == 404
    assert post('/appointments/1/delete').status_code == 302
    with conn() as db:
        assert db.execute('SELECT COUNT(*) FROM appointments WHERE id IN (1,2)').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM appointment_dogs WHERE appointment_id IN (1,2)').fetchone()[0] == 0
        assert db.execute('SELECT 1 FROM stays WHERE id=?', (linked['stay_id'],)).fetchone()
        assert db.execute('SELECT 1 FROM transactions WHERE stay_id=?', (linked['stay_id'],)).fetchone()
    with conn() as db:
        db.execute("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights) VALUES(900,?,'2038-01-01','2038-01-03',2)", (owner_id,))
        db.execute("INSERT INTO appointments(id,customer_id,checkin,checkout,charged_nights,status) VALUES(901,?,'2038-01-01','2038-01-03',2,'cancelled')", (owner_id,))
    monthly = client.get('/appointments?view=list&date=2000-01-01').text
    all_pending = client.get('/appointments?view=list&date=2000-01-01&scope=pending').text
    assert 'แสดงทั้งหมด' in monthly and '/appointments/900/edit' not in monthly
    default_bookings = client.get('/appointments').text
    assert 'class="calendar-grid"' in default_bookings and 'scope=pending' in default_bookings
    assert 'การจองที่รอเช็กอินทั้งหมด' not in default_bookings
    default_list = client.get('/appointments?view=list').text
    assert 'การจองที่รอเช็กอินทั้งหมด' in default_list and '/appointments/900/edit' in default_list
    assert 'Little Paws, Big Love.' in default_bookings
    assert 'รอระบุราคา' in all_pending
    assert 'ดูตามเดือน' in all_pending and '/appointments/900/edit' in all_pending
    assert 'aria-label="ลบการจอง"' in all_pending and 'aria-label="เช็กอิน"' in all_pending
    assert '/appointments/900/cancel' not in all_pending
    assert '/appointments/901/delete' not in all_pending
    assert 'scope=pending' in post('/appointments/900/delete?scope=pending').location
    from app.intake import age_parts, read_dog_profile
    assert age_parts(date(2024, 2, 29), date(2025, 2, 28)) == (1, 0)
    assert read_dog_profile(dict(age_years='2', age_months='3'), date(2026, 11, 12)) == {
        'birth_date': '2024-08-12', 'birth_estimated': True,
    }
    updated_customer = post('/stays/contacts', mode='edit_customer', customer_id=owner_id,
                            customer_name='Calendar owner', owner_phone='0810000011',
                            line_id='calendar-demo', emergency_address='Demo emergency address')
    assert updated_customer.status_code == 200 and updated_customer.json['customer']['line_id'] == 'calendar-demo'
    assert 'Demo emergency address' in client.get(f'/customers/{owner_id}').text
    assert 'data-phone="0810000011"' in client.get('/stays').text
    assert post(f'/customers/{owner_id}', name='Calendar owner', owner_phone='0810000022').status_code == 302
    checkin_page = client.get('/stays').text
    assert 'data-phone="0810000022"' in checkin_page and 'data-line="calendar-demo"' in checkin_page
    assert 'name="received_by"' not in checkin_page and 'name="received_on"' not in checkin_page
    profile_path = f'/customers/{owner_id}/dogs/{dog_id}/profile'
    assert 'name="birth_date"' in client.get(profile_path).text
    edit_profile = client.post(f'/customers/{owner_id}/dogs/{dog_id}/edit',
                               headers={'Accept':'application/json'},
                               data=dict(_csrf=csrf, profile_fields='1', dog_name='Calendar dog', size='medium',
                                         breed='Corgi', gender='female', neutered='yes', age_years='2',
                                         age_months='3', age_source='age', vaccinated='yes', weight='10.25'))
    assert edit_profile.status_code == 200 and 'Corgi' in edit_profile.json['profile_html']
    assert '2 ปี 3 เดือน' in edit_profile.json['profile_html']
    assert 'Corgi' in client.get('/stays').text
    assert 'name="arrival_time"' not in client.get('/appointments/new').text
    with conn() as db:
        sid = db.execute('SELECT max(id) FROM stays WHERE customer_id=?', (owner_id,)).fetchone()[0]
    intake = dict(intake_fields='1', arrival_time='09:30', pickup_time='18:15',
                  service_type='daycare', 
                  health='normal', food='Kibble', exam_eyes='1', other_items='Harness')
    assert post(f'/stays/{sid}/edit', **new_stay, **intake).status_code == 302
    edit_page = client.get(f'/stays/{sid}/edit').text
    assert edit_page.index('name="arrival_time"') < edit_page.index('class="dog-picker"')
    assert 'value="09:30"' in edit_page and 'value="Kibble"' in edit_page
    assert 'name="food_packed" value="1"' in edit_page
    assert 'name="exam_eyes" value="1" data-exam-legacy' in edit_page
    assert 'name="exam_eyes" value="normal"' in edit_page and 'name="exam_eyes" value="abnormal"' in edit_page
    with conn() as db:
        details = json.loads(db.execute('SELECT intake FROM stays WHERE id=?', (sid,)).fetchone()[0])
        assert details['service_type'] == 'daycare'
        assert details['food_packed'] == details['exam_eyes'] == '1'
        assert details['food'] == 'Kibble' and details['other_items'] == 'Harness'
        assert 'breed' not in details
    assert post(f'/stays/{sid}/edit', **new_stay, **intake, intake_checklists='1').status_code == 302
    with conn() as db:
        details = json.loads(db.execute('SELECT intake FROM stays WHERE id=?', (sid,)).fetchone()[0])
        assert 'food' not in details and 'food_packed' not in details
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    defaults_page = client.get('/stays').text
    assert f'name="checkout" value="{today.isoformat()}"' in defaults_page
    assert 'name="arrival_time" type="time" value=""' not in defaults_page
    assert 'value="overnight" checked' in defaults_page
    assert f'name="rate_{dog_id}" min="0" max="999999999" step="0.01" value="500"' in defaults_page
    exam = dict(intake_fields='1', intake_checklists='1', exam_eyes='normal', exam_ears='abnormal')
    assert post(f'/stays/{sid}/edit', **new_stay, **exam).status_code == 302
    exam_page = client.get(f'/stays/{sid}/edit').text
    assert 'name="exam_eyes" value="normal" checked' in exam_page
    assert 'name="exam_ears" value="abnormal" checked' in exam_page
    assert post(f'/stays/{sid}/edit', **new_stay, **dict(exam, exam_eyes=['normal','abnormal'])).status_code == 200
    today_value = today.isoformat()
    payment_booking = dict(new_stay, status='pending', deposit_amount='100', deposit_date=today_value, deposit_time='14:35')
    preview = post('/appointments/new', create_key='c'*32, **payment_booking)
    assert preview.status_code == 302
    booking_path = preview.location
    preview_from_dashboard = client.get(booking_path+'?origin=dashboard').text
    assert 'href="/#upcoming-stays"' in preview_from_dashboard
    preview_from_list = client.get(booking_path+'?view=list&scope=pending').text
    assert 'href="/appointments?view=list&amp;' in preview_from_list and 'scope=pending' in preview_from_list
    assert '100.00' in client.get(booking_path).text and '14:35' in client.get(booking_path).text
    assert client.get(booking_path+'/deposit.pdf?lang=en').data.startswith(b'%PDF-')
    assert client.get(booking_path+'/deposit.png').data.startswith(b'\x89PNG')
    second_deposit = dict(payment_booking, deposit_amount='50', payment_key='second-deposit')
    assert post(booking_path+'/edit', **second_deposit).status_code == 302
    assert post(booking_path+'/edit', **second_deposit).status_code == 302
    assert post(booking_path+'/edit', **dict(second_deposit, deposit_amount='400', payment_key='excess')).status_code == 200
    with conn() as db:
        deposits = db.execute('SELECT id,amount FROM transactions WHERE deposit_appointment_id=? ORDER BY id',
                              (int(booking_path.rsplit('/',1)[1]),)).fetchall()
    assert [row['amount'] for row in deposits] == [100,50]
    pending_page = client.get('/appointments?view=list&scope=pending&lang=th').text
    assert 'ยอดคงเหลือ' in pending_page
    assert '<dt>มัดจำแล้ว</dt><dd>฿150.00</dd>' in pending_page
    assert 'ยอดที่คาดว่าจะรับเพิ่ม' in pending_page
    payment_row = next(row for row in pending_page.split('</tr>') if booking_path+'/edit' in row)
    assert all(f'฿{amount}' in payment_row for amount in ('500.00', '150.00', '350.00'))
    monthly_page = client.get(f'/appointments?view=list&date={today_value}').text
    assert '<dt>มัดจำแล้ว</dt><dd>฿150.00</dd>' in monthly_page
    monthly_row = next(row for row in monthly_page.split('</tr>') if booking_path+'/edit' in row)
    assert all(f'฿{amount}' in monthly_row for amount in ('500.00', '150.00', '350.00'))
    second_path = f"{booking_path}/deposits/{deposits[1]['id']}"
    assert second_path+'/delete' in client.get(booking_path).text
    assert client.get(f"/transactions/{deposits[1]['id']}/edit").location == booking_path+'#deposit-records'
    assert post(f"/transactions/{deposits[1]['id']}/delete").location == booking_path+'#deposit-records'
    assert client.get(second_path+'.pdf?lang=en').data.startswith(b'%PDF-')
    assert client.get(second_path+'.png').data.startswith(b'\x89PNG')
    assert client.post(second_path+'/delete').status_code == 403
    assert 'name="payment_amount"' in client.get(booking_path+'/check-in').text
    converted_with_deposit = post(booking_path+'/check-in', **new_stay, **en_consent,
                                  payment_amount='200', payment_date=today_value)
    assert converted_with_deposit.status_code == 302
    stay_path = converted_with_deposit.location.removesuffix('/summary')
    additional = dict(new_stay, payment_amount='150', payment_date=today_value, payment_key='payment-fixture')
    assert post(stay_path+'/edit', **additional).status_code == 302
    assert post(stay_path+'/edit', **additional).status_code == 302
    assert post(stay_path+'/edit', **dict(additional, payment_key='overpay')).status_code == 200
    assert 'payment-history' in client.get(stay_path+'/summary').text
    assert client.get(booking_path+'/appointment.pdf').data.startswith(b'%PDF-')
    assert client.get(stay_path+'/summary.png').data.startswith(b'\x89PNG')
    with conn() as db:
        income = db.execute("SELECT payment_type,amount,auto_stay FROM transactions WHERE stay_id=? ORDER BY id",
                            (int(stay_path.rsplit('/',1)[1]),)).fetchall()
        assert [tuple(row) for row in income] == [('deposit',100,0), ('deposit',50,0), ('checkin',200,0), ('additional',150,0)]
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    assert post(second_path+'/delete').location == stay_path+'/summary#stay-payment-history'
    remove_deposit = f"{stay_path}/payments/{deposits[1]['id']}/delete"
    assert post(remove_deposit, reason='  ').status_code == 302
    assert client.get(second_path+'.pdf').status_code == 200
    assert post(remove_deposit, reason='Duplicate deposit').status_code == 302
    assert client.get(second_path+'.pdf').status_code == 404
    assert 'Duplicate deposit' in client.get(stay_path+'/summary').text
    assert '50.00' in client.get(stay_path+'/summary').text
    with conn() as db:
        assert db.execute('SELECT 1 FROM transactions WHERE id=?', (deposits[1]['id'],)).fetchone() is None
    checkout_path = stay_path+'/check-out'
    assert checkout_path in client.get('/').text
    assert checkout_path in client.get('/stays').text
    assert client.post(checkout_path).status_code == 403
    checked_out = post(checkout_path+'?origin=dashboard')
    assert checked_out.location == '/#current-stays'
    assert checkout_path not in client.get('/').text and checkout_path not in client.get('/stays').text
    assert 'กลับบ้านแล้ว' in client.get(stay_path+'/summary?lang=th').text
    with conn() as db:
        stay_id = int(stay_path.rsplit('/', 1)[1])
        assert db.execute('SELECT status FROM stays WHERE id=?', (stay_id,)).fetchone()[0] == 'completed'
        assert db.execute('SELECT SUM(amount) FROM transactions WHERE stay_id=?', (stay_id,)).fetchone()[0] == 450
    undo_path = stay_path+'/recheck-in'
    assert undo_path in client.get(stay_path+'/summary').text
    assert undo_path in client.get('/stays/history').text
    assert client.post(undo_path).status_code == 403
    assert post(stay_path+'/status', status='checked_in').location == stay_path+'/summary'
    locked_summary = client.get(stay_path+'/summary').text
    assert 'stay-summary-status--completed">กลับบ้านแล้ว</span>' in locked_summary
    assert 'stay-summary-status--completed">Checked out</span>' in client.get(stay_path+'/summary?lang=en').text
    client.get(stay_path+'/summary?lang=th')
    assert stay_path+'/edit' not in locked_summary and stay_path+'/cancel' not in locked_summary
    assert 'class="secondary" disabled>แก้ไขรายการ</button>' in locked_summary
    assert 'class="danger" disabled>ยกเลิกรายการเข้าพัก</button>' in locked_summary
    assert client.get(stay_path+'/edit').location.startswith(stay_path+'/summary')
    assert post(stay_path+'/edit', **dict(new_stay, status='completed')).location.startswith(stay_path+'/summary')
    assert post(stay_path+'/cancel', reason='Locked stay').location == stay_path+'/summary'
    assert post(stay_path+'/delete').location == stay_path+'/summary'
    assert post(undo_path, admin_username='admin', admin_password='bad').status_code == 302
    stay_number = re.search(r'หมายเลขการเข้าพัก</dt><dd>([A-Z0-9]{6})</dd>', locked_summary)[1]
    with conn() as db:
        before_undo = db.execute('SELECT status,actual_checkin_at,actual_checkout_at FROM stays WHERE id=?', (stay_id,)).fetchone()
        assert before_undo['status'] == 'completed' and before_undo['actual_checkout_at']
    assert post(undo_path, admin_username='admin', admin_password='Test-admin-123').location == stay_path+'/summary'
    with conn() as db:
        assert tuple(db.execute('SELECT status,actual_checkin_at,actual_checkout_at FROM stays WHERE id=?', (stay_id,)).fetchone()) == (
            'checked_in', before_undo['actual_checkin_at'], None)
        assert db.execute('SELECT SUM(amount) FROM transactions WHERE stay_id=?', (stay_id,)).fetchone()[0] == 450
    assert 'stay-summary-status--checked_in">กำลังเข้าพัก</span>' in client.get(stay_path+'/summary').text
    assert stay_number in client.get(stay_path+'/summary').text
    assert checkout_path in client.get('/').text
    assert post(checkout_path).status_code == 302
    pricing = client.get('/settings').text
    assert 'name="overnight_small"' in pricing and 'value="400"' in pricing
    assert 'name="daycare_small"' in pricing and 'value="200"' in pricing
    rates = dict(overnight_small='410', overnight_medium='510', overnight_large='610',
                 daycare_small='205', daycare_medium='255', daycare_large='305')
    assert post('/settings', **rates).status_code == 302
    assert f'name="rate_{dog_id}" min="0" max="999999999" step="0.01" value="510.0"' in client.get('/stays').text
    assert post('/settings', **dict(rates, daycare_small='-1')).status_code == 200
    holiday = dict(name='Example closure', starts_on=today_value, ends_on=(today+timedelta(days=2)).isoformat())
    assert post('/settings/holidays', **holiday).status_code == 302
    with conn() as db:
        holiday_id = db.execute('SELECT max(id) FROM shop_holidays').fetchone()[0]
    assert 'Example closure' in client.get(f'/appointments?view=week&date={today_value}').text
    assert 'Example closure' in client.get(f'/appointments?view=day&date={today_value}').text
    assert post(f'/settings/holidays?edit={holiday_id}', **dict(holiday, name='Edited closure')).status_code == 302
    assert 'Edited closure' in client.get(f'/appointments?date={today_value}').text
    assert post(f'/settings/holidays?edit={holiday_id}', action='delete').status_code == 302
    assert 'Edited closure' not in client.get(f'/appointments?date={today_value}').text
    assert post('/settings/theme', theme='japan').status_code == 302
    japan = client.get('/').text
    assert '<body data-theme="japan">' in japan and 'theme-japan.webp' in japan
    assert japan.count('<h1>ภาพรวมธุรกิจ</h1>') == 1
    assert japan.index('<h1>ภาพรวมธุรกิจ</h1>') < japan.index('<main>')
    for route, title in [('/stays','รายการฝากเลี้ยง'),('/appointments','การจองฝากเลี้ยง'),
                         ('/stays/history','ประวัติการเข้าพัก'),('/customers','ลูกค้า'),
                         ('/reports/guide','คู่มือ'),('/settings/users','จัดการผู้ใช้')]:
        page = client.get(route).text
        heading = f'<h1>{title}</h1>'
        assert page.count(heading) == 1 and page.index(heading) < page.index('<main>')
    assert client.get('/static/theme-japan.webp').mimetype == 'image/webp'
    assert post('/settings/theme', theme='classic').status_code == 302
    expiry = (today+timedelta(days=30)).isoformat()
    assert post('/settings/coupons', kind='percent', value='10', expires_on=expiry, max_uses='1').status_code == 302
    created_coupon = post('/settings/coupons', kind='fixed', value='100', minimum='1000',
                          expires_on=expiry, max_uses='2')
    assert created_coupon.status_code == 302 and '?preview=' in created_coupon.location
    new_coupon_id = created_coupon.location.split('?preview=')[1]
    coupon_preview = client.get(created_coupon.location).text
    assert re.findall(r'href="(/settings/coupons/\d+/image.png)" data-image-export-auto', coupon_preview) == [
        f'/settings/coupons/{new_coupon_id}/image.png']
    assert 'data-image-export-auto' not in client.get('/settings/coupons').text
    with conn() as db:
        codes = dict(db.execute('SELECT kind,code FROM coupons'))
    assert all(re.fullmatch(r'[0-9]{6}', code) for code in codes.values())
    for image_url in re.findall(r'href="(/settings/coupons/\d+/image.png)"', client.get('/settings/coupons').text):
        image = client.get(image_url)
        assert image.mimetype == 'image/png' and image.data.startswith(b'\x89PNG')
        assert 'attachment' in image.headers['Content-Disposition']
    assert len(re.findall(r'href="(/settings/coupons/\d+/image.png)"', client.get('/settings/coupons').text)) == 2
    assert client.get('/settings/coupons/999999/image.png').status_code == 404
    assert post('/coupons/lookup', code=codes['fixed']).json['minimum_cents'] == 100000
    assert post('/coupons/lookup', code=codes['percent']).json['minimum_cents'] == 0
    with conn() as db:
        percent_id = db.execute("SELECT id FROM coupons WHERE kind='percent'").fetchone()[0]
    assert post(f'/settings/coupons/{percent_id}/edit', kind='percent', value='10', minimum='600',
                expires_on=expiry, max_uses='1').status_code == 302
    assert post('/coupons/lookup', code=codes['percent']).json['minimum_cents'] == 60000
    coupon_booking = post('/appointments/new', create_key='d'*32, **payment_booking)
    conversion_url = coupon_booking.location+'/check-in'
    too_small = post(conversion_url, **new_stay, **en_consent, coupon_code=codes['fixed'], payment_amount='0')
    assert too_small.status_code == 200
    assert post(conversion_url, **new_stay, **en_consent, coupon_code=codes['percent'], payment_amount='0').status_code == 200
    assert post(f'/settings/coupons/{percent_id}/edit', kind='percent', value='10', minimum='',
                expires_on=expiry, max_uses='1').status_code == 302
    used = post(conversion_url, **new_stay, **en_consent, coupon_code=codes['percent'], payment_amount='350')
    assert used.status_code == 302
    assert post('/coupons/lookup', code=codes['percent']).status_code == 400
    coupon_stay = int(used.location.split('/')[2])
    assert post('/coupons/lookup', code=codes['percent'], stay_id=coupon_stay).status_code == 200
    with conn() as db:
        assert tuple(db.execute('SELECT agreed_total,discount_cents FROM stays WHERE id=?', (coupon_stay,)).fetchone()) == (450,5000)
        assert db.execute('SELECT count(*) FROM coupon_uses').fetchone()[0] == 1
        db.execute("UPDATE coupons SET expires_on='2000-01-01' WHERE kind='fixed'")
    assert post('/coupons/lookup', code=codes['fixed']).status_code == 400
    assert post(f'/stays/{coupon_stay}/edit', **new_stay, coupon_code=codes['percent']).status_code == 302
    with conn() as db:
        assert db.execute('SELECT count(*) FROM coupon_uses').fetchone()[0] == 1
    assert codes['percent'] not in client.get('/settings/coupons').text
    assert codes['fixed'] not in client.get('/settings/coupons').text
    used_coupons = client.get('/settings/coupons?status=used').text
    expired_coupons = client.get('/settings/coupons?status=expired').text
    assert codes['percent'] in used_coupons and codes['fixed'] not in used_coupons
    assert codes['fixed'] in expired_coupons and codes['percent'] not in expired_coupons
    with conn() as db:
        edit_id = db.execute("SELECT id FROM coupons WHERE kind='percent'").fetchone()[0]
    edit_url = f'/settings/coupons/{edit_id}/edit?status=used'
    assert codes['percent'] in client.get(edit_url).text
    assert post(edit_url, kind='percent', value='25', expires_on=expiry, max_uses='2').status_code == 302
    assert post('/coupons/lookup', code=codes['percent']).json['value'] == 2500
    assert post('/coupons/lookup', code=codes['percent'], stay_id=coupon_stay).json['value'] == 5000
    assert post(edit_url, action='delete').status_code == 302
    assert client.get(f'/settings/coupons/{edit_id}/image.png').status_code == 404
    assert post('/coupons/lookup', code=codes['percent']).status_code == 400
    assert post(f'/stays/{coupon_stay}/edit', **new_stay, coupon_code=codes['percent']).status_code == 302
    with conn() as db:
        assert db.execute('SELECT discount_cents FROM stays WHERE id=?', (coupon_stay,)).fetchone()[0] == 5000
    assert 'data-suggest-balance' in client.get('/stays').text
    partial = post('/stays', create_key='e'*32, **new_stay, **en_consent, payment_amount='200', payment_time='09:35')
    assert partial.status_code == 302
    partial_id = int(partial.location.split('/')[2])
    assert '300.00' in client.get(partial.location).text
    with conn() as db:
        rows = db.execute('SELECT amount,auto_stay,payment_type FROM transactions WHERE stay_id=?', (partial_id,))
        assert [tuple(row) for row in rows] == [(200, 0, 'checkin')]
    customer_page = client.get(f"/customers/{new_stay['customer_id']}").text
    assert f'/stays/{partial_id}/summary#stay-payment-history' in customer_page
    assert '฿300.00' in customer_page and 'customer-outstanding-list' in customer_page
    assert 'value="300.00" required' in client.get(partial.location).text
    path = f'/stays/{partial_id}/payments'
    assert post(path, payment_amount='301', payment_date=today_value, payment_key='8'*32).status_code == 302
    for _ in range(2):
        assert post(path, payment_amount='100', payment_date=today_value, payment_key='9'*32).status_code == 302
    assert 'value="200.00" required' in client.get(partial.location).text
    assert post(path, payment_amount='200', payment_date=today_value, payment_time='14:27', payment_key='a'*32).status_code == 302
    paid_summary = client.get(partial.location+'?lang=th').text
    assert 'name="payment_amount"' not in paid_summary
    assert 'payment-qr.jpg' in paid_summary and 'ชำระครบแล้ว' in paid_summary
    assert f'/stays/{partial_id}/summary#stay-payment-history' not in client.get(
        f"/customers/{new_stay['customer_id']}").text
    with conn() as db:
        last_payment = db.execute('SELECT id FROM transactions WHERE stay_id=? AND payment_key=?',
                                  (partial_id, 'a'*32)).fetchone()[0]
    assert '09:35' in client.get(partial.location).text
    assert '14:27' in client.get(partial.location).text
    assert 'name="payment_time"' in client.get('/stays').text
    delete_url = f'{path}/{last_payment}/delete'
    assert client.post(delete_url, data={'reason':'Wrong amount'}).status_code == 403
    assert post(delete_url, reason='Wrong amount').status_code == 302
    assert post(path, payment_amount='200', payment_date=today_value, payment_key='a'*32).status_code == 302
    summary = client.get(partial.location).text
    assert 'Wrong amount' in summary and 'value="200.00" required' in summary
    assert post(f'/stays/{partial_id}/check-out').status_code == 302
    assert 'value="200.00" required' in client.get(partial.location).text
    assert post(path, payment_amount='200', payment_date=today_value, payment_key='b'*32).status_code == 302
    with conn() as db:
        completed_payment = db.execute('SELECT id FROM transactions WHERE stay_id=? AND payment_key=?',
                                       (partial_id, 'b'*32)).fetchone()[0]
    completed_delete = f'{path}/{completed_payment}/delete'
    paid_summary = client.get(partial.location).text
    assert completed_delete not in paid_summary and 'name="payment_amount"' not in paid_summary
    assert 'class="danger appointment-icon payment-delete-icon" disabled' in paid_summary
    assert post(completed_delete, reason='Locked payment').location == partial.location+'#stay-payment-history'
    with conn() as db:
        assert db.execute('SELECT amount FROM transactions WHERE id=?', (completed_payment,)).fetchone()[0] == 200
    assert post(f'/stays/{partial_id}/recheck-in', admin_username='admin',
                admin_password='Test-admin-123').location == partial.location
    assert completed_delete in client.get(partial.location).text
    assert post(completed_delete, reason='After recheck-in').status_code == 302
    from openpyxl import load_workbook
    for report_name in ('finance', 'balances', 'boarding', 'coupons', 'customers'):
        report_url = f'/reports/{report_name}?range=custom&start={today.year}-01-01&end={today.year}-12-31'
        report_page = client.get(report_url, follow_redirects=True)
        assert report_page.status_code == 200 and 'report-details' in report_page.text
        workbook = client.get(report_url+'&export=xlsx', follow_redirects=True)
        assert 'Details' in load_workbook(io.BytesIO(workbook.data)).sheetnames
        assert client.get(report_url+'&export=pdf', follow_redirects=True).data.startswith(b'%PDF-')
        assert client.get(report_url+'&export=png', follow_redirects=True).data.startswith(b'\x89PNG')
    with conn() as db:
        expense_id = db.execute(
            "INSERT INTO transactions(occurred_on,kind,category,description,amount,reference) VALUES(?,?,?,?,?,?)",
            (today.isoformat(), 'expense', 'Imported', 'Imported fixture', 274, 'sheet-import')).lastrowid
    edit_expense = f'/transactions/{expense_id}/edit?kind=expense&start={today}&end={today}'
    assert 'value="Imported"' in client.get(edit_expense).text
    assert post(edit_expense, kind='expense', occurred_on=today.isoformat(), category='อุปกรณ์', description='Imported fixture', amount='274.00', reference='sheet-import').status_code == 302
    with conn() as db:
        assert tuple(db.execute('SELECT category,amount,reference FROM transactions WHERE id=?',
                                (expense_id,)).fetchone()) == ('อุปกรณ์',274,'sheet-import')
    assert 'name="monthly_small"' in client.get('/settings').text
    assert post('/settings', **dict(rates, monthly_small='6500', monthly_medium='7500', monthly_large='')).status_code == 302
    monthly = post('/stays', create_key='f'*32, **dict(new_stay, charged_nights='1.4', **{f'rate_{dog_id}':'7500'}),
                   **en_consent, payment_amount='0', intake_fields='1', service_type='monthly')
    assert monthly.status_code == 302
    assert '10,500.00' in client.get(monthly.location).text
    monthly_summary = client.get(monthly.location+'?lang=th').text
    assert 'ฝากรายเดือน' in monthly_summary and '<dd>1.4 เดือน</dd>' in monthly_summary
    from app.operations import now_local
    from zipfile import ZipFile

    day = now_local().date().isoformat()
    assert post('/settings/capacity', capacity='1').status_code == 302
    post('/settings/holidays', name='Closure fixture', starts_on=day, ends_on=day)
    warning_data = dict(customer_id=owner_id, dog_ids=[str(dog_id)], checkin=day, checkout=day,
                        charged_nights='1', service_type='overnight', create_key='9'*32,
                        booking_warning_check='1', **{f'rate_{dog_id}':'400'})
    warned = post('/appointments/new', **warning_data)
    assert warned.status_code == 200
    token = re.search(r'name="booking_warning_token" value="([a-f0-9]+)"', warned.text)[1]
    assert 'ช่วงที่เลือกตรงกับวันหยุดร้าน' in warned.text
    assert 'จำนวนสุนัขเกินความจุที่ตั้งไว้' in warned.text
    assert 'มีสุนัขตัวเดิมในรายการที่ทับช่วงวันที่เลือก' in warned.text
    assert post('/appointments/new', **warning_data, booking_warning_token=token).status_code == 200
    assert post('/appointments/new', **warning_data, booking_warning_token=token,
                booking_warning_override='1').status_code == 302
    assert 'booking-preview-button' in client.get('/').text

    sid = int(partial.location.split('/')[2])
    care_base = f'/stays/{sid}/dogs/{dog_id}/care'
    assert post(care_base, kind='medicine', note='Care fixture').status_code == 302
    assert post(care_base, kind='custom', note='   ').status_code == 400
    custom_note = 'พาเดินเล่น <สนามหญ้า>'
    assert post(care_base, kind='custom', note=custom_note).status_code == 302
    dashboard = client.get('/?lang=th').text
    assert 'พาเดินเล่น &lt;สนามหญ้า&gt;' in dashboard and 'บันทึกกิจกรรม' in dashboard
    dashboard_en = client.get('/?lang=en').text
    assert 'Record activity' in dashboard_en and 'Edit activity' in dashboard_en
    assert 'Care fixture' in client.get('/').text
    assert post('/settings/care', activity='Grooming fixture').status_code == 302
    visible_checkboxes = re.findall(r'<input type="checkbox" name="customer_visible"[^>]+>', client.get(care_base).text)
    assert any('checked' in checkbox for checkbox in visible_checkboxes)
    assert any('checked' not in checkbox for checkbox in visible_checkboxes)
    assert 'Grooming fixture' in client.get('/').text
    assert post(care_base, kind='activity:Grooming fixture', note='Photo fixture',
                photos=(io.BytesIO((assets/'little-paws-icon.png').read_bytes()), 'care.png'),
                origin='timeline').location == care_base
    timeline = client.get(care_base)
    assert timeline.status_code == 200 and 'Grooming fixture' in timeline.text
    photo_url = re.search(r'/care/photos/\d+', timeline.text)[0]
    assert client.get(photo_url).mimetype == 'image/jpeg'
    past_day = (date.fromisoformat(day)-timedelta(days=1)).isoformat()
    retrospective = post(care_base, kind='walk', note='Retrospective fixture', origin='dashboard',
                         care_date=past_day, care_time='10:20')
    assert retrospective.location == f'{care_base}?day={past_day}'
    older = client.get(retrospective.location)
    assert 'Retrospective fixture' in older.text and '10:20' in older.text
    assert 'Retrospective fixture' not in client.get(care_base).text
    future = post(care_base, kind='walk', note='Future fixture', origin='dashboard',
                  care_date=(date.fromisoformat(day)+timedelta(days=1)).isoformat(), care_time='10:20')
    assert future.status_code == 302
    with conn() as db:
        assert db.execute("SELECT 1 FROM care_events WHERE note='Future fixture'").fetchone() is None
    assert post('/settings/care', activity='Grooming fixture', action='delete').status_code == 302
    assert 'Grooming fixture' in client.get(care_base).text
    with conn() as db:
        photo_event = db.execute("SELECT id FROM care_events WHERE stay_id=? AND note='Photo fixture'", (sid,)).fetchone()[0]
    old_photo_id = photo_url.rsplit('/',1)[1]
    photo_edit = f'{care_base}/{photo_event}/edit-time'
    assert 'value="existing-activity" selected' in client.get(care_base).text
    modified = post(photo_edit, kind='play', note='Updated care details', care_date=past_day,
                    care_time='12:15', remove_photos=old_photo_id, origin='timeline',
                    photos=(io.BytesIO((assets/'little-paws-icon.png').read_bytes()), 'updated.png'))
    assert modified.location == f'{care_base}?day={past_day}'
    assert 'Updated care details' not in client.get(care_base).text
    all_care = client.get(care_base+'?day=all')
    assert all_care.status_code == 200
    assert 'data-care-date-strip' in all_care.text and 'id="care-date-picker"' in all_care.text
    assert f'{care_base}?day={past_day}' in all_care.text
    selected_care = client.get(f'{care_base}?day={past_day}').text
    assert re.search(rf'href="{care_base}\?day={past_day}"[^>]+aria-current="page"', selected_care)

    assert all_care.text.index('Care fixture') < all_care.text.index('Updated care details')

    modified_page = client.get(modified.location).text
    assert 'Updated care details' in modified_page and '12:15' in modified_page
    with conn() as db:
        assert tuple(db.execute('SELECT kind,activity_label,note FROM care_events WHERE id=?', (photo_event,)).fetchone()) == (
            'custom', 'เล่น', 'Updated care details')
        assert db.execute('SELECT count(*) FROM care_photos WHERE event_id=?', (photo_event,)).fetchone()[0] == 1
    assert client.get(photo_url).status_code == 404
    for scope in ('today','all'):
        assert client.get(f'{care_base}/export.pdf?scope={scope}').data.startswith(b'%PDF-')
        assert client.get(f'{care_base}/export.png?scope={scope}').data.startswith(b'\x89PNG')
    with conn() as db:
        event_id, timestamp = db.execute("SELECT id,recorded_at FROM care_events WHERE stay_id=? AND note='Care fixture'",
                                         (sid,)).fetchone()
    edit_url = f'{care_base}/{event_id}/edit-time'
    assert client.post(edit_url, data={'care_time': '06:35'}).status_code == 403
    assert post(f'/stays/{sid}/dogs/99999/care/{event_id}/edit-time', care_time='06:35').status_code == 404
    assert 'Enter a valid activity time.' in client.get(post(edit_url, care_time='24:00').location).text
    edited = post(edit_url, care_time='06:35', origin='dashboard')
    assert edited.location == f'/#care-{sid}-{dog_id}'
    assert '06:35' in client.get(edited.location).text
    with conn() as db:
        assert tuple(db.execute('SELECT kind,recorded_at,note FROM care_events WHERE id=?', (event_id,)).fetchone()) == (
            'medicine', timestamp[:11] + '06:35:00+07:00', 'Care fixture')
    guest = app.test_client()
    share_form = f'{care_base}/share'
    assert guest.post(share_form, data={'action':'create'}).status_code == 403
    assert post(share_form, action='create').status_code == 302
    share_path = re.search(r'href="(/updates/[A-Za-z0-9_-]+)"',client.get(care_base).text)[1]
    assert post(share_form, action='create').status_code == 302
    assert share_path in client.get(care_base).text
    assert 'Care fixture' not in guest.get(share_path).text
    assert post(care_base, kind='walk', note='Guest-visible fixture', customer_visible='1',
                photos=(io.BytesIO((assets/'little-paws-icon.png').read_bytes()),'update.png')).status_code == 302
    public_page = guest.get(share_path)
    assert public_page.status_code == 200 and 'Guest-visible fixture' in public_page.text
    assert public_page.headers['Cache-Control'] == 'private, no-store'
    assert 'Care fixture' not in public_page.text and 'primary-nav' not in public_page.text
    assert guest.get('/customers').location == '/login'
    public_photo = re.search(r'src="(' + share_path + r'/photos/\d+)"',public_page.text)[1]
    assert guest.get(public_photo).mimetype == 'image/jpeg'
    other_photo = re.search(r'src="/care/photos/(\d+)"', modified_page)[1]
    assert guest.get(share_path+'/photos/'+other_photo).status_code == 404
    assert guest.get('/care/photos/'+other_photo).location == '/login'
    assert post(share_form, action='publish-day', day=past_day).status_code == 302
    default_guest = guest.get(share_path).text
    assert 'Guest-visible fixture' in default_guest and 'Retrospective fixture' not in default_guest
    assert f'day={past_day}&amp;lang=th' in default_guest
    assert re.search(r'href="[^"]+\?lang=th"\s+aria-current="page"', default_guest)
    older_guest = guest.get(share_path+'?day='+past_day).text
    assert 'Retrospective fixture' in older_guest and 'Guest-visible fixture' not in older_guest
    all_guest = guest.get(share_path+'?day=all').text
    assert 'Retrospective fixture' in all_guest and 'Guest-visible fixture' in all_guest
    assert 'Care fixture' not in all_guest
    english = guest.get(share_path+'?day=all&lang=en').text
    assert '<html lang="en">' in english and 'Download PDF' in english and 'Activity timeline' in english
    assert 'This link expires within 48 hours after check-out.' in english
    assert 'Retrospective fixture' in english and re.search(r'day=all&amp;lang=en"\s+aria-current="page"', english)
    from unittest.mock import patch
    from app.care_export import build_care_export
    with patch('app.care_export.build_care_export', wraps=build_care_export) as render_pdf:
        pdf_url = share_path+'/timeline.pdf?day='+past_day+'&lang=en'
        pdf = guest.get(pdf_url)
        assert pdf.data.startswith(b'%PDF-') and pdf.headers['Content-Language'] == 'en'
        dog, events, photos, lang, *_ = render_pdf.call_args.args
        assert 'owner' not in dog and lang == 'en'
        assert dog['profile_photo'] == client.get(f'/dogs/{dog_id}/photo').data
        assert guest.get(f'/dogs/{dog_id}/photo').location == '/login'
        assert all(event['recorded_at'][:10] == past_day for event in events)
        assert all(event['note'] != 'Care fixture' for event in events)
        assert len(photos) == 1
        assert guest.get(share_path+'/timeline.pdf?day=all').data.startswith(b'%PDF-')
        _, events, *_ = render_pdf.call_args.args
        timestamps = [event['recorded_at'] for event in events]
        assert len({stamp[:10] for stamp in timestamps}) > 1
        assert timestamps == sorted(timestamps, reverse=True)
    assert post(share_form, action='revoke').status_code == 302
    assert guest.get(share_path).status_code == 404
    assert guest.get(public_photo).status_code == 404
    assert guest.get(pdf_url).status_code == 404
    assert post(share_form, action='create').status_code == 302
    fresh_share = re.search(r'href="(/updates/[A-Za-z0-9_-]+)"',client.get(care_base).text)[1]
    assert fresh_share != share_path
    filter_url = '/stays/history?start=2000-01-01&end=2099-12-31'
    summary_href = f'href="/stays/{sid}/summary?'
    assert summary_href in client.get(filter_url + '&status=checked_in').text
    assert summary_href not in client.get(filter_url + '&status=completed').text
    assert post(f'/stays/{sid}/check-out').status_code == 302
    assert summary_href not in client.get(filter_url + '&status=checked_in').text
    assert summary_href in client.get(filter_url + '&status=completed').text
    assert summary_href in client.get(filter_url).text
    assert guest.get(fresh_share).status_code == 200
    with conn() as db:
        db.execute("UPDATE stays SET actual_checkout_at=? WHERE id=?", ((now_local()-timedelta(hours=30)).isoformat(),sid))
    assert 'name="care_link_hours" min="0" step="1" value="48"' in client.get('/settings/capacity').text
    assert guest.get(fresh_share).status_code == 200
    assert post('/settings/capacity', capacity='1', care_link_hours='24').status_code == 302
    assert guest.get(fresh_share).status_code == 404
    assert guest.get(fresh_share+'/timeline.pdf').status_code == 404
    assert post('/settings/capacity', capacity='1', care_link_hours='36').status_code == 302
    assert 'ลิงก์นี้จะหมดอายุภายใน 36 ชั่วโมงหลังเช็กเอาต์' in guest.get(fresh_share).text
    assert post(care_base, kind='food').status_code == 409
    assert edit_url not in client.get(f'/stays/{sid}/summary').text
    assert post(edit_url, care_time='07:40').location == f'/stays/{sid}/summary'
    assert post(f'{care_base}/{event_id}/delete').location == f'/stays/{sid}/summary'
    assert post(f'/stays/{sid}/recheck-in', admin_username='admin',
                admin_password='Test-admin-123').location == f'/stays/{sid}/summary'
    edited_history = post(edit_url, care_time='07:40')
    assert edited_history.location.endswith('?show_care=1#stay-care-history')
    history = client.get(edited_history.location).text
    assert '07:40' in history and 'พาเดินเล่น &lt;สนามหญ้า&gt;' in history
    moved = post(edit_url, care_date=past_day, care_time='11:05')
    assert moved.location == f'{care_base}?day={past_day}'
    assert '11:05' in client.get(moved.location).text
    assert 'Care fixture' not in client.get(care_base).text
    with conn() as db:
        assert db.execute('SELECT recorded_at FROM care_events WHERE id=?', (event_id,)).fetchone()[0] == past_day + 'T11:05:00+07:00'
    care_url = f'{care_base}/{event_id}/delete'
    assert client.post(care_url).status_code == 403
    assert post(f'/stays/{sid}/dogs/99999/care/{event_id}/delete').status_code == 404
    assert 'Care fixture' in client.get(partial.location).text
    removed_care = post(care_url)
    assert removed_care.status_code == 302
    assert 'Care fixture' not in client.get(removed_care.location).text
    client.get('/?lang=th')
    with conn() as db:
        active_payments = [tuple(row) for row in db.execute(
            "SELECT payment_type,amount,payment_key FROM transactions WHERE stay_id=? AND payment_type!='' ORDER BY id", (sid,))]
    assert active_payments
    for _ in range(2):
        assert post(f'/stays/{sid}/cancel', reason='Cancellation fixture').status_code == 302
    assert summary_href not in client.get(filter_url).text
    assert summary_href not in client.get(filter_url.replace('/stays/history?', '/stays?')).text
    cancelled_summary = client.get(f'/stays/{sid}/summary').text
    assert 'Cancellation fixture' in cancelled_summary and 'name="payment_amount"' not in cancelled_summary
    assert post(f'/stays/{sid}/refund', reason='Refund fixture', amount='100',
                date=day, payment_key='e'*32).status_code == 302
    with conn() as db:
        actual = db.execute('SELECT actual_checkin_at,actual_checkout_at,cancel_reason FROM stays WHERE id=?',
                            (sid,)).fetchone()
        assert actual[0] and actual[1] is None and actual[2] == 'Cancellation fixture'
        assert not db.execute("SELECT 1 FROM transactions WHERE stay_id=? AND (payment_type!='' OR kind='refund')", (sid,)).fetchone()
        assert [tuple(row) for row in db.execute(
            "SELECT payment_type,amount,payment_key FROM stay_payment_deletions WHERE stay_id=? AND reason=? ORDER BY id",
            (sid, 'Cancellation fixture'))] == active_payments

    from app.main import UPLOADS
    (UPLOADS/'backup-fixture.pdf').write_bytes(b'%PDF-fixture')
    with conn() as db:
        db.execute("UPDATE transactions SET receipt='backup-fixture.pdf' WHERE id=?", (expense_id,))
    archive = post('/backup/archive.zip')
    assert archive.status_code == 200, archive.location
    with ZipFile(io.BytesIO(archive.data)) as bundle:
        assert bundle.read('receipts/backup-fixture.pdf') == b'%PDF-fixture'
    verify = post('/backup/verify', archive=(io.BytesIO(archive.data),'backup.zip'))
    assert verify.status_code == 302
    assert 'ทดสอบกู้คืนสำเนาสำเร็จ' in client.get(verify.location).text
    with conn() as db:
        admin_id = db.execute("SELECT id FROM app_users WHERE username='admin'").fetchone()[0]
    assert post(f'/settings/users?edit={admin_id}', action='reset', password='Admin-temp-123',
                confirmation='Admin-temp-123').location == '/login'
    client.get('/login')
    with client.session_transaction() as cookie:
        token = cookie['csrf']
    assert client.post('/login', data=dict(_csrf=token, username='admin',
                       password='Admin-temp-123')).location == '/account/password'
    print('Smoke tests passed')
