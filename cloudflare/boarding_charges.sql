-- Additive price snapshots. Legacy bookings/stays retain their agreed prices.
CREATE TABLE IF NOT EXISTS boarding_charges (
 id INTEGER PRIMARY KEY,
 appointment_id INTEGER UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
 stay_id INTEGER UNIQUE REFERENCES stays(id) ON DELETE CASCADE,
 details TEXT NOT NULL CHECK(json_valid(details)),
 CHECK((appointment_id IS NOT NULL AND stay_id IS NULL) OR (appointment_id IS NULL AND stay_id IS NOT NULL))
);
