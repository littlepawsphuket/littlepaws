import {authorizedStaff} from './stay_payments.mjs';

const commentFields='id,event_id,parent_id,author_kind,body,created_at';
const validId=id=>Number.isSafeInteger(id) && id>0;
const validComment=form=>typeof form.body==='string' && form.body.trim().length>0 && form.body.trim().length<=500 &&
  typeof form.key==='string' && /^[a-f0-9-]{36}$/.test(form.key);

export async function eventInteractions(db,eventIds) {
  if(!eventIds.length)return {comments:[],hearts:[]};
  const ids=JSON.stringify(eventIds);
  const [comments,hearts]=await db.batch([
    db.prepare(`SELECT ${commentFields} FROM care_comments WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(ids),
    db.prepare(`SELECT h.photo_id,p.event_id FROM care_photo_hearts h JOIN care_photos p ON p.id=h.photo_id
      WHERE p.event_id IN (SELECT value FROM json_each(?))`).bind(ids),
  ]);
  return {comments:comments.results,hearts:hearts.results};
}

// The household's link represents one guardian: one heart per photo, shared across their devices.
// Every write checks the same visible-event/link expiry scope inside the SQL statement.
export async function guardianInteraction(db,token,form,activeSql) {
  if(!validId(form.eventId))return {status:'invalid'};
  const guard=`EXISTS(SELECT 1 FROM care_share_links l JOIN stays s ON s.id=l.stay_id
    LEFT JOIN system_settings cfg ON cfg.key='care_link_hours'
    JOIN stay_dogs sd ON sd.stay_id=l.stay_id AND sd.dog_id=l.dog_id
    WHERE l.token=? AND l.stay_id=e.stay_id AND l.dog_id=e.dog_id AND ${activeSql})`;
  const visible=`e.id=? AND e.customer_visible=1 AND ${guard}`;
  const args=[form.eventId,token];
  const now=new Date().toISOString();
  if(form.action==='heart') {
    if(!validId(form.photoId) || typeof form.liked!=='boolean')return {status:'invalid'};
    if(form.liked)await db.prepare(`INSERT INTO care_photo_hearts(photo_id,created_at)
      SELECT p.id,? FROM care_photos p JOIN care_events e ON e.id=p.event_id
      WHERE p.id=? AND ${visible} ON CONFLICT(photo_id) DO NOTHING`).bind(now,form.photoId,...args).run();
    else await db.prepare(`DELETE FROM care_photo_hearts WHERE photo_id IN
      (SELECT p.id FROM care_photos p JOIN care_events e ON e.id=p.event_id WHERE p.id=? AND ${visible})`)
      .bind(form.photoId,...args).run();
    const allowed=await db.prepare(`SELECT p.id,EXISTS(SELECT 1 FROM care_photo_hearts h WHERE h.photo_id=p.id) AS liked
      FROM care_photos p JOIN care_events e ON e.id=p.event_id WHERE p.id=? AND ${visible}`).bind(form.photoId,...args).first();
    return allowed ? {status:'saved',liked:Boolean(allowed.liked)} : {status:'not_found'};
  }
  if(form.action!=='comment' || !validComment(form))return {status:'invalid'};
  await db.prepare(`INSERT INTO care_comments(event_id,author_kind,body,created_at,request_key)
    SELECT e.id,'guardian',?,?,? FROM care_events e WHERE ${visible}
      AND (SELECT COUNT(*) FROM care_comments c WHERE c.event_id=e.id AND c.author_kind='guardian')<100
      AND NOT EXISTS(SELECT 1 FROM care_comments c JOIN care_events ce ON ce.id=c.event_id
        WHERE ce.stay_id=e.stay_id AND ce.dog_id=e.dog_id AND c.author_kind='guardian'
          AND julianday(c.created_at)>julianday(?)-10.0/86400)
    ON CONFLICT(request_key) DO NOTHING`).bind(form.body.trim(),now,form.key,...args,now).run();
  const allowed=await db.prepare(`SELECT e.id,EXISTS(SELECT 1 FROM care_comments c WHERE c.event_id=e.id
    AND c.author_kind='guardian' AND c.request_key=?) AS saved FROM care_events e WHERE ${visible}`)
    .bind(form.key,...args).first();
  if(!allowed)return {status:'not_found'};
  if(!allowed.saved)return {status:'rate_limited'};
  return {status:'saved',comments:(await eventInteractions(db,[form.eventId])).comments};
}

export async function staffReply(db,stayId,dogId,form,actor) {
  if(!validId(form.eventId) || !validId(form.parentId) || !validComment(form))return {status:'invalid'};
  const scope=`e.id=? AND e.stay_id=? AND e.dog_id=? AND s.cancelled_at IS NULL
    AND c.id=? AND c.event_id=e.id AND c.parent_id IS NULL AND c.author_kind='guardian' AND ${authorizedStaff}`;
  const args=[form.eventId,stayId,dogId,form.parentId,actor.id,actor.email];
  await db.prepare(`INSERT INTO care_comments(event_id,parent_id,author_kind,staff_user_id,body,created_at,request_key)
    SELECT e.id,c.id,'staff',?,?,?,? FROM care_events e JOIN stays s ON s.id=e.stay_id
    JOIN care_comments c ON c.event_id=e.id WHERE ${scope}
    AND (SELECT COUNT(*) FROM care_comments r WHERE r.event_id=e.id AND r.author_kind='staff')<300
    ON CONFLICT(request_key) DO NOTHING`).bind(actor.id,form.body.trim(),new Date().toISOString(),form.key,...args).run();
  const saved=await db.prepare(`SELECT r.id FROM care_comments r JOIN care_events e ON e.id=r.event_id
    JOIN stays s ON s.id=e.stay_id JOIN care_comments c ON c.id=r.parent_id
    WHERE r.request_key=? AND r.author_kind='staff' AND r.staff_user_id=? AND ${scope}`)
    .bind(form.key,actor.id,...args).first();
  return saved ? {status:'saved',comments:(await eventInteractions(db,[form.eventId])).comments} : {status:'conflict'};
}

export const interactionCss=`
.care-photo-tile{min-width:0;margin:0}.care-photo-tile>a{display:block}.care-media-gallery>.care-photo-tile:only-child{grid-column:1/-1}
.care-heart{display:inline-flex;align-items:center;gap:7px;min-height:42px;margin:8px 0 0;padding:7px 14px;border:1px solid #e2b8c6;border-radius:999px;background:#fff5f8;color:#a3375b;font:inherit;cursor:pointer}
.care-heart svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8}.care-heart[aria-pressed=true]{background:#ffe1eb}.care-heart[aria-pressed=true] svg{fill:currentColor}
.care-discussion{margin:16px 0 0;padding:14px;border:1px solid var(--season-border,#d2e3d9);border-radius:16px;background:var(--season-card,#f6faf7)}
.care-discussion h4{margin:0 0 10px;font-size:16px}.care-comment{padding:10px 12px;margin:8px 0;background:#fff;border-radius:12px;border:1px solid #dce9e1}
.care-comment[data-author=staff]{margin-inline-start:20px;border-inline-start:3px solid #327965;background:#f1f8f5}
.care-comment-header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}.care-comment-header time{font-size:11px;color:#647a6c;background:transparent;padding:0}
.care-comment p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.6}
.care-comment-form{display:grid!important;gap:8px!important;width:100%;margin:12px 0 0!important}.care-comment-form label{display:grid;gap:6px;width:100%}
.care-comment-form textarea{box-sizing:border-box;width:100%;min-width:0;min-height:76px;border:1px solid #bdd6c9;border-radius:12px;padding:10px;background:#fff;color:#203c30;font:inherit}
.care-comment-form button{justify-self:end;min-height:42px;padding:8px 16px;border:0;border-radius:12px;background:var(--brand-teal,#155747);color:#fff;font:inherit;cursor:pointer}
.care-interaction-status{font-size:13px;min-height:0;color:#537062;margin:6px 0}.care-heart-count{display:block;margin:6px 0;color:#a3375b;font-size:13px}
`;

export async function careNotifications(db,actor) {
  const from=`FROM care_comments c JOIN care_events e ON e.id=c.event_id JOIN stays s ON s.id=e.stay_id
    JOIN dogs d ON d.id=e.dog_id JOIN customers owner ON owner.id=s.customer_id
    WHERE c.author_kind='guardian' AND c.parent_id IS NULL AND s.cancelled_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM care_comment_reads r WHERE r.comment_id=c.id AND r.user_id=?) AND ${authorizedStaff}`;
  const identity=[actor.id,actor.id,actor.email];
  const [count,items]=await db.batch([
    db.prepare(`SELECT COUNT(*) AS unread_count ${from}`).bind(...identity),
    db.prepare(`SELECT c.id,c.body,c.created_at,e.id AS event_id,e.recorded_at,e.activity_label,e.kind,
      e.stay_id,e.dog_id,d.name AS dog_name,owner.name AS customer ${from} ORDER BY c.id DESC LIMIT 30`).bind(...identity),
  ]);
  return {unread_count:count.results[0].unread_count,items:items.results};
}

export async function markCareCommentsRead(db,stayId,dogId,form,actor) {
  if(!Array.isArray(form.eventIds) || !form.eventIds.length || form.eventIds.length>25 || !form.eventIds.every(validId))return {status:'invalid'};
  await db.prepare(`INSERT INTO care_comment_reads(user_id,comment_id,read_at)
    SELECT ?,c.id,? FROM care_comments c JOIN care_events e ON e.id=c.event_id
    WHERE e.stay_id=? AND e.dog_id=? AND e.id IN (SELECT value FROM json_each(?))
      AND c.author_kind='guardian' AND c.parent_id IS NULL AND ${authorizedStaff}
    ON CONFLICT(user_id,comment_id) DO NOTHING`)
    .bind(actor.id,new Date().toISOString(),stayId,dogId,JSON.stringify(form.eventIds),actor.id,actor.email).run();
  return {status:'saved'};
}

export const notificationCss=`
.staff-app .header-controls .care-notification-bell{position:relative;display:grid;place-items:center;flex:none;width:44px;height:44px;min-width:44px;padding:8px;border:1px solid var(--season-border,#c8ded4);border-radius:50%;background:var(--season-card,#f2f8f4);color:var(--brand-teal,#155747);margin:0}
#care-notification-count{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;line-height:19px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:#ba3657;color:white;font-size:11px;font-weight:700}
.staff-app .care-notifications{box-sizing:border-box;width:min(520px,calc(100vw - 24px));max-height:85vh;padding:20px;border-radius:22px;overflow:auto}
.staff-app .care-notifications .heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.staff-app .care-notifications h3{margin:0;font-size:18px}
.staff-app .care-notification-list{display:grid;gap:10px}.staff-app .care-notification-item{display:block;text-align:start;white-space:normal;width:100%;padding:14px;margin:0;border:1px solid var(--season-border,#c8ded4);background:var(--season-card,#f4faf5);color:var(--brand-teal,#155747);border-radius:14px}
.staff-app .care-notification-item p{margin:6px 0;color:#30483b;overflow-wrap:anywhere;line-height:1.6}.staff-app .care-notification-item small{color:#6c8075}
@media(max-width:480px){.staff-app .header-controls .care-notification-bell{width:38px;height:38px;min-width:38px}.staff-app .app-header{column-gap:8px}.staff-app .brand-title strong{font-size:13px!important}}
`;
