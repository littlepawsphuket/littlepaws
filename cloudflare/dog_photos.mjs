import {authorizedStaff} from "./stay_payments.mjs";

export const photoLimit = 512 * 1024;
export const photoEdge = 1024;
const activeDog = `FROM dogs d JOIN customers c ON c.id=d.customer_id
  WHERE c.id=? AND d.id=? AND c.archived=0 AND d.archived=0`;

function validKey(key, dogId) {
  return typeof key === "string" && new RegExp(`^dogs/${dogId}(?:/[a-f0-9-]{36})?\\.jpg$`).test(key);
}

function jpegDimensions(bytes) {
  if (bytes.length < 8 || bytes[0] !== 255 || bytes[1] !== 216 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  let offset = 2;
  while (offset + 3 < bytes.length && bytes[offset++] === 255) {
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length >= bytes.length || marker === 218) return null;
    if ([192,193,194].includes(marker) && length >= 8) {
      return [bytes[offset + 3] * 256 + bytes[offset + 4], bytes[offset + 5] * 256 + bytes[offset + 6]];
    }
    offset += length;
  }
  return null;
}

export async function dogPhoto(db, media, customerId, dogId) {
  const row = await db.prepare(`SELECT p.object_key FROM dog_photos p JOIN dogs d ON d.id=p.dog_id
    JOIN customers c ON c.id=d.customer_id
    WHERE c.id=? AND d.id=? AND c.archived=0 AND d.archived=0`).bind(customerId, dogId).first();
  return validKey(row?.object_key, dogId) ? media.get(row.object_key) : null;
}

export async function saveDogPhoto(db, media, customerId, dogId, bytes, actor) {
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.some((value) => value < 1 || value > photoEdge)) return "invalid";
  const args = [customerId,dogId,actor.id,actor.email];
  const validTarget = `${activeDog} AND ${authorizedStaff}`;
  if (!await db.prepare(`SELECT d.id ${validTarget}`).bind(...args).first()) return "not_found";
  const key = `dogs/${dogId}/${crypto.randomUUID()}.jpg`;
  await media.put(key, bytes, {httpMetadata:{contentType:"image/jpeg"}});
  // Publish the new pointer only after the object is present. A failed or ambiguous
  // D1 batch can leave an unreferenced object, but must never delete a published photo.
  const [previous, update] = await db.batch([
    db.prepare(`SELECT (SELECT p.object_key FROM dog_photos p WHERE p.dog_id=d.id) AS object_key
      ${validTarget}`).bind(...args),
    db.prepare(`INSERT INTO dog_photos(dog_id,object_key) SELECT d.id,? ${validTarget}
      ON CONFLICT(dog_id) DO UPDATE SET object_key=excluded.object_key`).bind(key,...args),
  ]);
  if (update.meta.changes !== 1) {
    try { await media.delete(key); } catch {}
    return "not_found";
  }
  const oldKey = previous.results[0]?.object_key;
  if (validKey(oldKey, dogId)) {
    try { await media.delete(oldKey); } catch {}
  }
  return "saved";
}
