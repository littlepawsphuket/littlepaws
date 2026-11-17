import assert from "node:assert/strict";
import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import worker from "./timeline.mjs";
import staff from "./staff.mjs";
import {receiveStayPayment} from "./stay_payments.mjs";

const [file, media] = process.argv.slice(2);
const sqlite = new DatabaseSync(file);
const updatedMedia = new Map();
const removedMedia = new Set();
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
      if (removedMedia.has(key)) return null;
      if (updatedMedia.has(key)) return {body:updatedMedia.get(key)};
      try { return {body: await readFile(join(media, key))}; }
      catch (error) { if (error.code !== "ENOENT") throw error; return null; }
    },
    async put(key, bytes) { updatedMedia.set(key, Uint8Array.from(bytes)); },
    async delete(key) { updatedMedia.delete(key); removedMedia.add(key); },
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
sqlite.exec(await readFile(new URL("./booking_deposits.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./customer_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./dog_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./booking_writes.sql", import.meta.url), "utf8"));
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
const customersPath = "/api/customers";
const customerPath = customersPath + "/1";
const customerDogPhoto = customerPath + "/dogs/2/photo";
for (const privatePath of [customersPath, customerPath, customerDogPhoto]) {
  assert.equal((await staffCall(privatePath)).status, 403);
  assert.equal((await get(privatePath)).status, 404);
}
const directory = await (await staffCall(customersPath + "?q=Other%20dog", {}, context)).json();
assert.deepEqual(directory.customers, [{id:1,name:"Fixture owner",dog_count:2}]);
const archived = await (await staffCall(customersPath + "?q=Archived", {}, context)).json();
assert.deepEqual(archived.customers, []);
assert.equal((await staffCall(customersPath + "/2", {}, context)).status, 404);
const customer = await (await staffCall(customerPath, {}, context)).json();
assert.equal(customer.customer.owner_phone, "0810000000");
assert.equal(customer.dogs.length, 2);
assert.equal(customer.stays.length, 2);
assert.match(customer.stays.find((stay) => stay.id === 1).dogs, /Other dog/);
assert.equal((await staffCall("/api/customers/3/dogs/2/photo", {}, context)).status, 404);
const profilePhoto = await staffCall(customerDogPhoto, {}, context);
assert.equal(profilePhoto.headers.get("Cache-Control"), "private, no-store");
const originalDogPhoto = new Uint8Array(await profilePhoto.arrayBuffer());
assert.equal(originalDogPhoto[0], 255);
const photoUpload = (body, origin = "https://staff.example.test") => ({
  method:"PUT", headers:{Origin:origin,"Content-Type":"image/jpeg"}, body,
});
assert.equal((await staffCall(customerDogPhoto, photoUpload(originalDogPhoto))).status, 403);
assert.equal((await staffCall(customerDogPhoto, photoUpload(originalDogPhoto, "https://other.example.test"), context)).status, 403);
assert.equal((await staffCall("/api/customers/3/dogs/2/photo", photoUpload(originalDogPhoto), context)).status, 404);
assert.equal((await staffCall(customerDogPhoto, photoUpload(new Uint8Array(512 * 1024 + 1)), context)).status, 413);
assert.equal((await staffCall(customerDogPhoto, photoUpload(new Uint8Array([255, 216, 255, 217])), context)).status, 400);
assert.equal((await staffCall(customerDogPhoto, photoUpload(originalDogPhoto), context)).status, 200);
const firstPhotoKey = sqlite.prepare("SELECT object_key FROM dog_photos WHERE dog_id=2").get().object_key;
assert.match(firstPhotoKey, /^dogs\/2\/[a-f0-9-]{36}\.jpg$/);
assert.equal(removedMedia.has("dogs/2.jpg"), true);
assert.equal((await staffCall(customerDogPhoto, photoUpload(originalDogPhoto), context)).status, 200);
assert.equal(removedMedia.has(firstPhotoKey), true);
const replacedPhoto = await staffCall(customerDogPhoto, {}, context);
assert.deepEqual(new Uint8Array(await replacedPhoto.arrayBuffer()), originalDogPhoto);
const customerForm = {name:" ลูกค้าทดสอบ ",owner_phone:"0811234567",line_id:"test-line",
  emergency_address:"ภูเก็ต",note:"Test note",key:"e".repeat(32)};
const customerWrite = (method, body, origin = "https://staff.example.test") => ({
  method, headers:{Origin:origin,"Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined,
});
assert.equal((await staffCall(customersPath, customerWrite("POST", customerForm))).status, 403);
assert.equal((await staffCall(customersPath, customerWrite("POST", customerForm, "https://other.example.test"), context)).status, 403);
assert.equal((await staffCall(customersPath, customerWrite("POST", {...customerForm,name:" "}), context)).status, 400);
const creations = await Promise.all([0,1].map(() => staffCall(customersPath, customerWrite("POST", customerForm), context)));
assert.deepEqual(creations.map((response) => response.status).sort(), [200,201]);
const [firstCustomer, retryCustomer] = await Promise.all(creations.map((response) => response.json()));
assert.equal(firstCustomer.id, retryCustomer.id);
const newCustomerPath = customersPath + "/" + firstCustomer.id;
const newCustomer = await (await staffCall(newCustomerPath, {}, context)).json();
assert.equal(newCustomer.customer.name, "ลูกค้าทดสอบ");
assert.match(sqlite.prepare("SELECT registered_at FROM customers WHERE id=?").get(firstCustomer.id).registered_at, /\+07:00$/);
assert.equal((await staffCall(customerPath, customerWrite("PUT", {...customerForm,name:"Fixture owner"}), context)).status, 200);
const editedCustomer = await (await staffCall(customerPath, {}, context)).json();
assert.equal(editedCustomer.customer.owner_phone, "0811234567");
assert.equal(editedCustomer.dogs.length, 2);
assert.equal(editedCustomer.stays.length, 2);
assert.equal((await staffCall(newCustomerPath, customerWrite("DELETE"), context)).status, 200);
assert.equal((await staffCall(newCustomerPath, customerWrite("DELETE"), context)).status, 200);
assert.equal((await staffCall(newCustomerPath, {}, context)).status, 404);
assert.equal((await staffCall(newCustomerPath, customerWrite("PUT", customerForm), context)).status, 404);
assert.equal((await staffCall(customersPath, customerWrite("POST", customerForm), context)).status, 404);
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
assert.equal((await staffCall("/api/bookings/1")).status, 403);
assert.equal((await get("/api/bookings/1")).status, 404);
assert.equal((await staffCall("/api/bookings/9999", {}, context)).status, 404);
const bookingDetails = await staffCall("/api/bookings/1", {}, context);
assert.equal(bookingDetails.headers.get("Cache-Control"), "private, no-store");
const detail = await bookingDetails.json();
assert.deepEqual(detail.dogs, [{id:2,name:"Other dog", nightly_rate_cents:60000}]);
assert.equal(detail.payments.length, 1);
assert.equal(detail.payments[0].amount_cents, 35000);
assert.match(detail.payments[0].payment_key, /^[a-f0-9]{32}$/);
assert.equal(detail.balance_cents, 85000);
assert.equal(detail.charged_nights, 2);
const linkedBooking = await (await staffCall("/api/bookings/3", {}, context)).json();
assert.equal(linkedBooking.stay_id, 1);
assert.equal(linkedBooking.balance_cents, null);
const depositPath = "/api/bookings/1/deposits";
const depositPayload = {amountCents:25000, paymentDate:"2026-01-02", receivedTime:"10:15", key:"a".repeat(32)};
const depositRequest = (body, origin = "https://staff.example.test") => ({
  method:"POST", headers:{Origin:origin,"Content-Type":"application/json"}, body:JSON.stringify(body),
});
assert.equal((await staffCall(depositPath, depositRequest(depositPayload))).status, 403);
assert.equal((await staffCall(depositPath, depositRequest(depositPayload, "https://other.example.test"), context)).status, 403);
assert.equal((await staffCall(depositPath, depositRequest({...depositPayload,receivedTime:"25:00"}), context)).status, 400);
const replays = await Promise.all([0, 1].map(() => staffCall(depositPath, depositRequest(depositPayload), context)));
assert.deepEqual(replays.map((result) => result.status).sort(), [200, 201]);
const updatedBooking = await (await staffCall("/api/bookings/1", {}, context)).json();
assert.equal(updatedBooking.balance_cents, 60000);
assert.equal(updatedBooking.payments.length, 2);
assert.equal(updatedBooking.payments[1].received_time, "10:15");
const over = await staffCall(depositPath, depositRequest({...depositPayload,amountCents:60001,key:"b".repeat(32)}), context);
assert.equal(over.status, 409);
assert.equal((await over.json()).status, "balance_exceeded");
for (const id of [2, 3]) {
  const closed = await staffCall("/api/bookings/" + id + "/deposits", depositRequest(depositPayload), context);
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).status, "booking_closed");
}
const lastDeposit = updatedBooking.payments[1];
const deletePath = depositPath + "/" + lastDeposit.id;
const deleteRequest = {...depositRequest({key:lastDeposit.payment_key}), method:"DELETE"};
assert.equal((await staffCall(deletePath, deleteRequest)).status, 403);
assert.equal((await staffCall("/api/bookings/2/deposits/" + lastDeposit.id, deleteRequest, context)).status, 404);
assert.equal((await staffCall(deletePath, deleteRequest, context)).status, 200);
assert.equal((await staffCall(deletePath, deleteRequest, context)).status, 200);
assert.equal((await staffCall(depositPath, depositRequest(depositPayload), context)).status, 200);
const afterDelete = await (await staffCall("/api/bookings/1", {}, context)).json();
assert.equal(afterDelete.balance_cents, 85000);
assert.equal(afterDelete.payments.length, 1);
assert.equal(sqlite.prepare("SELECT deleted_by FROM booking_deposit_deletions WHERE transaction_id=?").get(lastDeposit.id).deleted_by, 1);
// SQLite can reuse the last row ID after deletion. An old request must not delete its replacement.
const newDeposit = {...depositPayload, key:"c".repeat(32)};
assert.equal((await staffCall(depositPath, depositRequest(newDeposit), context)).status, 201);
assert.equal((await staffCall(deletePath, deleteRequest, context)).status, 200);
const replaced = await (await staffCall("/api/bookings/1", {}, context)).json();
assert.equal(replaced.payments[1].id, lastDeposit.id);
assert.equal(replaced.payments[1].payment_key, newDeposit.key);
assert.equal(replaced.balance_cents, 60000);
const bookingForm = {customerId:1,checkin:"2026-11-20",checkout:"2026-12-31",service:"monthly",quantity100:137,
  discountCents:1234,dogs:[{id:1,rate:100001},{id:2,rate:150002}],note:"Booking fixture",wholeBaht:true,
  key:"9".repeat(32)};
assert.equal((await staffCall("/api/bookings", customerWrite("POST",bookingForm))).status,403);
assert.equal((await staffCall("/api/bookings", customerWrite("POST",{...bookingForm,customerId:3}),context)).status,400);
assert.equal((await staffCall("/api/bookings", customerWrite("POST",{...bookingForm,checkout:"2026-02-31"}),context)).status,400);
const bookingCreates = await Promise.all([0,1].map(() => staffCall("/api/bookings", customerWrite("POST",bookingForm),context)));
assert.deepEqual(bookingCreates.map((response) => response.status).sort(), [200,201]);
const [{id:createdBookingId},sameBooking] = await Promise.all(bookingCreates.map((response) => response.json()));
assert.equal(createdBookingId,sameBooking.id);
const createdBookingPath = "/api/bookings/" + createdBookingId;
const createdBooking = await (await staffCall(createdBookingPath, {},context)).json();
assert.match(createdBooking.booking_number,/^[A-Z0-9]{6}$/);
assert.equal(createdBooking.total_cents,341200);
assert.equal(createdBooking.dogs.length,2);
const editForm = {...bookingForm,revision:createdBooking.cloud_revision,dogs:[{id:1,rate:200000}]};
assert.equal((await staffCall(createdBookingPath,customerWrite("PUT",editForm),context)).status,200);
assert.equal((await staffCall(createdBookingPath,customerWrite("PUT",editForm),context)).status,409);
const editedBooking = await (await staffCall(createdBookingPath,{},context)).json();
assert.equal(editedBooking.booking_number,createdBooking.booking_number);
assert.deepEqual(editedBooking.dogs.map((dog) => dog.id),[1]);
assert.equal((await staffCall("/api/bookings/1",customerWrite("DELETE"),context)).status,409);
const lowerTotal = {...bookingForm,revision:null,dogs:[{id:2,rate:100}],discountCents:0};
assert.equal((await staffCall("/api/bookings/1",customerWrite("PUT",lowerTotal),context)).status,409);
assert.equal((await staffCall(createdBookingPath,customerWrite("DELETE"),context)).status,200);
assert.equal((await staffCall("/api/bookings",customerWrite("POST",bookingForm),context)).status,409);
const removedBookingList = await (await staffCall(bookingPath + "?q=" + createdBooking.booking_number, {}, context)).json();
assert.deepEqual(removedBookingList.bookings, []);
const warningForm = {...bookingForm,key:"0".repeat(32),checkin:"2026-01-10",checkout:"2026-01-13",
  dogs:[{id:2,rate:100000}]};
sqlite.exec("INSERT INTO system_settings(key,value) VALUES('capacity','1')");
sqlite.exec("INSERT INTO shop_holidays(name,starts_on,ends_on) VALUES('Fixture holiday','2026-01-11','2026-01-11')");
const warningResponse = await staffCall("/api/bookings",customerWrite("POST",warningForm),context);
assert.equal(warningResponse.status,409);
const bookingWarning = await warningResponse.json();
assert.deepEqual(bookingWarning.warnings,["holiday","overlap","capacity"]);
assert.match(bookingWarning.token,/^[a-f0-9]{64}$/);
assert.equal(sqlite.prepare("SELECT count(*) AS total FROM appointments WHERE create_key=?").get(warningForm.key).total,0);
sqlite.exec("UPDATE shop_holidays SET ends_on='2026-01-12' WHERE name='Fixture holiday'");
const staleWarning = await (await staffCall("/api/bookings",customerWrite("POST",{
  ...warningForm,warningToken:bookingWarning.token,
}),context)).json();
assert.deepEqual(staleWarning.warnings,bookingWarning.warnings);
assert.notEqual(staleWarning.token,bookingWarning.token);
const confirmedWarning = await staffCall("/api/bookings",customerWrite("POST",{
  ...warningForm,warningToken:staleWarning.token,
}),context);
assert.equal(confirmedWarning.status,201);
const warningId = (await confirmedWarning.json()).id;
assert.equal((await staffCall("/api/bookings",customerWrite("POST",warningForm),context)).status,200);
assert.equal((await staffCall("/api/bookings/" + warningId,customerWrite("DELETE"),context)).status,200);
sqlite.exec("DELETE FROM system_settings WHERE key='capacity'");
const calendarPath = "/api/bookings/calendar?start=2026-01-01&end=2026-01-31";
assert.equal((await staffCall(calendarPath)).status,403);
assert.equal((await get(calendarPath)).status,404);
assert.equal((await staffCall("/api/bookings/calendar?start=2026-01-01&end=2026-03-01",{},context)).status,400);
assert.equal((await staffCall("/api/bookings/calendar?start=2026-02-31&end=2026-03-01",{},context)).status,400);
const calendar = await (await staffCall(calendarPath,{},context)).json();
assert.deepEqual(calendar.bookings.map((booking) => booking.id),[3,1]);
assert.equal(calendar.bookings[0].stay_id,1);
assert.deepEqual(calendar.holidays.map(({name,starts_on,ends_on}) => [name,starts_on,ends_on]),
  [["Fixture holiday","2026-01-11","2026-01-12"]]);
const singleDay = await (await staffCall("/api/bookings/calendar?start=2026-01-12&end=2026-01-12",{},context)).json();
assert.deepEqual(singleDay.bookings.map((booking) => booking.id),[1]);
assert.equal(singleDay.holidays.length,1);
const concurrentBooking = {...bookingForm,checkin:"2027-02-05",checkout:"2027-02-06",dogs:[{id:2,rate:100000}]};
const racingBookings = await Promise.all(["1","2"].map((digit) => staffCall("/api/bookings",
  customerWrite("POST",{...concurrentBooking,key:digit.repeat(32)}),context)));
assert.deepEqual(racingBookings.map((result) => result.status).sort(),[201,409]);
const raceWarning = await racingBookings.find((result) => result.status === 409).json();
assert.deepEqual(raceWarning.warnings,["overlap"]);
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
const dogsPath = customerPath + "/dogs";
const dogForm = {name:"New dog",size:"medium",note:"",breed:"Corgi",gender:"female",neutered:"yes",
  weight:"10.5",vaccinated:"yes",rabies:"yes",flea_tick:"",medical_history:"",required_care:"",medications:"",
  birth_date:"",birth_estimated:false,age_years:"3",age_months:"2",key:"f".repeat(32)};
assert.equal((await staffCall(dogsPath, customerWrite("POST", dogForm))).status, 403);
assert.equal((await staffCall(dogsPath, customerWrite("POST", {...dogForm,age_months:"12"}), context)).status, 400);
const dogResponses = await Promise.all([0,1].map(() => staffCall(dogsPath, customerWrite("POST", dogForm), context)));
assert.deepEqual(dogResponses.map((response) => response.status).sort(), [200,201]);
const dogs = (await (await staffCall(customerPath, {}, context)).json()).dogs;
assert.equal(dogs.filter((dog) => dog.name === "New dog").length, 1);
const newDog = dogs.find((dog) => dog.name === "New dog");
const newDogProfile = JSON.parse(newDog.profile);
assert.equal(newDogProfile.birth_estimated, true);
assert.match(newDogProfile.birth_date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal((await staffCall("/api/customers/3/dogs/2", customerWrite("PUT", dogForm), context)).status, 404);
assert.equal((await staffCall(dogsPath + "/2", customerWrite("PUT", {...dogForm,name:"Other dog",age_years:"",
  age_months:"",birth_date:"2020-02-29"}), context)).status, 200);
const editedDog = sqlite.prepare("SELECT profile FROM dogs WHERE id=2").get();
assert.equal(JSON.parse(editedDog.profile).birth_date, "2020-02-29");
assert.equal((await staffCall(dogsPath + "/2", customerWrite("DELETE"), context)).status, 200);
assert.equal((await staffCall(dogsPath + "/" + newDog.id, customerWrite("DELETE"), context)).status, 200);
const afterDog = await (await staffCall(customerPath, {}, context)).json();
assert.equal(afterDog.dogs.length, 1);
assert.match(afterDog.stays.find((stay) => stay.id === 1).dogs, /Other dog/);
assert.equal((await staffCall(customerDogPhoto, {}, context)).status, 404);
assert.equal((await staffCall(customerPath, customerWrite("DELETE"), context)).status, 200);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM stays WHERE customer_id=1").get().count, 2);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM dogs WHERE customer_id=1").get().count, 3);
assert.equal((await staffCall(customerDogPhoto, {}, context)).status, 404);
sqlite.exec("UPDATE app_users SET active=0 WHERE id=1");
assert.equal((await staffCall(paymentPath, staffOptions, context)).status, 403);
assert.equal(await receiveStayPayment(env.DB, 1, {...payment, key: "5".repeat(32)}, actor, now), "forbidden");
sqlite.close();
console.log("Migration, Worker timeline and payment operation smoke checks passed");
