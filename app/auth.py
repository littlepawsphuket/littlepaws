import re
from collections import OrderedDict
from contextlib import closing
from datetime import timedelta
from threading import Lock
from time import monotonic

from flask import Blueprint, Response, abort, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash


PUBLIC_CARE_ENDPOINTS = ('public_care_timeline', 'public_care_photo', 'public_care_pdf')


USERNAME = re.compile(r'[A-Za-z0-9_.-]{3,32}')
LOGIN_WINDOW = 60
LOGIN_LIMIT = 10
PASSWORD_MIN = 8


class CredentialAttempts:
    def __init__(self):
        self.attempts = OrderedDict()
        self.lock = Lock()

    def allow(self, key):
        now = monotonic()
        with self.lock:
            while self.attempts and (now - next(iter(self.attempts.values()))[0] >= LOGIN_WINDOW or len(self.attempts) > 256):
                self.attempts.popitem(last=False)
            started, count = self.attempts.get(key, (now, 0))
            if count >= LOGIN_LIMIT:
                return False
            self.attempts[key] = (started, count+1)
            return True

    def reset(self, key):
        with self.lock:
            self.attempts.pop(key, None)


DUMMY_HASH = generate_password_hash('unused-authentication-comparison')
admin_attempts = CredentialAttempts()


def matching_password(user, password):
    return len(password) <= 128 and check_password_hash(user['password_hash'] if user else DUMMY_HASH,password) and user is not None


def init_users(db):
    db.execute("""CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        needs_password INTEGER NOT NULL DEFAULT 1 CHECK(needs_password IN (0,1)),
        session_version INTEGER NOT NULL DEFAULT 0
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS app_user_photos (
        user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
        photo BLOB NOT NULL
    )""")
    if db.execute('SELECT 1 FROM app_users LIMIT 1').fetchone() is None:
        db.execute("INSERT INTO app_users(username,display_name,password_hash,is_admin) VALUES ('admin','Admin',?,1)",
                   (generate_password_hash('123456'),))


def valid_password(password):
    return PASSWORD_MIN <= len(password) <= 128 and bool(password.strip())


def register_auth(app, connect, read_photo):
    auth = Blueprint('auth', __name__)
    app.permanent_session_lifetime = timedelta(hours=12)
    attempts = CredentialAttempts()

    def switch_session(user=None, version=None):
        language = session.get('language')
        session.clear()
        if language:
            session['language'] = language
        if user is not None:
            session.permanent = True
            session['user_id'] = user['id']
            session['user_version'] = user['session_version'] if version is None else version

    @auth.before_app_request
    def require_login():
        if request.endpoint in (None, *PUBLIC_CARE_ENDPOINTS) or (request.endpoint == 'static' and
                                        request.view_args.get('filename') != 'payment-qr.jpg'):
            return
        user_id = session.get('user_id')
        if user_id is not None:
            with closing(connect()) as db:
                user = db.execute('''SELECT u.*, EXISTS(SELECT 1 FROM app_user_photos WHERE user_id=u.id) has_photo
                                     FROM app_users u WHERE id=? AND active=1''', (user_id,)).fetchone()
            if user is not None and user['session_version'] == session.get('user_version'):
                g.user = user
        if request.endpoint in ('auth.login', 'auth.logout'):
            return
        user = g.get('user')
        if user is None:
            return redirect(url_for('auth.login'))
        if user['needs_password'] and request.endpoint != 'auth.password':
            return redirect(url_for('auth.password'))
        if not user['is_admin'] and (request.endpoint in ('backup','backup_archive','verify_backup') or
                                    request.endpoint == 'settings' and request.view_args.get('tab') == 'backup'):
            abort(403)

    @auth.after_app_request
    def prevent_cached_pages(response):
        if response.mimetype in ('text/html', 'application/json') or (request.endpoint == 'static' and
                request.view_args.get('filename') == 'payment-qr.jpg'):
            response.headers['Cache-Control'] = 'private, no-store'
        return response

    @auth.route('/login', methods=['GET','POST'])
    def login():
        if g.get('user') is not None:
            return redirect(url_for('auth.password' if g.user['needs_password'] else 'dashboard'))
        if request.method == 'POST':
            username = request.form.get('username','').strip()
            password = request.form.get('password','')
            key = request.remote_addr
            if not attempts.allow(key):
                flash('ลองเข้าสู่ระบบหลายครั้ง กรุณารอ 1 นาที', 'error')
                return render_template('login.html', username=username), 429
            with closing(connect()) as db:
                user = db.execute('SELECT * FROM app_users WHERE username=? AND active=1', (username,)).fetchone()
            if matching_password(user,password):
                attempts.reset(key)
                switch_session(user)
                return redirect(url_for('auth.password' if user['needs_password'] else 'dashboard'))
            flash('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error')
            return render_template('login.html', username=username), 401
        return render_template('login.html', username='')

    @auth.post('/logout')
    def logout():
        switch_session()
        return redirect(url_for('auth.login'))

    @auth.route('/account/profile', methods=['GET','POST'])
    def profile():
        user = g.user
        display_name = user['display_name']
        if request.method == 'POST':
            display_name = request.form.get('display_name','').strip()
            upload = request.files.get('photo')
            remove = request.form.get('remove_photo') == '1'
            try:
                if not 1 <= len(display_name) <= 80:
                    raise ValueError('กรุณาระบุชื่อที่แสดง')
                photo = read_photo(upload) if upload and upload.filename else None
            except ValueError as error:
                flash(str(error), 'error')
            else:
                with closing(connect()) as db, db:
                    changed = db.execute("""UPDATE app_users SET display_name=?
                                            WHERE id=? AND active=1 AND session_version=?""",
                                         (display_name,user['id'],user['session_version'])).rowcount
                    if not changed:
                        return redirect(url_for('auth.login'))
                    if photo is not None:
                        db.execute("""INSERT INTO app_user_photos(user_id,photo) VALUES(?,?)
                                      ON CONFLICT(user_id) DO UPDATE SET photo=excluded.photo""",(user['id'],photo))
                    elif remove:
                        db.execute('DELETE FROM app_user_photos WHERE user_id=?',(user['id'],))
                flash('บันทึกโปรไฟล์แล้ว','ok')
                return redirect(url_for('auth.profile'))
        return render_template('account_profile.html', display_name=display_name)

    @auth.get('/account/photo')
    def photo():
        with closing(connect()) as db:
            image = db.execute('SELECT photo FROM app_user_photos WHERE user_id=?',(g.user['id'],)).fetchone()
        if image is None:
            abort(404)
        return Response(image['photo'], mimetype='image/jpeg', headers={'Cache-Control':'private, no-store'})

    @auth.route('/account/password', methods=['GET','POST'])
    def password():
        user = g.user
        if request.method == 'POST':
            current = request.form.get('current_password','')
            new = request.form.get('password','')
            if (len(current)>128 or not check_password_hash(user['password_hash'],current) or
                    not valid_password(new) or new == current or new != request.form.get('confirmation')):
                flash('ตรวจรหัสผ่านเดิมและรหัสใหม่ให้ถูกต้อง รหัสใหม่ต้องมีอย่างน้อย 8 ตัวอักษรและต่างจากรหัสเดิม', 'error')
            else:
                hashed = generate_password_hash(new)
                with closing(connect()) as db, db:
                    changed = db.execute("""UPDATE app_users SET password_hash=?,needs_password=0,session_version=session_version+1
                                            WHERE id=? AND active=1 AND session_version=?""",
                                         (hashed,user['id'],user['session_version'])).rowcount
                if not changed:
                    switch_session()
                    return redirect(url_for('auth.login'))
                switch_session(user, user['session_version']+1)
                flash('เปลี่ยนรหัสผ่านแล้ว', 'ok')
                return redirect(url_for('dashboard'))
        return render_template('account_password.html')

    @auth.route('/settings/users', methods=['GET','POST'])
    def users():
        if not g.user['is_admin']:
            abort(403)
        editing_id = request.args.get('edit', type=int)
        with closing(connect()) as db, db:
            if request.method == 'POST':
                db.execute('BEGIN IMMEDIATE')
                # Recheck permission after taking the write lock.
                actor = db.execute('SELECT is_admin,active,session_version FROM app_users WHERE id=?',(g.user['id'],)).fetchone()
                if actor is None or not actor['active'] or not actor['is_admin'] or actor['session_version'] != g.user['session_version']:
                    abort(403)
            editing = db.execute('SELECT * FROM app_users WHERE id=?',(editing_id,)).fetchone() if editing_id else None
            if editing_id and editing is None:
                abort(404)
            if request.method == 'POST':
                try:
                    update_user(db, editing)
                except (ValueError, UserConflict) as error:
                    flash(str(error), 'error')
                else:
                    if request.form.get('action') == 'reset':
                        if editing['id'] == g.user['id']:
                            switch_session()
                            flash('ตั้งรหัสผ่านชั่วคราวแล้ว กรุณาเข้าสู่ระบบอีกครั้ง', 'ok')
                            return redirect(url_for('auth.login'))
                        flash('ตั้งรหัสผ่านชั่วคราวแล้ว', 'ok')
                        return redirect(url_for('auth.users'))
                    flash('บันทึกผู้ใช้แล้ว', 'ok')
                    return redirect(url_for('auth.users'))
            rows = db.execute('SELECT id,username,display_name,is_admin,active,needs_password FROM app_users ORDER BY active DESC,username').fetchall()
        return render_template('users.html', users=rows, editing=editing, tab='users',
                               submitted=request.form if request.method == 'POST' else {})

    app.register_blueprint(auth)


class UserConflict(Exception):
    pass


def update_user(db, editing):
    action = request.form.get('action','save')
    if action == 'reset' and editing:
        password = request.form.get('password','')
        if not valid_password(password):
            raise ValueError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
        if password != request.form.get('confirmation'):
            raise ValueError('รหัสผ่านที่กรอกทั้งสองช่องไม่ตรงกัน')
        db.execute("""UPDATE app_users SET password_hash=?,needs_password=1,session_version=session_version+1
                      WHERE id=?""",(generate_password_hash(password),editing['id']))
        return

    if action == 'toggle' and editing:
        active = not editing['active']
        if not active:
            protect_admin(db,editing)
        db.execute('UPDATE app_users SET active=?,session_version=session_version+1 WHERE id=?',(active,editing['id']))
        return

    if action != 'save':
        abort(400)
    username = request.form.get('username','').strip()
    display_name = request.form.get('display_name','').strip()
    role = request.form.get('role','')
    if not USERNAME.fullmatch(username) or not 1 <= len(display_name) <= 80 or role not in ('admin','staff'):
        raise ValueError('กรุณาตรวจชื่อผู้ใช้ ชื่อแสดง และสิทธิ์')
    if db.execute('SELECT 1 FROM app_users WHERE username=? AND id IS NOT ?',
                  (username, editing['id'] if editing else None)).fetchone():
        raise UserConflict('ชื่อผู้ใช้นี้ถูกใช้แล้ว')
    is_admin = role == 'admin'
    if editing:
        if editing['is_admin'] and not is_admin:
            protect_admin(db,editing)
        changed_access = is_admin != editing['is_admin'] or username != editing['username']
        db.execute("""UPDATE app_users SET username=?,display_name=?,is_admin=?,session_version=session_version+?
                      WHERE id=?""",(username,display_name,is_admin,changed_access,editing['id']))
    else:
        password = request.form.get('password','')
        if not valid_password(password):
            raise ValueError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
        db.execute('INSERT INTO app_users(username,display_name,is_admin,password_hash) VALUES (?,?,?,?)',
                   (username,display_name,is_admin,generate_password_hash(password)))


def protect_admin(db, user):
    if user['id'] == g.user['id'] or (user['active'] and user['is_admin'] and not db.execute(
            'SELECT 1 FROM app_users WHERE active=1 AND is_admin=1 AND id<>?',(user['id'],)).fetchone()):
        raise UserConflict('ต้องมีแอดมินที่ใช้งานได้ และคุณไม่สามารถปิดหรือถอดสิทธิ์บัญชีที่กำลังใช้')
