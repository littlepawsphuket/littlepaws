import {scrypt, pbkdf2, timingSafeEqual, randomBytes} from 'node:crypto';
import {authorizedStaff} from './stay_payments.mjs';
import {validJpeg,photoLimit} from './dog_photos.mjs';

const publicColumns = `u.id,u.username,u.display_name,u.is_admin,u.active,u.needs_password,u.session_version,
  a.email,EXISTS(SELECT 1 FROM app_user_photos p WHERE p.user_id=u.id) AS has_photo`;
const currentActor = `${authorizedStaff} AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND session_version=?)`;
const adminActor = `${currentActor} AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND is_admin=1)`;
const actorArgs = (actor) => [actor.id,actor.email,actor.id,actor.session_version];
const adminArgs = (actor) => [...actorArgs(actor),actor.id];
const passwordValid = (value) => typeof value === 'string' && value.length>=8 && value.length<=128 && !!value.trim();
const photoKeyValid = (key,id) => typeof key==='string' &&
  (key===`users/${id}.jpg` || new RegExp(`^users/${id}/[a-f0-9-]{36}\\.jpg$`).test(key));
const derive = (fn,...args) => new Promise((resolve,reject) => fn(...args,(error,result) => error ? reject(error) : resolve(result)));

export async function verifyPassword(encoded,password) {
  if (typeof encoded!=='string' || typeof password!=='string' || password.length>128) return false;
  const [method,salt,digest,...extra] = encoded.split('$');
  if (extra.length || !salt || salt.length>64 || !/^[a-f0-9]+$/.test(digest || '') || digest.length%2) return false;
  let actual;
  try {
    const bits=method.split(':');
    if (bits[0]==='scrypt' && bits.length===4 && digest.length===128) {
      const [N,r,p]=bits.slice(1).map(Number);
      if (![16384,32768].includes(N) || r!==8 || p!==1) return false;
      actual=await derive(scrypt,password,salt,64,{N,r,p,maxmem:64*1024*1024});
    } else if (bits[0]==='pbkdf2' && bits[1]==='sha256' && bits.length===3 && digest.length===64) {
      const iterations=Number(bits[2]);
      if (!Number.isSafeInteger(iterations) || iterations<100000 || iterations>1000000) return false;
      actual=await derive(pbkdf2,password,salt,iterations,32,'sha256');
    } else return false;
    return timingSafeEqual(actual,Buffer.from(digest,'hex'));
  } catch { return false; }
}

export async function hashPassword(password) {
  if (!passwordValid(password)) throw Error('invalid_password');
  const salt=randomBytes(16).toString('hex');
  const digest=await derive(scrypt,password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt:32768:8:1$${salt}$${digest.toString('hex')}`;
}

export async function userDirectory(db,actor) {
  return (await db.prepare(`SELECT ${publicColumns} FROM app_users u
    LEFT JOIN staff_access_identities a ON a.user_id=u.id WHERE ${adminActor}
    ORDER BY u.active DESC,u.username`).bind(...adminArgs(actor)).all()).results;
}

export async function accountDetails(db,id) {
  return await db.prepare(`SELECT ${publicColumns} FROM app_users u
    LEFT JOIN staff_access_identities a ON a.user_id=u.id WHERE u.id=?`).bind(id).first();
}

async function allowCredential(db,actor,now) {
  const window=Math.floor(now.valueOf()/60000);
  const [change] = await db.batch([db.prepare(`INSERT INTO staff_credential_attempts(actor_id,window,attempts)
    SELECT ?,?,1 WHERE ${currentActor}
    ON CONFLICT(actor_id) DO UPDATE SET window=excluded.window,
      attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END
    WHERE window!=excluded.window OR attempts<5`).bind(actor.id,window,...actorArgs(actor))]);
  return change.meta.changes===1;
}

export async function changePassword(db,form,actor,now=new Date()) {
  if (!passwordValid(form.password) || form.password!==form.confirmation ||
      typeof form.currentPassword!=='string' || form.currentPassword.length>128 || form.password===form.currentPassword) return 'invalid';
  if (!await allowCredential(db,actor,now)) return 'rate_limited';
  const user=await db.prepare('SELECT password_hash FROM app_users WHERE id=? AND active=1').bind(actor.id).first();
  if (!await verifyPassword(user?.password_hash,form.currentPassword)) return 'invalid_credentials';
  const hashed=await hashPassword(form.password);
  const [change] = await db.batch([db.prepare(`UPDATE app_users SET password_hash=?,needs_password=0,
    session_version=session_version+1 WHERE id=? AND password_hash=? AND ${currentActor}`)
    .bind(hashed,actor.id,user.password_hash,...actorArgs(actor))]);
  return change.meta.changes===1 ? 'saved' : 'conflict';
}

export async function saveUser(db,id,form,actor) {
  if (!actor.is_admin) return {status:'forbidden'};
  const action=form.action || 'save';
  const creating=id===null;
  const old=creating ? null : await accountDetails(db,id);
  if (!creating && !old) return {status:'not_found'};
  if (!creating && (!Number.isSafeInteger(form.version) || old.session_version!==form.version)) return {status:'conflict'};
  if (!['save','reset'].includes(action) || (creating && action==='reset')) return {status:'invalid'};
  let hash=null;
  if (creating || action==='reset') {
    if (!passwordValid(form.password) || form.password!==form.confirmation) return {status:'invalid'};
    hash=await hashPassword(form.password);
  }
  const guard=adminActor;
  const protection=`(id!=? AND (is_admin=0 OR active=0 OR (?=1 AND ?=1) OR
    EXISTS(SELECT 1 FROM app_users keeper WHERE keeper.id!=app_users.id AND keeper.active=1 AND keeper.is_admin=1)))`;
  let statement;
  if (action==='reset') {
    statement=db.prepare(`UPDATE app_users SET password_hash=?,needs_password=1,session_version=session_version+1
      WHERE id=? AND session_version=? AND ${guard}`).bind(hash,id,form.version,...adminArgs(actor));
  } else {
    if (typeof form.username!=='string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(form.username) ||
        typeof form.displayName!=='string' || !form.displayName.trim() || form.displayName.trim().length>80 ||
        typeof form.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) || form.email.length>254 ||
        typeof form.isAdmin!=='boolean' || typeof form.active!=='boolean') return {status:'invalid'};
    const email=form.email.trim().toLowerCase();
    const duplicate=await db.prepare(`SELECT 1 FROM app_users u LEFT JOIN staff_access_identities a ON a.user_id=u.id
      WHERE (u.username=? COLLATE NOCASE OR a.email=?) AND u.id!=?`).bind(form.username,email,id ?? -1).first();
    if (duplicate) return {status:'duplicate'};
    if (creating) {
      statement=db.prepare(`INSERT INTO app_users(username,display_name,password_hash,is_admin,active,needs_password)
        SELECT ?,?,?,?,?,1 WHERE ${guard}`).bind(form.username,form.displayName.trim(),hash,+form.isAdmin,+form.active,...adminArgs(actor));
    } else {
      // Never let an administrator disable/demote their own account, or remove the final active administrator.
      if (id===actor.id && (!form.active || !form.isAdmin || email!==actor.email)) return {status:'last_admin'};
      statement=db.prepare(`UPDATE app_users SET username=?,display_name=?,is_admin=?,active=?,session_version=session_version+1
        WHERE id=? AND session_version=? AND (id=? OR ${protection}) AND ${guard}`)
        .bind(form.username,form.displayName.trim(),+form.isAdmin,+form.active,id,form.version,
          actor.id,actor.id,+form.isAdmin,+form.active,...adminArgs(actor));
    }
    try {
      const [change] = await db.batch([statement,
        db.prepare(`INSERT INTO staff_access_identities(email,user_id) SELECT ?,id FROM app_users
          WHERE username=? COLLATE NOCASE AND changes()=1
          ON CONFLICT(user_id) DO UPDATE SET email=excluded.email`).bind(email,form.username),
      ]);
      if (change.meta.changes!==1) return {status:'conflict'};
      const row=await db.prepare('SELECT id FROM app_users WHERE username=? COLLATE NOCASE').bind(form.username).first();
      return {status:'saved',id:row.id};
    } catch (error) {
      if (/UNIQUE constraint failed/.test(String(error))) return {status:'duplicate'};
      throw error;
    }
  }
  const [change]=await db.batch([statement]);
  return {status:change.meta.changes===1 ? 'saved' : 'conflict',id};
}

export async function saveProfile(db,form,actor) {
  if (typeof form.displayName!=='string' || !form.displayName.trim() || form.displayName.trim().length>80) return 'invalid';
  const [change]=await db.batch([db.prepare(`UPDATE app_users SET display_name=? WHERE id=? AND ${currentActor}`)
    .bind(form.displayName.trim(),actor.id,...actorArgs(actor))]);
  return change.meta.changes===1 ? 'saved' : 'conflict';
}

export async function userPhoto(env,actor) {
  const row=await env.DB.prepare('SELECT object_key FROM app_user_photos WHERE user_id=?').bind(actor.id).first();
  return photoKeyValid(row?.object_key,actor.id) ? env.MEDIA.get(row.object_key) : null;
}

export async function saveUserPhoto(env,bytes,actor) {
  if (bytes && (bytes.length>photoLimit || !validJpeg(bytes))) return 'invalid';
  const key=bytes ? `users/${actor.id}/${crypto.randomUUID()}.jpg` : null;
  if (bytes) await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
  const statements=[env.DB.prepare('SELECT object_key FROM app_user_photos WHERE user_id=?').bind(actor.id)];
  statements.push(bytes ? env.DB.prepare(`INSERT INTO app_user_photos(user_id,object_key)
    SELECT ?,? WHERE ${currentActor} ON CONFLICT(user_id) DO UPDATE SET object_key=excluded.object_key`)
    .bind(actor.id,key,...actorArgs(actor)) : env.DB.prepare(`DELETE FROM app_user_photos WHERE user_id=? AND ${currentActor}`)
    .bind(actor.id,...actorArgs(actor)));
  const [old,change]=await env.DB.batch(statements);
  if (change.meta.changes!==1 && (bytes || old.results.length)) {
    if(bytes)await env.MEDIA.delete(key);return 'conflict';
  }
  if (photoKeyValid(old.results[0]?.object_key,actor.id)) {
    try {await env.MEDIA.delete(old.results[0].object_key);}catch{}
  }
  return 'saved';
}

export async function recheckIn(db,id,form,actor,now=new Date()) {
  if (typeof form.username!=='string' || form.username.length>32 || typeof form.password!=='string' || form.password.length>128) return 'invalid';
  if (!await allowCredential(db,actor,now)) return 'rate_limited';
  const admin=await db.prepare(`SELECT id,password_hash FROM app_users WHERE username=? COLLATE NOCASE
    AND active=1 AND is_admin=1 AND needs_password=0`).bind(form.username).first();
  if (!await verifyPassword(admin?.password_hash,form.password)) return 'invalid_credentials';
  const stamp=now.toISOString();
  const guard=`status='completed' AND cancelled_at IS NULL AND ${currentActor}
    AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND password_hash=? AND active=1 AND is_admin=1 AND needs_password=0)`;
  const args=[id,...actorArgs(actor),admin.id,admin.password_hash];
  // Expired share tokens must never become active again when the stay is reopened.
  const expiry=`julianday(?)>=julianday(actual_checkout_at)+COALESCE((SELECT CAST(value AS REAL)
    FROM system_settings WHERE key='care_link_hours'),48)/24.0`;
  const [,change]=await db.batch([
    db.prepare(`DELETE FROM care_share_links WHERE stay_id IN(SELECT id FROM stays WHERE id=? AND ${guard} AND ${expiry})`)
      .bind(...args,stamp),
    db.prepare(`UPDATE stays SET status='checked_in',actual_checkout_at=NULL WHERE id=? AND ${guard}`).bind(...args),
    db.prepare(`INSERT INTO staff_security_events(actor_id,subject_id,stay_id,action,recorded_at)
      SELECT ?,?,?,'recheck_in',? WHERE changes()=1`).bind(actor.id,admin.id,id,stamp),
  ]);
  return change.meta.changes===1 ? 'saved' : 'conflict';
}
