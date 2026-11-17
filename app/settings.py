import json


DEFAULT_RATES = {
    'overnight': {'small': 400, 'medium': 500, 'large': 600},
    'monthly': {'small': None, 'medium': None, 'large': None},
    'daycare': {'small': 200, 'medium': 250, 'large': 300},
}
SERVICES = {'overnight': 'ฝากค้างคืน', 'daycare': 'ฝากระหว่างวัน', 'monthly': 'ฝากรายเดือน'}
THEMES = {
    'classic': ('Little Paws', '🐾'),
    'christmas': ('คริสต์มาส', '🎄 ✦ ❄️'),
    'valentine': ('วาเลนไทน์', '🌹 ♡ 💌'),
    'halloween': ('ฮาโลวีน', '🎃 ✦ 🦇'),
    'songkran': ('สงกรานต์', '🌺 💦 🌼'),
    'buddhist': ('วันสำคัญทางพระพุทธศาสนา', '🪷 ✧ 🕯️'),
    'japan': ('ญี่ปุ่น', '🌸 🗻 ⛩️'),
}


def get_setting(db, key, default):
    row = db.execute('SELECT value FROM system_settings WHERE key=?', (key,)).fetchone()
    return json.loads(row['value']) if row else default


def set_setting(db, key, value):
    db.execute('''INSERT INTO system_settings(key,value) VALUES(?,?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value''', (key, json.dumps(value)))

RATE_UNITS = {'overnight': 'บาท/คืน', 'daycare': 'บาท/วัน', 'monthly': 'บาท/เดือน'}


def configured_rates(db):
    saved = get_setting(db, 'rates', {})
    return {service: {**defaults, **saved.get(service, {})} for service, defaults in DEFAULT_RATES.items()}
