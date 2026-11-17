import {authorizedStaff} from "./stay_payments.mjs";
import {validCarePhotoKey} from "./timeline.mjs";
import {validJpeg} from "./dog_photos.mjs";

const activeEvent = `FROM care_events e JOIN stays s ON s.id=e.stay_id
  JOIN stay_dogs sd ON sd.stay_id=e.stay_id AND sd.dog_id=e.dog_id
  WHERE e.id=? AND e.stay_id=? AND e.dog_id=? AND e.cloud_revision IS ?
    AND s.status='checked_in' AND s.cancelled_at IS NULL AND ${authorizedStaff}`;
const maximum = 4;
const revisionPattern = /^[a-f0-9-]{36}$/;

async function deleteObject(media,key) {
  try { await media.delete(key); } catch {}
}

export async function addCarePhoto(db,media,scope,actor,bytes,revision,key) {
  if (!validJpeg(bytes) || !revisionPattern.test(revision ?? "") || !/^[a-f0-9]{32}$/.test(key ?? "")) return "invalid";
  const {stayId,dogId,eventId} = scope;
  const args = [eventId,stayId,dogId,revision,actor.id,actor.email];
  const submission = actor.id+":"+stayId+":"+dogId+":"+eventId+":"+key;
  const known = db.prepare(`SELECT 1 FROM care_photos p WHERE p.cloud_upload_key=? AND p.event_id IN
    (SELECT e.id ${activeEvent})`).bind(submission,...args);
  if (await known.first()) return "saved";
  if (!await db.prepare(`SELECT e.id ${activeEvent}`).bind(...args).first()) return "conflict";
  const objectKey = `care/uploads/${crypto.randomUUID()}.jpg`;
  await media.put(objectKey,bytes,{httpMetadata:{contentType:"image/jpeg"}});

  // Only successful database writes publish the image. Keep the new object on
  // an ambiguous database failure, where it might already be referenced.
  const [insert,existing] = await db.batch([
    db.prepare(`INSERT INTO care_photos(event_id,object_key,cloud_upload_key)
      SELECT e.id,?,? ${activeEvent}
      AND (SELECT count(*) FROM care_photos p WHERE p.event_id=e.id)<?
      ON CONFLICT(cloud_upload_key) DO NOTHING`).bind(objectKey,submission,...args,maximum),
    known,
  ]);
  if (insert.meta.changes === 1) return "saved";
  await deleteObject(media,objectKey);
  return existing.results.length ? "saved" : "conflict";
}

export async function removeCarePhoto(db,media,scope,actor,form) {
  const {stayId,dogId,eventId,photoId} = scope;
  if (!validCarePhotoKey(form.key,photoId) || !revisionPattern.test(form.revision ?? "")) return "invalid";
  const args = [eventId,stayId,dogId,form.revision,actor.id,actor.email];
  const [target,remove] = await db.batch([
    db.prepare(`SELECT e.id ${activeEvent}`).bind(...args),
    db.prepare(`DELETE FROM care_photos WHERE id=? AND object_key=? AND event_id IN
      (SELECT e.id ${activeEvent})`).bind(photoId,form.key,...args),
  ]);
  if (!target.results.length) return "conflict";
  if (remove.meta.changes === 1) await deleteObject(media,form.key);
  return "saved";
}
