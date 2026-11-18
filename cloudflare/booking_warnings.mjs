// Reuse the same ordered snapshot in the read and the conditional write.
export const bookingSnapshot = `
  SELECT json_object(
    'capacity', (SELECT value FROM system_settings WHERE key='capacity'),
    'holidays', json((SELECT json_group_array(json_array(id,starts_on,ends_on)) FROM (
      SELECT id,starts_on,ends_on FROM shop_holidays
      WHERE starts_on<=? AND ends_on>=? ORDER BY id
    ))),
    'slots', json((SELECT json_group_array(json_array(start,finish,dog_id)) FROM (
      SELECT a.checkin AS start,a.checkout AS finish,ad.dog_id
      FROM appointments a JOIN appointment_dogs ad ON ad.appointment_id=a.id
      WHERE a.status='pending' AND a.stay_id IS NULL AND a.id IS NOT ?
        AND a.checkin<=? AND a.checkout>=?
      UNION ALL
      SELECT COALESCE(substr(s.actual_checkin_at,1,10),s.checkin),
        COALESCE(substr(s.actual_checkout_at,1,10),s.checkout),sd.dog_id
      FROM stays s JOIN stay_dogs sd ON sd.stay_id=s.id
      WHERE s.status!='cancelled' AND s.cancelled_at IS NULL AND s.id IS NOT ?
        AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<=?
        AND COALESCE(substr(s.actual_checkout_at,1,10),s.checkout)>=?
      ORDER BY start,finish,dog_id
    )))
  ) AS snapshot
`;

export function snapshotParams(id, start, end, stayId=null) {
  return [end,start,id,end,start,stayId,end,start];
}

export async function bookingWarnings(db, id, start, end, dogIds, stayId=null) {
  const params = snapshotParams(id,start,end,stayId);
  const {snapshot} = await db.prepare(bookingSnapshot).bind(...params).first();
  const {capacity,holidays,slots} = JSON.parse(snapshot);
  const warnings = [];
  if (holidays.length) warnings.push("holiday");
  const selected = new Set(dogIds);
  if (slots.some(([, , dogId]) => selected.has(dogId))) warnings.push("overlap");

  const limit = Number(capacity) || 0;
  if (limit > 0) {
    let occupancy = dogIds.length;
    const changes = new Map();
    const change = (day,value) => changes.set(day,(changes.get(day) || 0)+value);
    for (const [first,last] of slots) {
      if (first <= start) occupancy++;
      else change(first,1);
      if (last < end) {
        const dayAfter = new Date(Date.parse(last + "T00:00:00Z")+86400000).toISOString().slice(0,10);
        change(dayAfter,-1);
      }
    }
    let peak = occupancy;
    for (const day of [...changes.keys()].sort()) {
      occupancy += changes.get(day);
      peak = Math.max(peak,occupancy);
    }
    if (peak > limit) warnings.push("capacity");
  }

  let token = null;
  if (warnings.length) {
    const input = JSON.stringify([id,start,end,[...dogIds].sort((a,b) => a-b),snapshot]);
    const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));
    token = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,"0")).join("");
  }
  return {snapshot,params,warnings,token};
}
