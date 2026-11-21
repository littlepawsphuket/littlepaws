const tableNames=['customers','dogs','stays','stay_dogs','transactions','appointments','appointment_dogs',
  'dog_photos','stay_consents','system_settings','shop_holidays','coupons','coupon_uses','stay_payment_deletions',
  'boarding_charges','care_comment_state','care_comment_likes','care_comment_reads','care_comments','care_photo_hearts','care_events','care_photos','app_users','app_user_photos','care_share_links','staff_access_identities',
  'booking_deposit_deletions','staff_credential_attempts','staff_security_events'];
export const backupBrandKeys=[...['little-paws-logo.png','balen-gucci-relax.webp','sukhumvit-set.woff2',
  ...['christmas','valentine','halloween','songkran','buddhist','japan'].map(theme=>'mascot-'+theme+'.webp')].map(name=>'brand/'+name),
  ...['dashboard','customers','bookings','checkin','reports','backup','verified'].map(name=>'manual/'+name+'.webp')];
const quote=name=>'"'+name.replaceAll('"','""')+'"';

export async function cloudSnapshot(db) {
  const schema=(await db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL
    AND name NOT LIKE 'sqlite_%' ORDER BY type,name`).bind().all()).results
    .filter(row=>tableNames.includes(row.tbl_name));
  const tables=schema.filter(row=>row.type==='table').map(row=>row.name);
  const result=await db.batch(tables.map(table=>db.prepare(`SELECT * FROM ${quote(table)} LIMIT 10001`).bind()));
  if(result.some(part=>part.results.length>10000))return {error:'backup_too_large'};
  const rows=Object.fromEntries(tables.map((table,index)=>[table,result[index].results]));
  const media=new Set();
  for(const table of ['dog_photos','care_photos','app_user_photos'])for(const row of rows[table] || [])if(row.object_key)media.add(row.object_key);
  for(const row of rows.transactions || [])if(row.receipt)media.add('receipts/'+row.receipt);
  const payload={format:'little-paws-cloud-backup',version:1,created_at:new Date().toISOString(),schema,rows,
    required_media:[...media].sort(),optional_media:['payment/payment-qr.jpg',...backupBrandKeys]};
  if(new TextEncoder().encode(JSON.stringify(payload)).length>5*1024*1024)return {error:'backup_too_large'};
  return payload;
}

export async function backupMedia(env,key) {
  if(typeof key!=='string' || key.length>240 || /[\\\u0000-\u001f]/.test(key) || key.split('/').some(part=>!part || part==='.' || part==='..'))return null;
  if(!['payment/payment-qr.jpg',...backupBrandKeys].includes(key)){
    const record=await env.DB.prepare(`SELECT 1 FROM dog_photos WHERE object_key=?
      UNION ALL SELECT 1 FROM care_photos WHERE object_key=?
      UNION ALL SELECT 1 FROM app_user_photos WHERE object_key=?
      UNION ALL SELECT 1 FROM transactions WHERE receipt!='' AND 'receipts/'||receipt=? LIMIT 1`)
      .bind(key,key,key,key).first();
    if(!record)return null;
  }
  return env.MEDIA.get(key);
}
