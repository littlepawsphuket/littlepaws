"""Export a verified Little Paws backup to D1 SQL and private R2 objects."""

import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from app.backup_archive import DATABASE_NAME, validate_archive

PHOTO_TABLES = {
    'dog_photos': ('dog_id', 'dogs'),
    'app_user_photos': ('user_id', 'users'),
    'care_photos': ('id', 'care'),
}
MAX_D1_SQL_BYTES = 100_000


def write_object(root, key, data, manifest):
    target = root / 'objects' / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    manifest.append({'key': key, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})


def safe_name(name):
    return '"' + name.replace('"', '""') + '"'


def ordered_tables(db):
    parents = {}
    for (table,) in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        parents[table] = {row[2] for row in db.execute(f'PRAGMA foreign_key_list({safe_name(table)})')}
    emitted = set()
    while parents:
        ready = sorted(table for table, references in parents.items() if references <= emitted)
        if not ready:
            raise ValueError('Cannot order tables for the D1 import')
        for table in ready:
            del parents[table]
            emitted.add(table)
            yield table


def write_sql(db, path):
    tables = list(ordered_tables(db))
    with path.open('x', encoding='utf-8') as output:
        def write(statement):
            if len(statement.encode('utf-8')) > MAX_D1_SQL_BYTES:
                raise ValueError('A SQL statement exceeds the D1 size limit')
            output.write(statement + ';\n')

        for table in tables:
            schema = db.execute('SELECT sql FROM sqlite_schema WHERE name=?', (table,)).fetchone()[0]
            write(schema)
            name = safe_name(table)
            columns = [row[1] for row in db.execute(f'PRAGMA table_info({name})')]
            column_list = ','.join(map(safe_name, columns))
            literal = ','.join(
                f"CASE WHEN typeof({safe_name(col)})='text' AND instr({safe_name(col)}, char(0))>0 "
                f"THEN 'CAST(X''' || hex({safe_name(col)}) || ''' AS TEXT)' ELSE quote({safe_name(col)}) END"
                for col in columns
            )
            for row in db.execute(f'SELECT {literal} FROM {name}'):
                write(f'INSERT INTO {name} ({column_list}) VALUES ({",".join(row)})')

        for (schema,) in db.execute("""SELECT sql FROM sqlite_schema
                                      WHERE type IN ('index','trigger','view') AND sql IS NOT NULL
                                      ORDER BY type,name"""):
            write(schema)


def export(archive, destination):
    destination = Path(destination).resolve()
    # A migration bundle contains customer data and must live outside the source tree.
    project = Path(__file__).resolve().parents[1]
    if destination.is_relative_to(project):
        raise ValueError('Choose a private output directory outside the project')
    if destination.exists():
        raise FileExistsError(destination)
    manifest = []
    # Build privately and publish the directory only after validation and export succeed.
    with TemporaryDirectory(dir=destination.parent) as working:
        working = Path(working)
        restore, bundle = working / 'restore', working / 'bundle'
        restore.mkdir()
        bundle.mkdir(mode=0o700)
        validate_archive(archive, restore)
        with closing(sqlite3.connect(restore / DATABASE_NAME)) as db, db:
            db.execute('PRAGMA foreign_keys=ON')
            if db.execute('PRAGMA foreign_key_check').fetchone():
                raise ValueError('The backup has broken references')
            for table, (column, prefix) in PHOTO_TABLES.items():
                db.execute(f'ALTER TABLE {table} ADD COLUMN object_key TEXT NOT NULL DEFAULT \'\'')
                for object_id, photo in db.execute(f'SELECT {column},photo FROM {table}'):
                    key = f'{prefix}/{object_id}.jpg'
                    write_object(bundle, key, photo, manifest)
                    db.execute(f'UPDATE {table} SET object_key=? WHERE {column}=?', (key, object_id))
                db.execute(f'ALTER TABLE {table} DROP COLUMN photo')
            for receipt in sorted((restore / 'receipts').glob('*')):
                write_object(bundle, f'receipts/{receipt.name}', receipt.read_bytes(), manifest)
            write_sql(db, bundle / 'data.sql')
        (bundle / 'objects.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        bundle.rename(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path)
    options = parser.parse_args()
    export(options.archive, options.destination)
    print(f'Created private migration bundle in {options.destination}')
