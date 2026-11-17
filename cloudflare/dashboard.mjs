import {dashboardFinance} from "./dashboard_finance.mjs";
import {validDogPhotoKey} from "./timeline.mjs";

export async function dashboardOverview(db,from,to) {
  const finance = await dashboardFinance(db,from,to);
  if (!finance) return null;
  const start = from+"-01";
  const limit = new Date(to+"-01T00:00:00Z");
  limit.setUTCMonth(limit.getUTCMonth()+1);
  const end = limit.toISOString().slice(0,10);
  const contact = "COALESCE(NULLIF(TRIM(COALESCE(c.owner_phone,'') || ' / ' || COALESCE(c.line_id,''),' /'),''),c.contact)";
  const [current,upcoming,categories,statistics,recent] = await db.batch([
    db.prepare(`SELECT s.id AS stay_id,d.id AS dog_id,d.name AS dog,c.id AS customer_id,c.name AS owner,${contact} AS contact,
        s.checkout,dp.object_key,json_extract(CASE WHEN json_valid(s.intake) THEN s.intake ELSE '{}' END,'$.pickup_time') AS pickup_time,
        MAX(0,CAST(julianday(s.checkout)-julianday(date('now','+7 hours')) AS INTEGER)) AS days_left,
        (SELECT COUNT(*) FROM care_events e WHERE e.stay_id=s.id AND e.dog_id=d.id
          AND substr(e.recorded_at,1,10)=date('now','+7 hours')) AS care_count,
        (SELECT json_object('time',substr(e.recorded_at,12,5),'label',e.activity_label,'kind',e.kind,'note',e.note)
          FROM care_events e WHERE e.stay_id=s.id AND e.dog_id=d.id AND substr(e.recorded_at,1,10)=date('now','+7 hours')
          ORDER BY e.recorded_at DESC,e.id DESC LIMIT 1) AS latest_care
      FROM stays s JOIN customers c ON c.id=s.customer_id JOIN stay_dogs sd ON sd.stay_id=s.id
      JOIN dogs d ON d.id=sd.dog_id LEFT JOIN dog_photos dp ON dp.dog_id=d.id
      WHERE s.status='checked_in' AND s.cancelled_at IS NULL
        AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<=date('now','+7 hours')
      ORDER BY s.checkout,d.name,d.id`).bind(),
    db.prepare(`SELECT a.id,'booking' AS source,a.customer_id,a.checkin,a.checkout,a.charged_nights,a.service_type,
        d.id AS dog_id,d.name AS dog,c.name AS owner,${contact} AS contact,dp.object_key,
        CAST(julianday(a.checkin)-julianday(date('now','+7 hours')) AS INTEGER) AS days_until
      FROM appointments a JOIN customers c ON c.id=a.customer_id
      JOIN appointment_dogs ad ON ad.appointment_id=a.id JOIN dogs d ON d.id=ad.dog_id
      LEFT JOIN dog_photos dp ON dp.dog_id=d.id WHERE a.status='pending' AND a.stay_id IS NULL
      UNION ALL
      SELECT s.id,'stay',s.customer_id,s.checkin,s.checkout,s.charged_nights,
        json_extract(CASE WHEN json_valid(s.intake) THEN s.intake ELSE '{}' END,'$.service_type'),
        d.id,d.name,c.name,${contact},dp.object_key,
        CAST(julianday(s.checkin)-julianday(date('now','+7 hours')) AS INTEGER)
      FROM stays s JOIN customers c ON c.id=s.customer_id JOIN stay_dogs sd ON sd.stay_id=s.id
      JOIN dogs d ON d.id=sd.dog_id LEFT JOIN dog_photos dp ON dp.dog_id=d.id
      WHERE s.status='booked' AND s.cancelled_at IS NULL ORDER BY checkin,owner,dog`).bind(),
    db.prepare(`SELECT category,SUM(CAST(ROUND(amount*100) AS INTEGER)) AS cents FROM transactions
      WHERE kind='expense' AND occurred_on>=? AND occurred_on<? GROUP BY category ORDER BY cents DESC,category`).bind(start,end),
    db.prepare(`SELECT COUNT(*) AS stays,COALESCE(SUM(s.charged_nights),0) AS nights,
      COALESCE(SUM((SELECT COUNT(*) FROM stay_dogs sd WHERE sd.stay_id=s.id)),0) AS dogs FROM stays s
      WHERE s.status IN ('checked_in','completed') AND s.cancelled_at IS NULL
        AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)>=?
        AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<?`).bind(start,end),
    db.prepare(`SELECT t.id,t.occurred_on,t.kind,t.description,ROUND(t.amount*100) AS amount_cents,c.name AS customer
      FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id
      WHERE occurred_on>=? AND occurred_on<? ORDER BY occurred_on DESC,t.id DESC LIMIT 10`).bind(start,end),
  ]);
  const withPhoto = ({object_key,...dog}) => ({...dog,has_photo:validDogPhotoKey(object_key,dog.dog_id)});
  return {...finance,current:current.results.map((row) => ({...withPhoto(row),latest_care:row.latest_care ? JSON.parse(row.latest_care) : null})),
    upcoming:upcoming.results.map(withPhoto),categories:categories.results,stats:statistics.results[0],recent:recent.results};
}
