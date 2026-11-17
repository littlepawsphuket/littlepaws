"""Exercise the migration and Worker against a synthetic SQLite backup."""

import os
import sqlite3
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from cloudflare.export_data import export

with TemporaryDirectory() as folder:
    root = Path(folder)
    os.environ['LITTLE_PAWS_DATA'] = str(root / 'original')
    from app.main import DB, conn

    with conn() as db:
        db.execute("INSERT INTO customers(id,name) VALUES(1,'Fixture owner')")
        db.execute("INSERT INTO dogs(id,customer_id,name) VALUES(1,1,'<script>Fixture dog'),(2,1,'Other dog')")
        db.execute("""INSERT INTO stays(id,customer_id,checkin,checkout,status,actual_checkout_at)
                      VALUES(1,1,'2026-01-01','2026-01-03','checked_in',NULL),
                            (2,1,'2026-01-01','2026-01-03','completed','2026-01-03T00:00:00+07:00')""")
        db.executemany("INSERT INTO stay_dogs(stay_id,dog_id) VALUES(?,?)", [(1,1),(1,2),(2,1)])
        db.executemany("INSERT INTO care_share_links(stay_id,dog_id,token) VALUES(?,?,?)",
                       [(1,1,'a'*43),(1,2,'b'*43),(2,1,'c'*43)])
        db.execute("""INSERT INTO care_events(id,stay_id,dog_id,kind,recorded_at,note,customer_visible)
                      VALUES(1,1,1,'food','2026-01-02T09:00:00+07:00','<b>Visible</b>',1),
                            (2,1,1,'food','2026-01-02T10:00:00+07:00','private note',0),
                            (3,1,2,'food','2026-01-02T11:00:00+07:00','other dog note',1)""")
        db.executemany("INSERT INTO care_photos(id,event_id,photo) VALUES(?,?,?)",
                       [(1,1,b'fixture-photo'),(2,2,b'private-photo'),(3,3,b'other-photo')])
        db.execute("""INSERT INTO transactions(id,occurred_on,kind,category,description,amount,stay_id,receipt)
                      VALUES(1,'2026-01-02','income','boarding','Fixture',500,1,'fixture.pdf')""")
    qr = b'fixture-qr-original'
    snapshot = root / 'snapshot.sqlite3'
    with sqlite3.connect(DB) as source, sqlite3.connect(snapshot) as dest:
        source.backup(dest)
    archive = root / 'backup.zip'
    with ZipFile(archive, 'w') as bundle:
        bundle.write(snapshot, 'little_paws.sqlite3')
        bundle.writestr('receipts/fixture.pdf', b'%PDF-1.0\nfixture')
        bundle.writestr('payment-qr.jpg', qr)
    destination = root / 'migration'
    export(archive, destination)
    d1 = root / 'd1.sqlite3'
    with sqlite3.connect(d1) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript((destination / 'data.sql').read_text())
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute("SELECT stay_id,amount,receipt FROM transactions").fetchone() == (1,500,'fixture.pdf')
        assert db.execute("SELECT object_key FROM care_photos WHERE id=1").fetchone() == ('care/1.jpg',)
    assert (destination / 'objects/receipts/fixture.pdf').read_bytes() == b'%PDF-1.0\nfixture'
    assert (destination / 'objects/payment/payment-qr.jpg').read_bytes() == qr
    subprocess.run(['node', 'cloudflare/test_timeline.mjs', str(d1), str(destination/'objects')], check=True)
