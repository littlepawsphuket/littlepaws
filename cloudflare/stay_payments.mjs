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
const stayPayment = "payment_type IN ('deposit','checkin','additional')";
const mutableStay = "s.status NOT IN ('completed','cancelled') AND s.cancelled_at IS NULL";
export const refundableBalance = `MAX(0,COALESCE((
  SELECT SUM(CASE WHEN t.kind='income' THEN ROUND(t.amount*100)
    WHEN t.kind='refund' THEN -ROUND(t.amount*100) ELSE 0 END)
  FROM transactions t WHERE t.stay_id=s.id AND t.auto_stay=0),0))`;

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

function reasonText(form) {
  const reason = typeof form.reason === "string" ? form.reason.trim() : "";
  return reason && [...reason].length <= 500 ? reason : null;
}

export async function removeStayPayment(db,stayId,paymentId,form,actor) {
  const {requestKey,paymentKey,amountCents,occurredOn,receivedTime,paymentType} = form;
  const reason = reasonText(form);
  if (!reason || typeof requestKey !== "string" || !/^[0-9a-f]{32}$/.test(requestKey) ||
      ![stayId,paymentId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      !["deposit","checkin","additional"].includes(paymentType) ||
      !Number.isSafeInteger(amountCents) || amountCents < 0 ||
      typeof occurredOn !== "string" || occurredOn.length > 30 ||
      (paymentKey !== null && (typeof paymentKey !== "string" || paymentKey.length > 128)) ||
      (receivedTime !== null && (typeof receivedTime !== "string" || receivedTime.length > 20))) return "invalid";
  const scope = "t.id=? AND t.stay_id=? AND t.payment_key IS ? AND t.payment_type=? AND t.occurred_on=? AND t.received_time IS ? AND ROUND(t.amount*100)=?";
  const fields = [paymentId,stayId,paymentKey,paymentType,occurredOn,receivedTime,amountCents];
  const identity = [actor.id,actor.email];
  const attempt = crypto.randomUUID();
  const [audit,removed,lookup] = await db.batch([
    db.prepare(`INSERT INTO stay_payment_deletions
      (stay_id,payment_type,occurred_on,received_time,amount,payment_key,deleted_at,reason,
       cloud_request_key,cloud_transaction_id,cloud_deleted_by,cloud_attempt)
      SELECT t.stay_id,t.payment_type,t.occurred_on,t.received_time,t.amount,t.payment_key,?,?,?,t.id,?,?
      FROM transactions t JOIN stays s ON s.id=t.stay_id
      WHERE ${scope} AND ${mutableStay} AND ${authorizedStaff}
      ON CONFLICT(stay_id,cloud_request_key) DO NOTHING`)
      .bind(new Date().toISOString(),reason,requestKey,actor.id,attempt,...fields,...identity),
    db.prepare(`DELETE FROM transactions AS t WHERE ${scope}
      AND EXISTS(SELECT 1 FROM stay_payment_deletions d WHERE d.stay_id=t.stay_id
        AND d.cloud_request_key=? AND d.cloud_attempt=?)
      AND EXISTS(SELECT 1 FROM stays s WHERE s.id=t.stay_id AND ${mutableStay})
      AND ${authorizedStaff}`).bind(...fields,requestKey,attempt,...identity),
    db.prepare(`SELECT (${authorizedStaff}) AS authorized,(${mutableStay}) AS mutable,
        (SELECT cloud_transaction_id FROM stay_payment_deletions WHERE stay_id=s.id AND cloud_request_key=?) AS removed_id
      FROM stays s WHERE s.id=?`).bind(...identity,requestKey,stayId),
  ]);
  const stay = lookup.results[0];
  if (!stay) return "not_found";
  if (!stay.authorized) return "forbidden";
  if (audit.meta.changes === 1) return removed.meta.changes === 1 ? "deleted" : "conflict";
  if (stay.removed_id === paymentId) return "deleted";
  return stay.mutable ? "conflict" : "stay_closed";
}

export async function cancelStay(db,stayId,form,actor) {
  const reason = reasonText(form);
  if (!reason) return "invalid";
  const timestamp = new Date().toISOString();
  const identity = [actor.id,actor.email];
  const target = `SELECT s.id FROM stays s WHERE s.id=? AND s.status!='completed'
    AND s.cancelled_at IS NULL AND ${authorizedStaff}`;
  const [, , ,updated,lookup] = await db.batch([
    db.prepare(`INSERT INTO stay_payment_deletions
      (stay_id,payment_type,occurred_on,received_time,amount,payment_key,deleted_at,reason,cloud_transaction_id,cloud_deleted_by)
      SELECT stay_id,payment_type,occurred_on,received_time,amount,payment_key,?,?,id,?
      FROM transactions WHERE stay_id IN (${target}) AND ${stayPayment}`)
      .bind(timestamp,reason,actor.id,stayId,...identity),
    db.prepare(`DELETE FROM transactions WHERE stay_id IN (${target}) AND ${stayPayment}`).bind(stayId,...identity),
    db.prepare(`UPDATE transactions SET amount=0 WHERE stay_id IN (${target}) AND auto_stay=1`).bind(stayId,...identity),
    db.prepare(`UPDATE stays SET status='cancelled',cancel_reason=?,cancelled_at=? WHERE id IN (${target})`)
      .bind(reason,timestamp,stayId,...identity),
    db.prepare(`SELECT cancelled_at,(${authorizedStaff}) AS authorized FROM stays WHERE id=?`).bind(...identity,stayId),
  ]);
  const stay = lookup.results[0];
  if (!stay) return "not_found";
  if (!stay.authorized) return "forbidden";
  return updated.meta.changes || stay.cancelled_at ? "cancelled" : "stay_closed";
}

export async function recordStayRefund(db,stayId,form,actor) {
  const normalized = normalizePayment(form);
  const reason = reasonText(form);
  if (!normalized || !reason) return "invalid";
  const {paymentDate,amountCents,key,paidAt} = normalized;
  const identity = [actor.id,actor.email];
  const [insert,lookup] = await db.batch([
    db.prepare(`INSERT INTO transactions
      (occurred_on,kind,category,description,amount,customer_id,stay_id,note,payment_key,received_time)
      SELECT ?,'refund','ค่าฝากเลี้ยง','คืนเงินลูกค้า',?/100.0,s.customer_id,s.id,?,?,?
      FROM stays s WHERE s.id=? AND ${authorizedStaff} AND s.cancelled_at IS NOT NULL
        AND NOT (${recorded}) AND ?<=${refundableBalance}`)
      .bind(paymentDate,amountCents,reason,key,paidAt,stayId,...identity,key,key,amountCents),
    db.prepare(`SELECT (${authorizedStaff}) AS authorized,
      EXISTS(SELECT 1 FROM transactions t WHERE t.stay_id=s.id AND t.kind='refund' AND t.payment_key=?) AS recorded
      FROM stays s WHERE s.id=?`).bind(...identity,key,stayId),
  ]);
  if (insert.meta.changes) return "saved";
  const stay = lookup.results[0];
  if (!stay) return "not_found";
  if (!stay.authorized) return "forbidden";
  return stay.recorded ? "duplicate" : "refund_exceeded";
}
