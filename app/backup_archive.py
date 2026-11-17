import shutil
import sqlite3
from contextlib import closing
from pathlib import Path
from zipfile import ZipFile

DATABASE_NAME = 'little_paws.sqlite3'
ARCHIVE_LIMIT = 512 * 1024 * 1024


def receipt_names(db):
    return {row[0] for row in db.execute("SELECT DISTINCT receipt FROM transactions WHERE receipt!=''")}


def validate_archive(source, directory):
    directory = Path(directory)
    with ZipFile(source) as archive:
        entries = archive.infolist()
        names = {entry.filename for entry in entries}
        if (len(names) != len(entries) or DATABASE_NAME not in names or
                sum(entry.file_size for entry in entries) > ARCHIVE_LIMIT):
            raise ValueError('Invalid archive')
        receipts = set()
        for entry in entries:
            name = entry.filename
            if name != DATABASE_NAME:
                prefix, separator, filename = name.partition('/')
                if (prefix != 'receipts' or not separator or not filename or
                        filename in ('.', '..') or '/' in filename or '\\' in filename):
                    raise ValueError('Invalid receipt path')
                receipts.add(filename)
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as contents, target.open('xb') as output:
                shutil.copyfileobj(contents, output)
    with closing(sqlite3.connect((directory / DATABASE_NAME).as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Invalid database')
        for table in ('customers', 'dogs', 'stays', 'appointments', 'transactions'):
            db.execute(f'SELECT id FROM {table} LIMIT 1').fetchall()
        if receipt_names(db) != receipts:
            raise ValueError('Receipt list mismatch')
    return len(receipts)


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Extract and verify a backup into a new staging directory.')
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    args.destination.mkdir()
    count = validate_archive(args.archive, args.destination.resolve())
    (args.destination / 'receipts').mkdir(exist_ok=True)
    print(f'Verified database and {count} receipts in {args.destination}')
