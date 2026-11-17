import {validDay} from "./bookings.mjs";
import {authorizedStaff} from "./stay_payments.mjs";

export const ledgerKinds = {income:"รับเงิน",refund:"คืนเงินลูกค้า",expense:"รายจ่าย"};
export const ledgerCategories = ["ค่าฝากเลี้ยง","อาหารและขนม","อุปกรณ์","ทำความสะอาด","ค่าน้ำไฟ","การตลาด","ค่ารักษาพยาบาล","เอกสาร","อื่นๆ"];
const managed = `(COALESCE(t.auto_stay,0)!=0 OR COALESCE(t.payment_type,'')!=''
  OR (t.kind='refund' AND t.stay_id IS NOT NULL AND COALESCE(t.payment_key,'')!='')
  OR EXISTS(SELECT 1 FROM stays s WHERE s.id=t.stay_id AND s.cancelled_at IS NOT NULL))`;
const columns = `t.id,t.occurred_on,t.kind,t.category,t.description,ROUND(t.amount*100) AS amount_cents,t.customer_id,
  t.stay_id,t.merchant,t.payment_method,t.reference,t.note,(COALESCE(t.receipt,'')!='') AS has_receipt,
  t.cloud_ledger_revision AS revision,c.name AS customer,${managed} AS managed,
  CASE WHEN t.payment_type='deposit' THEN t.deposit_appointment_id ELSE NULL END AS deposit_booking_id`;

export async function ledgerList(db,query,now = new Date()) {
  const today = new Date(now.valueOf()+7*3600000);
  const start = query.get("start") || today.toISOString().slice(0,7)+"-01";
  const end = query.get("end") || new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const kind = query.get("kind") || "all";
  const cursor = query.get("before");
  const before = cursor === null ? [] : /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(cursor);
  const id = before?.length ? Number(before[2]) : null;
  if (!validDay(start) || !validDay(end) || start>end || (kind !== "all" && !Object.hasOwn(ledgerKinds,kind)) ||
      (cursor !== null && (!before || !validDay(before[1]) || !Number.isSafeInteger(id) || id<1))) return null;
  const limit = query.get("export") === "1" ? 200 : 25;
  const date = before[1] || null;
  const {results} = await db.prepare(`SELECT ${columns} FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id
    WHERE t.occurred_on BETWEEN ? AND ? AND (?='all' OR t.kind=?)
      AND (? IS NULL OR (t.occurred_on,t.id)<(?,?))
    ORDER BY t.occurred_on DESC,t.id DESC LIMIT ?`).bind(start,end,kind,kind,date,date,id,limit+1).all();
  const transactions = results.slice(0,limit);
  const last = transactions.at(-1);
  return {transactions,nextBefore:results.length>limit ? last.occurred_on+":"+last.id : null};
}

export async function ledgerChoices(db,id) {
  const [transaction,customers,stays] = await db.batch([
    db.prepare(`SELECT ${columns} FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.id=?`).bind(id),
    db.prepare(`SELECT id,name FROM customers
      WHERE archived=0 OR id=(SELECT customer_id FROM transactions WHERE id=?) ORDER BY name,id`).bind(id),
    db.prepare(`SELECT s.id,s.stay_number,s.checkin,c.name AS customer FROM stays s JOIN customers c ON c.id=s.customer_id
      WHERE s.id=(SELECT stay_id FROM transactions WHERE id=?) OR s.id IN (
        SELECT id FROM stays WHERE cancelled_at IS NULL AND status!='cancelled' ORDER BY id DESC LIMIT 200)
      ORDER BY s.id DESC`).bind(id),
  ]);
  const row = transaction.results[0] || null;
  return id !== null && !row ? null : {transaction:row,customers:customers.results,stays:stays.results};
}

export const ledgerBodyLimit = 8*1024*1024;
const receiptName = /^[^/\\\u0000-\u001f\u007f]+$/;
const hexadecimalKey = /^[a-f0-9]{32}$/;
const revisionKey = /^[a-f0-9-]{36}$/;
const eligibleReferences = `(? IS NULL OR EXISTS(SELECT 1 FROM customers c WHERE c.id=? AND (c.archived=0 OR c.id IS ?)))
  AND (? IS NULL OR EXISTS(SELECT 1 FROM stays s WHERE s.id=? AND s.cancelled_at IS NULL AND s.status!='cancelled'))`;

async function cleanReceipt(env,name) {
  if (!env.MEDIA || !name || name === "." || name === ".." || !receiptName.test(name)) return;
  try {
    if (!await env.DB.prepare("SELECT 1 FROM transactions WHERE receipt=? LIMIT 1").bind(name).first()) {
      await env.MEDIA.delete("receipts/"+name);
    }
  } catch {}
}

async function receiptFile(file) {
  if (file === null || (file instanceof File && file.size === 0 && !file.name)) return null;
  if (!(file instanceof File) || file.size < 8 || file.size > ledgerBodyLimit) return false;
  const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
  const header = new TextDecoder().decode(bytes);
  const ext = /\.(jpe?g|png|webp|pdf)$/i.exec(file.name)?.[1]?.toLowerCase();
  if ((ext === "jpg" || ext === "jpeg") && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (ext === "png" && bytes[0] === 137 && header.slice(1,4) === "PNG" &&
      bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (ext === "webp" && header.startsWith("RIFF") && header.slice(8,12) === "WEBP") return "webp";
  if (ext === "pdf" && header.startsWith("%PDF-")) return "pdf";
  return false;
}

function ledgerFields(form) {
  const {occurredOn,kind,amountCents,customerId,stayId} = form;
  const textFields = ["category","description","merchant","paymentMethod","reference","note"];
  const limits = [120,800,200,80,200,1000];
  if (!validDay(occurredOn) || typeof kind !== "string" || !Object.hasOwn(ledgerKinds,kind) ||
      !Number.isSafeInteger(amountCents) || amountCents<0 || amountCents>99_999_999_900 ||
      ![customerId,stayId].every((id) => id === null || (Number.isSafeInteger(id) && id>0))) return null;
  if (textFields.some((key,index) => typeof form[key] !== "string" || form[key].length>limits[index] || form[key].includes("\0"))) return null;
  const [category,description,merchant,paymentMethod,reference,note] = textFields.map((key) => form[key].trim());
  if (!category || !description) return null;
  return [occurredOn,kind,category,description,amountCents/100,customerId,stayId,merchant,paymentMethod,reference,note];
}

async function findLedgerEntry(db,id) {
  return db.prepare(`SELECT t.id,t.receipt,t.customer_id,t.cloud_ledger_revision AS revision,${managed} AS managed
    FROM transactions t WHERE t.id=?`).bind(id).first();
}

export async function saveLedgerEntry(env,id,form,file,actor) {
  const fields = ledgerFields(form);
  if (!fields || (id === null ? typeof form.key !== "string" || !hexadecimalKey.test(form.key) :
      (form.revision !== null && (typeof form.revision !== "string" || !revisionKey.test(form.revision))))) return {status:"invalid"};
  const db = env.DB;
  const identity = [actor.id,actor.email];
  const createKey = id === null ? actor.id+":"+form.key : null;
  async function createdEntry() {
    return db.prepare(`SELECT id FROM transactions WHERE cloud_ledger_create_key=? AND ${authorizedStaff}`)
      .bind(createKey,...identity).first();
  }
  const previous = id === null ? null : await findLedgerEntry(db,id);
  if (id === null) {
    const replay = await createdEntry();
    if (replay) return {status:"saved",id:replay.id};
  } else if (!previous) return {status:"not_found"};
  else if (previous.managed || previous.revision !== form.revision) return {status:"conflict"};
  const ext = await receiptFile(file);
  if (ext === false) return {status:"invalid_receipt"};
  if (ext && !env.MEDIA) return {status:"storage_unavailable"};
  const newReceipt = ext ? crypto.randomUUID()+"."+ext : null;
  if (newReceipt) await env.MEDIA.put("receipts/"+newReceipt,file);
  const revision = crypto.randomUUID();
  const filename = newReceipt ?? previous?.receipt ?? "";
  const result = id === null
    ? await db.prepare(`INSERT INTO transactions
        (occurred_on,kind,category,description,amount,customer_id,stay_id,merchant,payment_method,reference,note,
         receipt,cloud_ledger_revision,cloud_ledger_create_key)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${eligibleReferences} AND ${authorizedStaff}
        ON CONFLICT(cloud_ledger_create_key) DO NOTHING`)
      .bind(...fields,filename,revision,createKey,form.customerId,form.customerId,null,form.stayId,form.stayId,...identity).run()
    : await db.prepare(`UPDATE transactions AS t SET occurred_on=?,kind=?,category=?,description=?,amount=?,customer_id=?,
        stay_id=?,merchant=?,payment_method=?,reference=?,note=?,receipt=?,cloud_ledger_revision=?
        WHERE t.id=? AND t.cloud_ledger_revision IS ? AND NOT ${managed} AND ${eligibleReferences} AND ${authorizedStaff}`)
      .bind(...fields,filename,revision,id,form.revision,form.customerId,form.customerId,previous.customer_id,
        form.stayId,form.stayId,...identity).run();
  if (result.meta.changes === 1) {
    if (newReceipt && previous) await cleanReceipt(env,previous.receipt);
    return {status:id === null ? "created" : "saved",id:id ?? result.meta.last_row_id};
  }
  if (newReceipt) await cleanReceipt(env,newReceipt);
  if (id === null) {
    const replay = await createdEntry();
    if (replay) return {status:"saved",id:replay.id};
  }
  return {status:"conflict"};
}

export async function deleteLedgerEntry(env,id,revision,actor) {
  if (revision !== null && (typeof revision !== "string" || !revisionKey.test(revision))) return {status:"invalid"};
  const previous = await findLedgerEntry(env.DB,id);
  if (!previous) return {status:"not_found"};
  const {meta} = await env.DB.prepare(`DELETE FROM transactions AS t
    WHERE t.id=? AND t.cloud_ledger_revision IS ? AND NOT ${managed} AND ${authorizedStaff}`)
    .bind(id,revision,actor.id,actor.email).run();
  if (meta.changes !== 1) return {status:"conflict"};
  await cleanReceipt(env,previous.receipt);
  return {status:"deleted"};
}
