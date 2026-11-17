import assert from "node:assert/strict";
import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import worker from "./timeline.mjs";
import staff from "./staff.mjs";
import {receiveStayPayment} from "./stay_payments.mjs";

const [file, media] = process.argv.slice(2);
const sqlite = new DatabaseSync(file);
const env = {
  DB: {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {bind: (...args) => ({
        first: async () => stmt.get(...args),
        all: async () => ({results: stmt.all(...args)}),
        run: () => {
          if (/^SELECT/.test(sql)) return {results: stmt.all(...args)};
          return {results: [], meta: {changes: stmt.run(...args).changes}};
        },
      })};
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  },
  MEDIA: {
    async get(key) {
      try { return {body: await readFile(join(media, key))}; }
      catch (error) { if (error.code !== "ENOENT") throw error; return null; }
    },
    head: (key) => stat(join(media, key)),
  },
};
const path = (letter) => `/updates/${letter.repeat(43)}`;
const get = (route) => worker.fetch(new Request("https://example.test"+route), env);
const all = await get(path("a")+"?day=all&lang=en");
assert.equal(all.status, 200);
assert.equal(all.headers.get("Content-Language"), "en");
assert.equal(all.headers.get("Cache-Control"), "private, no-store");
const html = await all.text();
assert.match(html, /&lt;script&gt;Fixture dog/);
assert.match(html, /&lt;b&gt;Visible&lt;\/b&gt;/);
assert.doesNotMatch(html, /private note|other dog note/);
assert.equal(await (await get(path("a")+"/photos/1")).text(), "fixture-photo");
for (const route of [path("a")+"/photos/2",path("a")+"/photos/3",path("b")+"/photos/1",path("c"),path("c")+"/photos/1",path("z"),"/settings","/login"]) {
  assert.equal((await get(route)).status, 404, route);
}
let pdfCalls = 0;
const pdfEnv = {...env, PUBLIC_ORIGIN:"https://example.test", BROWSER: {
  async quickAction(action, options) {
    pdfCalls++;
    assert.equal(action,"pdf");
    assert.match(options.html,/&lt;b&gt;Visible&lt;\/b&gt;/);
    assert.doesNotMatch(options.html,/private note|other dog note|Download PDF|<a href=/);
    assert.match(options.html,/loading="eager" src="https:\/\/example\.test\/updates\/a+\/photos\/1"/);
    return new Response("%PDF-fixture",{headers:{"Content-Type":"application/pdf"}});
  },
}};
const pdfPath = path("a")+"/timeline.pdf?day=all&lang=en";
assert.equal((await get(pdfPath)).status,404);
const pdfGet = (route, origin="https://example.test") => worker.fetch(new Request(origin + route),pdfEnv);
const rendered = await pdfGet(pdfPath);
assert.equal(rendered.status,200);
assert.equal(rendered.headers.get("Content-Language"),"en");
assert.equal(rendered.headers.get("Cache-Control"),"private, no-store");
assert.equal(await rendered.text(),"%PDF-fixture");
assert.equal((await pdfGet(pdfPath,"https://unexpected.example.test")).status,404);
assert.equal((await pdfGet(path("c")+"/timeline.pdf")).status,404);
assert.equal(pdfCalls,1);
sqlite.exec("DELETE FROM care_share_links WHERE dog_id=1");
assert.equal((await pdfGet(pdfPath)).status,404);
assert.equal((await get(path("a"))).status, 404);
assert.equal((await get(path("a")+"/photos/1")).status, 404);
sqlite.exec("UPDATE stays SET status='completed', agreed_total=1000, payment_tracking=1 WHERE id=1");
sqlite.exec(await readFile(new URL("./staff_access.sql", import.meta.url), "utf8"));
sqlite.exec("INSERT INTO staff_access_identities (email,user_id) VALUES ('admin@example.test',1)");
const actor = {id:1,email:"admin@example.test"};
const now = new Date("2026-11-17T06:30:00Z");
const payment = {amountCents: 70000, paymentDate: "2026-11-17", key: "1".repeat(32)};
const outcomes = await Promise.all([
  receiveStayPayment(env.DB, 1, payment, actor, now),
  receiveStayPayment(env.DB, 1, {...payment, key: "2".repeat(32)}, actor, now),
]);
assert.deepEqual(outcomes.sort(), ["balance_exceeded", "saved"]);
assert.equal(await receiveStayPayment(env.DB, 1, payment, actor, now), "duplicate");
assert.equal(await receiveStayPayment(env.DB, 1, {...payment, paymentDate: "2026-02-30"}, actor, now), "invalid");
const stored = sqlite.prepare("SELECT amount,received_time FROM transactions WHERE payment_key=?").get(payment.key);
assert.equal(stored.amount, 700);
assert.equal(stored.received_time, "13:30");
sqlite.prepare(`INSERT INTO stay_payment_deletions
  (stay_id,payment_type,occurred_on,received_time,amount,payment_key,deleted_at,reason)
  SELECT stay_id,payment_type,occurred_on,received_time,amount,payment_key,?,'fixture'
  FROM transactions WHERE payment_key=?`).run(now.toISOString(), payment.key);
sqlite.prepare("DELETE FROM transactions WHERE payment_key=?").run(payment.key);
assert.equal(await receiveStayPayment(env.DB, 1, payment, actor, now), "duplicate");
assert.equal(await receiveStayPayment(env.DB, 9999, payment, actor, now), "not_found");
sqlite.exec("UPDATE stays SET status='cancelled' WHERE id=1");
assert.equal(await receiveStayPayment(env.DB, 1, {...payment, amountCents: 1, key: "3".repeat(32)}, actor, now), "balance_exceeded");
sqlite.exec("UPDATE stays SET status='completed' WHERE id=1");
const staffEnv = {...env, ACCESS_AUDIENCE: "fixture-audience"};
const context = {access: {aud: "fixture-audience",
  getIdentity: async () => ({email: "ADMIN@example.test"})}};
const staffCall = (path, options, identity) =>
  staff.fetch(new Request("https://staff.example.test" + path, options), staffEnv, identity);
assert.equal((await staffCall("/api/account", {headers: {
  "Cf-Access-Authenticated-User-Email": "admin@example.test",
}})).status, 403);
assert.equal((await staffCall("/api/account", {}, {access:{...context.access, aud:"wrong"}})).status, 403);
const account = await (await staffCall("/api/account", {}, context)).json();
assert.equal(account.isAdmin, true);
assert.ok(!("email" in account));
const bookingPath = "/api/bookings/pending";
assert.equal((await staffCall(bookingPath)).status, 403);
for (const search of ["", "ab12cd", "Fixture owner", "Other dog"]) {
  const response = await staffCall(bookingPath + "?q=" + encodeURIComponent(search), {}, context);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.bookings.map((b) => [b.booking_number, b.charged_nights, b.total_cents, b.deposit_cents, b.quote_pending]),
    [["AB12CD", 2, 120000, 35000, 0]]);
}
const noBookings = await staffCall(bookingPath + "?q=EF34GH", {}, context);
assert.deepEqual((await noBookings.json()).bookings, []);
const qrPath = "/api/payment-qr.jpg";
const receiptPath = "/api/receipts/1";
for (const filePath of [qrPath, receiptPath]) {
  assert.equal((await staffCall(filePath)).status, 403);
  assert.equal((await get(filePath)).status, 404);
}
const qr = await staffCall(qrPath, {}, context);
assert.equal(qr.headers.get("Content-Type"), "image/jpeg");
assert.equal(qr.headers.get("Cache-Control"), "private, no-store");
assert.equal(await qr.text(), "fixture-qr-original");
assert.equal(await (await staffCall(qrPath, {method: "HEAD"}, context)).text(), "");
const receipt = await staffCall(receiptPath, {}, context);
assert.match(receipt.headers.get("Content-Disposition"), /^attachment; filename="receipt-1.pdf"$/);
assert.equal(await receipt.text(), "%PDF-1.0\nfixture");
assert.equal((await staffCall("/api/receipts/999999", {}, context)).status, 404);
await assert.doesNotReject(async () => {
  const missing = {...staffEnv, MEDIA: {...staffEnv.MEDIA, get: async () => null}};
  assert.equal((await staff.fetch(new Request("https://staff.example.test" + receiptPath), missing, context)).status, 404);
});
const outstanding = await (await staffCall("/api/stays/outstanding", {}, context)).json();
assert.equal(outstanding.stays[0].due_cents, 100000);
assert.equal(outstanding.nextBefore, null);
assert.equal((await staffCall("/api/stays/outstanding?before=oops", {}, context)).status, 400);
assert.equal((await staffCall("/", {})).status, 403);
const staffPage = await staffCall("/", {}, context);
assert.equal(staffPage.status, 200);
assert.match(staffPage.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
assert.match(await staffPage.text(), /ยอดค้างชำระ/);
const paymentPath = "/api/stays/1/payments";
const staffOptions = {method: "POST", headers: {
  Origin: "https://staff.example.test", "Content-Type": "application/json",
}, body: JSON.stringify({amountCents: 5000, paymentDate: "2026-01-02", key: "4".repeat(32)})};
assert.equal((await staffCall(paymentPath, {...staffOptions, headers: {
  ...staffOptions.headers, Origin: "https://cross-origin.example.test",
}}, context)).status, 403);
assert.equal((await staffCall(paymentPath, {...staffOptions, body: " ".repeat(3000)}, context)).status, 400);
assert.equal((await staffCall(paymentPath, staffOptions, context)).status, 201);
assert.equal((await staffCall(paymentPath, staffOptions, context)).status, 200);
sqlite.exec("UPDATE stays SET status='checked_in',actual_checkout_at=NULL WHERE id=1");
const current = await (await staffCall("/api/stays/current", {}, context)).json();
assert.equal(current.stays[0].id, 1);
assert.match(current.stays[0].dogs, /Fixture dog/);
const checkoutPath = "/api/stays/1/check-out";
const checkoutOptions = {method:"POST",headers:{Origin:"https://staff.example.test"}};
assert.equal((await staffCall(checkoutPath, checkoutOptions)).status,403);
assert.equal((await staffCall(checkoutPath, checkoutOptions, context)).status,200);
const checkoutTime = sqlite.prepare("SELECT actual_checkout_at FROM stays WHERE id=1").get().actual_checkout_at;
assert.ok(Number.isFinite(Date.parse(checkoutTime)));
assert.equal((await staffCall(checkoutPath, checkoutOptions, context)).status,200);
assert.equal(sqlite.prepare("SELECT actual_checkout_at FROM stays WHERE id=1").get().actual_checkout_at,checkoutTime);
assert.deepEqual((await (await staffCall("/api/stays/current", {}, context)).json()).stays, []);
sqlite.exec("UPDATE app_users SET active=0 WHERE id=1");
assert.equal((await staffCall(paymentPath, staffOptions, context)).status, 403);
assert.equal(await receiveStayPayment(env.DB, 1, {...payment, key: "5".repeat(32)}, actor, now), "forbidden");
sqlite.close();
console.log("Migration, Worker timeline and payment operation smoke checks passed");
