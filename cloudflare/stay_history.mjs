import {validDay} from "./bookings.mjs";
import {stayBalance} from "./stay_payments.mjs";

export async function stayHistory(db,query,now = new Date()) {
  const bangkok = new Date(now.valueOf()+7*3600000);
  const monthStart = bangkok.toISOString().slice(0,7)+"-01";
  const monthEnd = new Date(Date.UTC(bangkok.getUTCFullYear(),bangkok.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const start = query.get("start") ?? monthStart;
  const end = query.get("end") ?? monthEnd;
  const status = query.get("status") || "all";
  const search = (query.get("q") || "").trim().toLowerCase();
  const rawCursor = query.get("before");
  let beforeDay = null, beforeId = null;
  if (rawCursor !== null) {
    const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(rawCursor);
    if (!match || !validDay(match[1])) return null;
    beforeDay = match[1];
    beforeId = Number(match[2]);
    if (!Number.isSafeInteger(beforeId) || beforeId < 1) return null;
  }
  if (!validDay(start) || !validDay(end) || start > end || search.length > 120 ||
      !["all","checked_in","completed"].includes(status)) return null;
  const {results} = await db.prepare(`SELECT s.id,s.stay_number,s.status,s.checkin,s.checkout,c.name AS customer,
    (SELECT group_concat(d.name, ', ') FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=s.id) AS dogs,
    CASE WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE 0 END AS due_cents
    FROM stays s JOIN customers c ON c.id=s.customer_id
    WHERE s.checkin<=? AND s.checkout>=? AND s.cancelled_at IS NULL AND s.status!='cancelled'
      AND (?='all' OR s.status=?)
      AND (? IS NULL OR (s.checkin,s.id)<(?,?))
      AND (?='' OR instr(lower(s.stay_number),?)>0 OR instr(lower(c.name),?)>0
        OR EXISTS (SELECT 1 FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
          WHERE sd.stay_id=s.id AND instr(lower(d.name),?)>0))
    ORDER BY s.checkin DESC,s.id DESC LIMIT 26`)
    .bind(end,start,status,status,beforeDay,beforeDay,beforeId,search,search,search,search).all();
  const stays = results.slice(0,25);
  const last = stays.at(-1);
  return {stays,nextBefore:results.length > stays.length ? last.checkin+":"+last.id : null};
}
