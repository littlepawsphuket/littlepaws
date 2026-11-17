import {stayBalance, authorizedStaff} from "./stay_payments.mjs";

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

const fieldLimits = {name:120, owner_phone:50, line_id:120, emergency_address:500, note:800};

export async function saveCustomer(db, id, form, actor) {
  const fields = [];
  for (const [field, limit] of Object.entries(fieldLimits)) {
    const value = form[field];
    if (typeof value !== "string" || value.length > limit || value.includes("\0")) return {status:"invalid"};
    fields.push(value.trim());
  }
  if (!fields[0]) return {status:"invalid"};
  const identity = [actor.id, actor.email];
  if (id !== null) {
    const {meta} = await db.prepare(`UPDATE customers SET name=?,owner_phone=?,line_id=?,emergency_address=?,note=?
      WHERE id=? AND archived=0 AND ${authorizedStaff}`).bind(...fields, id, ...identity).run();
    return meta.changes === 1 ? {status:"saved", id} : {status:"not_found"};
  }
  const key = form.key;
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) return {status:"invalid"};
  const registered = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "+07:00");
  const [insert, lookup] = await db.batch([
    db.prepare(`INSERT INTO customers(name,owner_phone,line_id,emergency_address,note,registered_at,cloud_create_key)
      SELECT ?,?,?,?,?,?,? WHERE ${authorizedStaff}
      ON CONFLICT (cloud_create_key) DO NOTHING`)
      .bind(...fields, registered, key, ...identity),
    db.prepare(`SELECT id FROM customers WHERE cloud_create_key=? AND archived=0 AND ${authorizedStaff}`)
      .bind(key, ...identity),
  ]);
  const row = lookup.results[0];
  if (!row) return {status:"not_found"};
  return {status:insert.meta.changes === 1 ? "created" : "saved", id:row.id};
}

// Keep foreign-key references and historic receipts usable after removing a customer from the directory.
export async function archiveCustomer(db, id, actor) {
  const {meta} = await db.prepare(`UPDATE customers SET archived=1
    WHERE id=? AND ${authorizedStaff}`).bind(id, actor.id, actor.email).run();
  return {status:meta.changes === 1 ? "archived" : "not_found"};
}
