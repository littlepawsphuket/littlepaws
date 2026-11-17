CREATE TABLE IF NOT EXISTS booking_deposit_deletions (
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL,
    payment_key TEXT NOT NULL,
    amount REAL NOT NULL,
    occurred_on TEXT NOT NULL,
    received_time TEXT,
    deleted_at TEXT NOT NULL,
    deleted_by INTEGER NOT NULL,
    PRIMARY KEY (appointment_id, payment_key)
);

UPDATE transactions SET payment_key=lower(hex(randomblob(16)))
WHERE payment_type='deposit' AND deposit_appointment_id IS NOT NULL
  AND COALESCE(payment_key,'')='';
