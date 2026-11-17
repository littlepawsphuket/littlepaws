// Staff handlers must verify the session before calling this operation.
const bankDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const bankTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const recorded = `
  EXISTS (SELECT 1 FROM transactions t WHERE t.stay_id=s.id AND t.payment_key=?)
  OR EXISTS (SELECT 1 FROM stay_payment_deletions d WHERE d.stay_id=s.id AND d.payment_key=?)
`;

export const stayBalance = `MAX(0, ROUND(s.agreed_total*100) - COALESCE((
  SELECT SUM(ROUND(t.amount*100)) FROM transactions t WHERE t.stay_id=s.id AND t.payment_type!=''
),0))`;

export const authorizedStaff = `EXISTS (SELECT 1 FROM app_users u JOIN staff_access_identities a ON a.user_id=u.id
  WHERE u.id=? AND u.active=1 AND a.email=?)`;

export function normalizePayment(payment, now = new Date()) {
  const {amountCents, paymentDate, key} = payment;
  const paidAt = payment.receivedTime || bankTime.format(now);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 99_999_999_900 ||
      typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key) ||
      typeof paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
      paymentDate > bankDate.format(now) || typeof paidAt !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(paidAt)) return null;
  const parsed = new Date(paymentDate + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== paymentDate ||
      paymentDate.startsWith("0000")) return null;
  return {amountCents, paymentDate, key, paidAt};
}

export async function receiveStayPayment(db, stayId, payment, actor, now = new Date()) {
  if (!Number.isSafeInteger(actor?.id) || typeof actor?.email !== "string" || !actor.email) return "forbidden";
  const normalized = normalizePayment(payment, now);
  if (!Number.isSafeInteger(stayId) || stayId < 1 || !normalized) return "invalid";
  const {amountCents, paymentDate, key, paidAt} = normalized;

  // Run the balance test and insert in one statement. The second statement
  // distinguishes a replay from a missing stay or a rejected amount.
  const actorParams = [actor.id, actor.email];
  const [insert, lookup] = await db.batch([
    db.prepare(`INSERT INTO transactions
      (occurred_on,kind,category,description,amount,customer_id,stay_id,payment_method,payment_type,payment_key,received_time)
      SELECT ?,'income','ค่าฝากเลี้ยง','ชำระเพิ่มเติม',?/100.0,s.customer_id,s.id,'','additional',?,?
      FROM stays s
      WHERE s.id=? AND ${authorizedStaff} AND s.payment_tracking=1 AND s.status!='cancelled' AND s.cancelled_at IS NULL
        AND NOT (${recorded})
        AND ? <= ${stayBalance}`).bind(paymentDate, amountCents, key, paidAt, stayId, ...actorParams, key, key, amountCents),
    db.prepare(`SELECT (${recorded}) AS recorded, (${authorizedStaff}) AS authorized FROM stays s WHERE s.id=?`).bind(key, key, ...actorParams, stayId),
  ]);
  if (insert.meta.changes === 1) return "saved";
  const stay = lookup.results[0];
  if (!stay) return "not_found";
  if (!stay.authorized) return "forbidden";
  return stay.recorded ? "duplicate" : "balance_exceeded";
}
