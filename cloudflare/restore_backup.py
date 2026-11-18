"""Verify a portable cloud backup and rebuild it in a NEW private local directory.

Never writes to Cloudflare or the live Mac installation. Use the resulting SQLite
database and objects with a separate recovery deployment before any cutover.
"""
import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from zipfile import ZipFile

LIMIT = 75 * 1024 * 1024
NAME = re.compile(r'[a-z][a-z0-9_]*')


def restore(archive, destination):
    destination = Path(destination).resolve()
    if destination.exists():
        raise FileExistsError('Choose a new recovery directory')
    with TemporaryDirectory(dir=destination.parent) as temporary:
        work = Path(temporary)
        work.chmod(0o700)
        with ZipFile(archive) as bundle:
            entries = bundle.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or len(names) > 5000 or sum(e.file_size for e in entries) > LIMIT:
                raise ValueError('Invalid or oversized backup')
            for name in names:
                parts = PurePosixPath(name).parts
                if (name not in ('snapshot.json', 'objects.json') and not name.startswith('objects/')) or (
                    name.startswith('/') or '\\' in name or any(p in ('..', '.') for p in parts) or
                    any(ord(c) < 32 for c in name) or str(PurePosixPath(name)) != name):
                    raise ValueError('Invalid backup path')
            snapshot = json.loads(bundle.read('snapshot.json'))
            manifest = json.loads(bundle.read('objects.json'))
            if snapshot.get('format') != 'little-paws-cloud-backup' or snapshot.get('version') != 1:
                raise ValueError('Unknown backup format')
            if not isinstance(manifest, list) or not isinstance(snapshot.get('rows'), dict):
                raise ValueError('Invalid backup content')
            keys = set()
            for record in manifest:
                key = record['key']
                if key in keys or 'objects/' + key not in names:
                    raise ValueError('Missing or duplicate object')
                keys.add(key)
                data = bundle.read('objects/' + key)
                if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                    raise ValueError('Object checksum mismatch')
                path = work / 'objects' / key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.chmod(0o600)
            if set(names) != {'snapshot.json', 'objects.json', *('objects/' + k for k in keys)}:
                raise ValueError('Unexpected files')
            if not set(snapshot.get('required_media', [])) <= keys:
                raise ValueError('Required media missing')
        schema = snapshot['schema']
        tables = {entry['name'] for entry in schema if entry['type'] == 'table'}
        if set(snapshot['rows']) != tables or not tables or not all(NAME.fullmatch(t) for t in tables):
            raise ValueError('Invalid table list')
        database = work / 'cloud-recovery.sqlite3'
        with sqlite3.connect(database) as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('BEGIN')
            db.execute('PRAGMA defer_foreign_keys=ON')
            # Block any attempt to attach or access another database in a supplied schema.
            db.set_authorizer(lambda action, a, b, database, source:
                              sqlite3.SQLITE_DENY if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH)
                              else sqlite3.SQLITE_OK)
            for entry in schema:
                if entry['type'] != 'table':
                    continue
                if not re.match(r'^CREATE\s+TABLE\b', entry['sql'], re.I):
                    raise ValueError('Invalid table schema')
                db.execute(entry['sql'])
            for table, rows in snapshot['rows'].items():
                columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
                if not all(NAME.fullmatch(c) for c in columns) or len(rows) > 10000:
                    raise ValueError('Invalid rows')
                column_list = ','.join('"' + c + '"' for c in columns)
                sql = f'INSERT INTO "{table}" ({column_list}) VALUES ({",".join("?" for _ in columns)})'
                for row in rows:
                    if set(row) != set(columns):
                        raise ValueError('Columns differ from schema')
                    db.execute(sql, [row[c] for c in columns])
            for entry in schema:
                if entry['type'] == 'table':
                    continue
                if entry['type'] not in ('index', 'trigger', 'view') or not re.match(
                        r'^CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\b', entry['sql'], re.I):
                    raise ValueError('Invalid schema object')
                db.execute(entry['sql'])
            if db.execute('PRAGMA foreign_key_check').fetchall() or db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Database integrity check failed')
            expected = set()
            for table in ('dog_photos', 'care_photos', 'app_user_photos'):
                expected.update(row['object_key'] for row in snapshot['rows'].get(table, []) if row['object_key'])
            expected.update('receipts/' + row['receipt'] for row in snapshot['rows'].get('transactions', []) if row['receipt'])
            if not expected <= keys:
                raise ValueError('A database media reference is missing')
        database.chmod(0o600)
        (work / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf-8')
        (work / 'objects.json').write_text(json.dumps(manifest), encoding='utf-8')
        work.rename(destination)
    return {table: len(rows) for table, rows in snapshot['rows'].items()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path)
    options = parser.parse_args()
    counts = restore(options.archive, options.destination)
    print(f'Verified {sum(counts.values())} records across {len(counts)} tables in {options.destination}')
