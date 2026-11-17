import {authorizedStaff} from "./stay_payments.mjs";

const sizes = new Set(["small","medium","large"]);
const enums = {
  gender:["male","female"], neutered:["yes","no"],
  vaccinated:["yes","no"], rabies:["yes","no"], flea_tick:["yes","no"],
};
const textFields = {breed:120, medical_history:600, required_care:600, medications:600};
const activeOwner = "EXISTS (SELECT 1 FROM customers c WHERE c.id=? AND c.archived=0)";

function dogValues(form) {
  if (typeof form.name !== "string" || !form.name.trim() || form.name.length > 120 ||
      !sizes.has(form.size) || typeof form.note !== "string" || form.note.length > 600) return null;
  const profile = {};
  for (const [field, limit] of Object.entries(textFields)) {
    if (typeof form[field] !== "string" || form[field].length > limit) return null;
    profile[field] = form[field].trim() || null;
  }
  for (const [field, allowed] of Object.entries(enums)) {
    if (form[field] !== "" && !allowed.includes(form[field])) return null;
    profile[field] = form[field] || null;
  }
  if (typeof form.weight !== "string" || (form.weight && !/^\d{1,3}(?:\.\d{1,2})?$/.test(form.weight))) return null;
  profile.weight = form.weight || null;

  const today = new Date(Date.now() + 7 * 3600000);
  let birth = form.birth_date;
  let estimated = form.birth_estimated === true;
  if (typeof birth !== "string") return null;
  if (form.age_years !== "" || form.age_months !== "") {
    if (![form.age_years, form.age_months].every((value) => typeof value === "string" && /^\d{0,2}$/.test(value))) return null;
    const years = Number(form.age_years), months = Number(form.age_months);
    if (months > 11) return null;
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - years * 12 - months, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    start.setUTCDate(Math.min(today.getUTCDate(), end.getUTCDate()));
    birth = start.toISOString().slice(0, 10);
    estimated = true;
  }
  if (birth) {
    const parsed = new Date(birth + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== birth || birth > today.toISOString().slice(0, 10)) return null;
  }
  profile.birth_date = birth || null;
  profile.birth_estimated = birth ? estimated : null;
  return [form.name.trim(), form.size, form.note.trim(), JSON.stringify(profile)];
}

export async function saveDog(db, customerId, dogId, form, actor) {
  const fields = dogValues(form);
  if (!fields || fields.some((value) => value.includes("\0"))) return "invalid";
  const identity = [actor.id, actor.email];
  if (dogId !== null) {
    const {meta} = await db.prepare(`UPDATE dogs SET name=?,size=?,note=?,profile=json_patch(
      CASE WHEN json_valid(profile) THEN profile ELSE '{}' END,?)
      WHERE id=? AND customer_id=? AND archived=0 AND ${activeOwner} AND ${authorizedStaff}`)
      .bind(...fields, dogId, customerId, customerId, ...identity).run();
    return meta.changes === 1 ? "saved" : "not_found";
  }
  if (typeof form.key !== "string" || !/^[a-f0-9]{32}$/.test(form.key)) return "invalid";
  const [insert, lookup] = await db.batch([
    db.prepare(`INSERT INTO dogs(name,size,note,profile,customer_id,cloud_create_key)
      SELECT ?,?,?,json_patch('{}',?),?,? WHERE ${activeOwner} AND ${authorizedStaff}
      ON CONFLICT(customer_id,cloud_create_key) DO NOTHING`)
      .bind(...fields, customerId, form.key, customerId, ...identity),
    db.prepare(`SELECT 1 FROM dogs WHERE customer_id=? AND cloud_create_key=? AND archived=0
      AND ${activeOwner} AND ${authorizedStaff}`).bind(customerId, form.key, customerId, ...identity),
  ]);
  return insert.meta.changes === 1 ? "created" : lookup.results.length ? "saved" : "not_found";
}

export async function archiveDog(db, customerId, dogId, actor) {
  const {meta} = await db.prepare(`UPDATE dogs SET archived=1
    WHERE id=? AND customer_id=? AND ${activeOwner} AND ${authorizedStaff}`)
    .bind(dogId, customerId, customerId, actor.id, actor.email).run();
  return meta.changes === 1 ? "archived" : "not_found";
}
