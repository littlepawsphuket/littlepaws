import {stayBalance} from "./stay_payments.mjs";

export async function searchCustomers(db, after, search) {
  const {results} = await db.prepare(`
    SELECT c.id,c.name,
      (SELECT count(*) FROM dogs d WHERE d.customer_id=c.id AND d.archived=0) AS dog_count
    FROM customers c WHERE c.archived=0 AND c.id>?
      AND (?='' OR instr(lower(c.name),?)>0 OR EXISTS (
        SELECT 1 FROM dogs d WHERE d.customer_id=c.id AND d.archived=0 AND instr(lower(d.name),?)>0
      ))
    ORDER BY c.id LIMIT 26
  `).bind(after, search, search, search).all();
  const customers = results.slice(0, 25);
  return {customers, nextAfter:results.length > customers.length ? customers.at(-1).id : null};
}

export async function customerDetails(db, id, offset) {
  const [record, pets, history] = await db.batch([
    db.prepare(`SELECT id,name,owner_phone,line_id,emergency_address,note
      FROM customers WHERE id=? AND archived=0`).bind(id),
    db.prepare(`SELECT d.id,d.name,d.size,d.note,d.profile,p.dog_id IS NOT NULL AS has_photo
      FROM dogs d LEFT JOIN dog_photos p ON p.dog_id=d.id
      WHERE d.customer_id=? AND d.archived=0 ORDER BY d.name,d.id`).bind(id),
    db.prepare(`SELECT s.id,s.stay_number,s.checkin,s.checkout,s.status,
      (SELECT group_concat(d.name, ', ') FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
        WHERE sd.stay_id=s.id) AS dogs,
      CASE WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE 0 END AS due_cents
      FROM stays s WHERE s.customer_id=? AND s.status!='cancelled' AND s.cancelled_at IS NULL
      ORDER BY s.checkin DESC,s.id DESC LIMIT 26 OFFSET ?`).bind(id, offset),
  ]);
  const customer = record.results[0];
  if (!customer) return null;
  const stays = history.results.slice(0, 25);
  return {customer, dogs:pets.results, stays, nextOffset:history.results.length > stays.length ? offset + stays.length : null};
}

export async function dogPhoto(db, media, customerId, dogId) {
  const record = await db.prepare(`
    SELECT p.object_key FROM dog_photos p JOIN dogs d ON d.id=p.dog_id
    JOIN customers c ON c.id=d.customer_id
    WHERE c.id=? AND d.id=? AND c.archived=0 AND d.archived=0
  `).bind(customerId, dogId).first();
  if (record?.object_key !== `dogs/${dogId}.jpg`) return null;
  return media.get(record.object_key);
}
