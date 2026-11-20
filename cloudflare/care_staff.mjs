import {eventInteractions} from "./care_interactions.mjs";
import {careTemplates} from "./care_templates.mjs";
import {authorizedStaff} from "./stay_payments.mjs";
import {shareActive,shareExpiryHours,validCarePhotoKey} from "./timeline.mjs";
import {validDay} from "./bookings.mjs";

const scope = `FROM stays s JOIN stay_dogs sd ON sd.stay_id=s.id
  JOIN dogs d ON d.id=sd.dog_id
  LEFT JOIN system_settings cfg ON cfg.key='care_link_hours'`;
const pair = "s.id=? AND sd.dog_id=?";

function shareToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
}

export function timelineOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (value === url.origin || value === url.origin + "/") ? url.origin : null;
  } catch { return null; }
}

export async function staffTimeline(db, stayId, dogId, day, before, origin, visibleOnly, focusEvent=null,actor=null) {
  const [record,days,events] = await db.batch([
    db.prepare(`SELECT d.name AS dog_name,s.status,${shareActive} AS can_share,
        ${shareExpiryHours} AS expiry_hours,l.token,l.view_count
      ${scope} LEFT JOIN care_share_links l ON l.stay_id=s.id AND l.dog_id=d.id WHERE ${pair}`).bind(stayId,dogId),
    db.prepare(`SELECT DISTINCT substr(recorded_at,1,10) AS day FROM care_events
      WHERE stay_id=? AND dog_id=? AND (?=0 OR customer_visible=1) ORDER BY day DESC`).bind(stayId,dogId,visibleOnly),
    db.prepare(`SELECT e.id,e.activity_label,e.kind,e.recorded_at,e.note,e.customer_visible,e.cloud_revision AS revision,
        (SELECT json_group_array(json_array(p.id,p.object_key)) FROM care_photos p WHERE p.event_id=e.id) AS photos
      FROM care_events e WHERE e.stay_id=? AND e.dog_id=?
        AND (?=0 OR e.customer_visible=1) AND (? IS NULL OR e.id=?) AND (? IS NULL OR substr(e.recorded_at,1,10)=?)
        AND (? IS NULL OR e.recorded_at<? OR (e.recorded_at=? AND e.id<?))
      ORDER BY e.recorded_at DESC,e.id DESC LIMIT 26`)
      .bind(stayId,dogId,visibleOnly,focusEvent,focusEvent,day,day,before?.recordedAt ?? null,before?.recordedAt ?? null,
        before?.recordedAt ?? null,before?.id ?? null),
  ]);
  const row = record.results[0];
  if (!row) return null;
  const items = events.results.slice(0,25).map((event) => ({
    ...event, photos:JSON.parse(event.photos).map(([id,key]) => ({id,key})),
  }));
  const feedback=await eventInteractions(db,items.map(event=>event.id),actor);
  for(const event of items){
    event.comments=feedback.comments.filter(comment=>comment.event_id===event.id);
    for(const photo of event.photos)photo.hearted=feedback.hearts.some(heart=>heart.photo_id===photo.id);
  }
  const last = items.at(-1);
  const options=await careOptions(db);
  const templateSetting=await db.prepare("SELECT value FROM system_settings WHERE key='care_templates'").bind().first();
  return {
    dog_name:row.dog_name, status:row.status, can_share:Boolean(row.can_share), can_configure_link:Boolean(origin),
    expiry_hours:row.expiry_hours, has_link:Boolean(row.token), view_count:row.view_count,
    share_url:row.token && row.can_share && origin ? origin + "/updates/" + row.token : null,
    days:days.results.map((entry) => entry.day), events:items, options, templates:careTemplates(templateSetting?.value,options), templates_en:careTemplates(templateSetting?.value,options,"en"),
    next:events.results.length>items.length ? {recordedAt:last.recorded_at,id:last.id} : null,
  };
}

export async function staffCarePhoto(db,media,stayId,dogId,id) {
  const row = await db.prepare(`SELECT p.object_key FROM care_photos p
    JOIN care_events e ON e.id=p.event_id
    JOIN stay_dogs sd ON sd.stay_id=e.stay_id AND sd.dog_id=e.dog_id
    WHERE e.stay_id=? AND e.dog_id=? AND p.id=?`).bind(stayId,dogId,id).first();
  if (!validCarePhotoKey(row?.object_key,id)) return null;
  return media.get(row.object_key);
}

export async function manageTimelineLink(db,stayId,dogId,form,actor) {
  const auth = [actor.id,actor.email];
  if (form.action === "create") {
    await db.prepare(`INSERT INTO care_share_links(stay_id,dog_id,token)
      SELECT s.id,sd.dog_id,? ${scope}
      WHERE ${pair} AND ${shareActive} AND ${authorizedStaff}
      ON CONFLICT(stay_id,dog_id) DO NOTHING`).bind(shareToken(),stayId,dogId,...auth).run();
    const ready = await db.prepare(`SELECT 1 ${scope}
      JOIN care_share_links l ON l.stay_id=s.id AND l.dog_id=d.id
      WHERE ${pair} AND ${shareActive} AND ${authorizedStaff}`).bind(stayId,dogId,...auth).first();
    return ready ? "saved" : "conflict";
  }
  if (form.action === "revoke") {
    await db.prepare(`DELETE FROM care_share_links WHERE stay_id=? AND dog_id=? AND ${authorizedStaff}`)
      .bind(stayId,dogId,...auth).run();
    return "saved";
  }
  if (form.action === "publish-day" && validDay(form.day)) {
    const [updated,allowed] = await db.batch([
      db.prepare(`UPDATE care_events SET customer_visible=1,cloud_revision=?
        WHERE stay_id=? AND dog_id=? AND substr(recorded_at,1,10)=? AND customer_visible=0
        AND EXISTS (SELECT 1 FROM stays s JOIN care_share_links l ON l.stay_id=s.id
          WHERE s.id=care_events.stay_id AND l.dog_id=care_events.dog_id
            AND s.status='checked_in' AND s.cancelled_at IS NULL)
        AND ${authorizedStaff}`).bind(crypto.randomUUID(),stayId,dogId,form.day,...auth),
      db.prepare(`SELECT 1 FROM stays s JOIN care_share_links l ON l.stay_id=s.id
        WHERE s.id=? AND l.dog_id=? AND s.status='checked_in' AND s.cancelled_at IS NULL AND ${authorizedStaff}`)
        .bind(stayId,dogId,...auth),
    ]);
    return updated.meta.changes || allowed.results.length ? "saved" : "conflict";
  }
  return "invalid";
}

export const standardActivities = {
  food:"ทานอาหาร",medicine:"กินยา",walk:"เดินเล่น",play:"เล่น",rest:"พักผ่อน",custom:"กิจกรรมอื่น",
};

export function customActivities(raw) {
  let extra = [];
  try { const value = JSON.parse(raw); if (Array.isArray(value)) extra = value; } catch {}
  return extra.filter((label) => typeof label === "string" && label.trim());
}

async function careOptions(db) {
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key='care_activities'").bind().first();
  return {...standardActivities,...Object.fromEntries(customActivities(setting?.value)
    .map((label) => ["activity:"+label,label]))};
}

export async function writeCareEvent(db,media,stayId,dogId,form,actor) {
  const id = form.eventId;
  const auth = [actor.id,actor.email];
  const create = form.action === "add-event";
  const edit = form.action === "edit-event";
  if (!create && (!Number.isSafeInteger(id) || id < 1 ||
      (form.revision !== null && (typeof form.revision !== "string" || form.revision.length !== 36)))) return "invalid";
  const activeDog = `EXISTS(SELECT 1 ${scope} WHERE ${pair} AND s.status='checked_in' AND s.cancelled_at IS NULL)`;
  if (!create && !edit) {
    const params = [id,stayId,dogId,form.revision,stayId,dogId,...auth];
    const where = `id=? AND stay_id=? AND dog_id=? AND cloud_revision IS ? AND ${activeDog} AND ${authorizedStaff}`;
    const [photos,remove] = await db.batch([
      db.prepare(`SELECT p.id,p.object_key FROM care_photos p WHERE p.event_id IN (
        SELECT id FROM care_events WHERE ${where})`).bind(...params),
      db.prepare(`DELETE FROM care_events WHERE ${where}`).bind(...params),
    ]);
    if (remove.meta.changes !== 1) return "conflict";
    if (media) for (const photo of photos.results) {
      if (validCarePhotoKey(photo.object_key,photo.id)) {
        try { await media.delete(photo.object_key); } catch {}
      }
    }
    return "saved";
  }

  const {action,activity,note,day,time,visible,key} = form;
  const now = new Date();
  const date = `${day}T${time}:00+07:00`;
  if (!validDay(day) || typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      Date.parse(date) > now.valueOf() ||
      typeof activity !== "string" || typeof note !== "string" || note.length > 500 ||
      typeof visible !== "boolean" || (activity === "custom" && !note.trim())) return "invalid";
  const options = await careOptions(db);
  let kind = activity === "food" || activity === "medicine" ? activity : "custom";
  let label = activity === "custom" ? null : options[activity];
  if (edit && activity === "existing-activity") {
    const event = await db.prepare("SELECT kind,activity_label FROM care_events WHERE id=? AND stay_id=? AND dog_id=?")
      .bind(id,stayId,dogId).first();
    if (!event?.activity_label) return "invalid";
    kind = event.kind;
    label = event.activity_label;
  } else if (!Object.hasOwn(options,activity)) return "invalid";
  const revision = crypto.randomUUID();
  const fields = [kind,date,note.trim(),label,Number(visible),revision];
  if (action === "add-event") {
    if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) return "invalid";
    const scopedKey = stayId+":"+dogId+":"+actor.id+":"+key;
    const [,lookup] = await db.batch([
      db.prepare(`INSERT INTO care_events(kind,recorded_at,note,activity_label,customer_visible,cloud_revision,stay_id,dog_id,cloud_create_key)
        SELECT ?,?,?,?,?,?,?,?,? WHERE ${activeDog} AND ${authorizedStaff}
        ON CONFLICT(cloud_create_key) DO NOTHING`).bind(...fields,stayId,dogId,scopedKey,stayId,dogId,...auth),
      db.prepare(`SELECT id,cloud_revision FROM care_events WHERE cloud_create_key=? AND ${authorizedStaff}`).bind(scopedKey,...auth),
    ]);
    const event = lookup.results[0];
    return event ? {status:"saved",eventId:event.id,revision:event.cloud_revision} : "conflict";
  }
  const {meta} = await db.prepare(`UPDATE care_events SET kind=?,recorded_at=?,note=?,activity_label=?,customer_visible=?,cloud_revision=?
    WHERE id=? AND stay_id=? AND dog_id=? AND cloud_revision IS ? AND ${activeDog} AND ${authorizedStaff}`)
    .bind(...fields,id,stayId,dogId,form.revision,stayId,dogId,...auth).run();
  return meta.changes === 1 ? {status:"saved",eventId:id,revision} : "conflict";
}
