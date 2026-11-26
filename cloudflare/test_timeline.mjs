import assert from "node:assert/strict";
import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
import {execFileSync} from "node:child_process";
import worker from "./timeline.mjs";
import staff from "./staff.mjs";
import {receiveStayPayment} from "./stay_payments.mjs";
import {testStaffUsers} from './test_staff_users.mjs';
import {testStayEdits} from './test_stay_edits.mjs';
import {testCloudBackup} from './test_cloud_backup.mjs';
import {testUiEnglish} from './test_ui_english.mjs';

const [file, media] = process.argv.slice(2);
await testUiEnglish();
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
          if (/^\s*(?:SELECT|WITH)\b/i.test(sql)) return {results: stmt.all(...args)};
          const result = stmt.run(...args);
          return {results:[],meta:{changes:result.changes,last_row_id:result.lastInsertRowid}};
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
    async put(key, bytes) {
      updatedMedia.set(key,bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : Uint8Array.from(bytes));
    },
    async delete(key) { updatedMedia.delete(key); removedMedia.add(key); },
    head: (key) => stat(join(media, key)),
  },
};
sqlite.exec(await readFile(new URL("./care_interactions.sql",import.meta.url),"utf8"));
sqlite.exec(await readFile(new URL("./boarding_charges.sql",import.meta.url),"utf8"));
sqlite.exec(await readFile(new URL("./care_videos.sql",import.meta.url),"utf8"));
const path = (letter) => `/updates/${letter.repeat(43)}`;
const get = (route) => worker.fetch(new Request("https://example.test"+route), env);
const viewCount = (letter = "a") => sqlite.prepare("SELECT view_count FROM care_share_links WHERE token=?").get(letter.repeat(43)).view_count;
assert.equal(viewCount(),0);
const prefetched = await worker.fetch(new Request("https://example.test"+path("a"),{headers:{"Sec-Purpose":"prefetch"}}),env);
assert.equal(prefetched.status,200);
assert.equal(viewCount(),0);
const all = await get(path("a")+"?day=all&lang=en");
assert.equal(all.status, 200);
assert.equal(all.headers.get("Content-Language"), "en");
assert.equal(all.headers.get("Cache-Control"), "private, no-store");
const html = await all.text();
assert.match(html, /&lt;script&gt;Fixture dog/);
assert.ok(html.includes(`src="${path("a")}/profile.jpg"`));
assert.match(html, /&lt;b&gt;Visible&lt;\/b&gt;/);
assert.doesNotMatch(html, /private note|other dog note/);
assert.equal(await (await get(path("a")+"/photos/1")).text(), "fixture-photo");
const profile = await get(path("a")+"/profile.jpg");
assert.equal(profile.headers.get("Content-Type"),"image/jpeg");
assert.deepEqual(Buffer.from(await profile.arrayBuffer()),await readFile(join(media,"dogs/1.jpg")));
const originalKey = sqlite.prepare("SELECT object_key FROM dog_photos WHERE dog_id=1").get().object_key;
sqlite.exec("UPDATE dog_photos SET object_key='dogs/2.jpg' WHERE dog_id=1");
assert.equal((await get(path("a")+"/profile.jpg")).status,404);
sqlite.prepare("UPDATE dog_photos SET object_key=? WHERE dog_id=1").run(originalKey);
for (const route of [path("a")+"/photos/2",path("a")+"/photos/3",path("b")+"/photos/1",
  path("c"),path("c")+"/photos/1",path("c")+"/profile.jpg",path("z")+"/profile.jpg","/settings","/login"]) {
  assert.equal((await get(route)).status, 404, route);
}
let pdfCalls = 0;
const pdfEnv = {...env, PUBLIC_ORIGIN:"https://example.test", BROWSER: {
  async quickAction(action, options) {
    pdfCalls++;
    assert.equal(action,"pdf");
    assert.equal(options.pdfOptions.format,"a4");
    assert.match(options.html,/&lt;b&gt;Visible&lt;\/b&gt;/);
    assert.doesNotMatch(options.html,/private note|other dog note|Download PDF|<a href=/);
    assert.match(options.html,/loading="eager" src="https:\/\/example\.test\/updates\/a+\/photos\/1"/);
    assert.ok(options.html.includes(`src="https://example.test${path("a")}/profile.jpg"`));
    assert.ok(options.html.includes(`src:url("https://example.test${path("a")}/font.woff2")`));
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
assert.equal(viewCount(),1); // Includes one HTML render, with no photo or PDF increment.
const thaiTimeline = await get(path("a")+"?day=all&lang=th");
assert.equal(thaiTimeline.headers.get("Content-Type"),"text/html; charset=utf-8");
const thaiHtml = await thaiTimeline.text();
assert.match(thaiHtml, />ไทม์ไลน์กิจกรรม<\/span>/);
assert.match(thaiHtml, />ทั้งหมด<\/a>/);
assert.match(thaiHtml, /ให้อาหารแล้ว/);
assert.match(thaiHtml, /ลิงก์นี้จะหมดอายุภายใน 48 ชั่วโมงหลังเช็กเอาต์/);
const countBeforeRequests = viewCount();
assert.equal((await get(path("a"))).status,200);
assert.equal((await get(path("a")+"/photos/1")).status,200);
assert.equal((await get(path("a")+"?day=invalid")).status,400);
assert.equal(viewCount(),countBeforeRequests+1);
const beforeFont = viewCount();
if (!await env.MEDIA.get("brand/sukhumvit-set.woff2")) {
  updatedMedia.set("brand/sukhumvit-set.woff2",new TextEncoder().encode("wOF2 fixture font"));
}
const fontReply = await get(path("a")+"/font.woff2");
assert.equal(fontReply.status,200);
assert.equal(fontReply.headers.get("Content-Type"),"font/woff2");
assert.equal(viewCount(),beforeFont);
assert.equal((await get(path("c")+"/font.woff2")).status,404);
const beforeGallery = viewCount();
const galleryReply = await get(path("a")+"/gallery.js");
assert.equal(galleryReply.status,200);
assert.equal(galleryReply.headers.get("Content-Type"),"text/javascript; charset=utf-8");
new Script(await galleryReply.text());
assert.equal(viewCount(),beforeGallery);
assert.equal((await get(path("c")+"/gallery.js")).status,404);

assert.equal((await get(path("b"))).status,200);
assert.equal(viewCount("b"),1);
sqlite.exec("DELETE FROM care_share_links WHERE dog_id=1");
assert.equal((await pdfGet(pdfPath)).status,404);
assert.equal((await get(path("a"))).status, 404);
assert.equal((await get(path("a")+"/photos/1")).status, 404);
assert.equal((await get(path("a")+"/profile.jpg")).status, 404);
assert.equal((await get(path("a")+"/font.woff2")).status,404);
assert.equal((await get(path("a")+"/gallery.js")).status,404);
sqlite.exec("UPDATE stays SET status='completed', agreed_total=1000, payment_tracking=1 WHERE id=1");
sqlite.exec(await readFile(new URL("./staff_access.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./user_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./stay_edits.sql", import.meta.url), "utf8"));
sqlite.exec('UPDATE app_users SET needs_password=0');
sqlite.exec(await readFile(new URL("./booking_deposits.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./customer_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./dog_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./booking_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./direct_checkin.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./coupon_admin.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./care_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./care_photo_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./stay_payment_writes.sql", import.meta.url), "utf8"));
sqlite.exec(await readFile(new URL("./ledger_writes.sql", import.meta.url), "utf8"));
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
const staffEnv = {...env, ACCESS_AUDIENCE:"fixture-audience",TIMELINE_ORIGIN:"https://customer.example.test"};
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
assert.ok(!("password_hash" in account));
const dashboardPath = "/api/dashboard?from=2026-01&to=2026-01";
sqlite.exec("UPDATE stays SET status='checked_in' WHERE id=1");
assert.equal((await get(dashboardPath)).status,404);
assert.equal((await staffCall(dashboardPath)).status,403);
const dashboard = await (await staffCall(dashboardPath,{},context)).json();
assert.equal(dashboard.current.length,2);
assert.ok(dashboard.current.every((dog) => dog.stay_id === 1 && dog.has_photo && dog.customer_id === 1));
assert.ok(!dashboard.current.some((dog) => dog.stay_id === 2));
assert.deepEqual(dashboard.upcoming.map((dog) => [dog.id,dog.dog_id]),[[1,2]]);
assert.equal(dashboard.upcoming[0].charged_nights,2);
assert.equal(dashboard.upcoming[0].owner,"Fixture owner");
assert.equal(dashboard.upcoming[0].contact,"0810000000");
assert.ok(!JSON.stringify(dashboard).includes("object_key"));
assert.deepEqual(dashboard.stats,{stays:2,nights:2,dogs:3});
sqlite.exec("UPDATE stays SET status='completed' WHERE id=1");
assert.equal((await staffCall("/api/dashboard?from=2026-13&to=2026-13",{},context)).status,400);
const cssFile = "/static/style.css";
assert.equal((await get(cssFile)).status,404);
assert.equal((await staffCall(cssFile)).status,403);
const brandAsset = await staffCall("/static/little-paws-logo.png",{},context);
assert.equal(brandAsset.status,200);
assert.equal(brandAsset.headers.get("Content-Type"),"image/png");
assert.deepEqual(Buffer.from(await brandAsset.arrayBuffer()),await readFile(new URL("../app/static/little-paws-logo.png",import.meta.url)));
const style = await staffCall(cssFile,{},context);
assert.match(await style.text(),/season-decoration/);
assert.equal((await staffCall(cssFile,{headers:{"If-None-Match":style.headers.get("ETag")}},context)).status,304);
for (const name of ["payment-qr.jpg","guide/private.webp","../../data/little_paws.sqlite3"]) {
  assert.equal((await staffCall("/static/"+name,{},context)).status,404);
}
const shell = await (await staffCall("/",{},context)).text();
assert.match(shell,/class="brand"/);
assert.match(shell,/<nav class="primary-nav"/);
assert.match(shell,/data-mode="dashboard"/);
assert.match(shell,/staff-landscape/);
assert.match(shell,/Little Paws, Big Love/);
assert.equal((shell.match(/<span><\/span>/g)||[]).length,25);
const reportPath = "/api/reports/finance?start=2026-01-01&end=2026-01-31";
assert.equal((await get(reportPath)).status,404);
assert.equal((await staffCall(reportPath)).status,403);
assert.equal((await staffCall(reportPath,{method:"POST"},context)).status,405);
assert.equal((await staffCall("/api/reports/finance?start=2026-02-30",{},context)).status,400);
assert.equal((await staffCall(reportPath+"&customer=invalid",{},context)).status,400);
const financeReport = await (await staffCall(reportPath,{},context)).json();
assert.deepEqual(financeReport.report.summary.map(item=>item.value),[85000,0,0,85000]);
assert.equal(financeReport.report.rows.length,2);
assert.deepEqual(financeReport.report.chart.months,[{month:"2026-01",values:[85000,0,0]}]);
const balancesReport = await (await staffCall(reportPath.replace("finance?","balances?"),{},context)).json();
assert.equal(balancesReport.report.summary[0].value,100000);
assert.equal(balancesReport.report.rows[0].link.id,1);
const boardingReport = await (await staffCall(reportPath.replace("finance?","boarding?"),{},context)).json();
assert.deepEqual(boardingReport.report.summary.map(item=>item.value),[1,2,3,9,3]);
assert.equal(boardingReport.report.rows.length,3);
const checkedOutReport = await (await staffCall(reportPath.replace("finance?","boarding?")+"&status=completed",{},context)).json();
assert.equal(checkedOutReport.report.summary[0].value,0);
assert.equal(checkedOutReport.report.rows.length,2);
const customerReport = await (await staffCall(reportPath.replace("finance?","customers?"),{},context)).json();
assert.equal(customerReport.report.summary[2].value,1);
assert.equal(customerReport.report.summary[3].value,0);
const registeredAt = sqlite.prepare("SELECT registered_at FROM customers WHERE id=3").get().registered_at;
sqlite.exec("UPDATE customers SET registered_at='2026-01-04T18:00:00Z' WHERE id=3");
const registeredReport = await (await staffCall("/api/reports/customers?start=2026-01-05&end=2026-01-05&segment=registered",{},context)).json();
assert.equal(registeredReport.report.summary[0].value,1);
assert.deepEqual(registeredReport.report.rows.map(row=>row.link.id),[3]);
sqlite.prepare("UPDATE customers SET registered_at=? WHERE id=3").run(registeredAt);
sqlite.exec("INSERT INTO stays(id,customer_id,checkin,checkout,status) VALUES(9001,1,'2025-12-01','2025-12-02','completed')");
const returningReport = await (await staffCall(reportPath.replace("finance?","customers?")+"&segment=returning",{},context)).json();
assert.equal(returningReport.report.summary[2].value,0);
assert.equal(returningReport.report.summary[3].value,1);
sqlite.exec("DELETE FROM stays WHERE id=9001");
sqlite.exec("INSERT INTO coupons(id,code,kind,value,minimum_cents,expires_on,max_uses) VALUES(9001,'909090','fixed',100,0,'2026-12-31',1)");
sqlite.exec("INSERT INTO coupon_uses(stay_id,coupon_id,discount_cents,used_at) VALUES(1,9001,10000,'2026-01-04T18:00:00Z')");
const couponReport = await (await staffCall("/api/reports/coupons?start=2026-01-05&end=2026-01-05&code=909090",{},context)).json();
assert.deepEqual(couponReport.report.summary.map(item=>item.value),[1,10000]);
sqlite.exec("UPDATE stays SET status='cancelled' WHERE id=1");
const cancelledCouponReport = await (await staffCall(reportPath.replace("finance?","coupons?"),{},context)).json();
assert.equal(cancelledCouponReport.report.rows.length,0);
sqlite.exec("UPDATE stays SET status='completed' WHERE id=1; DELETE FROM coupon_uses WHERE coupon_id=9001; DELETE FROM coupons WHERE id=9001");
const reportHtml = await staffCall(reportPath.replace("finance?","finance.html?")+"&lang=en",{},context);
assert.equal(reportHtml.headers.get("Cache-Control"),"private, no-store");
const reportMarkup = await reportHtml.text();
assert.match(reportMarkup,/Income and expenses/);
assert.match(reportMarkup,/850\.00/);
assert.match(reportMarkup,/Little Paws, Big Love/);
const reportXlsx = await staffCall(reportPath.replace("finance?","finance.xlsx?"),{},context);
assert.equal(reportXlsx.headers.get("Content-Type"),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
const workbookCheck = execFileSync(process.argv[4],["-c",`
import io,sys,zipfile,json
from openpyxl import load_workbook
raw=sys.stdin.buffer.read()
assert zipfile.ZipFile(io.BytesIO(raw)).testzip() is None
book=load_workbook(io.BytesIO(raw))
assert book.sheetnames==['Summary','Details','Monthly']
assert book['Summary']['B4'].value==850
assert book['Details'].max_row==3
assert book['Details']['E2'].value==350
assert len(book['Monthly']._charts)==1
print(json.dumps({'valid':True}))
`],{input:Buffer.from(await reportXlsx.arrayBuffer())});
assert.equal(JSON.parse(workbookCheck).valid,true);
const boardingHtml = await (await staffCall(reportPath.replace("finance?","boarding.html?"),{},context)).text();
assert.match(boardingHtml,/&lt;script&gt;Fixture dog/);
assert.doesNotMatch(boardingHtml,/<script>Fixture dog/);
sqlite.exec(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<5001)
  INSERT INTO transactions(occurred_on,kind,amount,category,description)
  SELECT '2003-01-01','income',1,'test','report limit fixture' FROM n`);
const largeReport = await staffCall("/api/reports/finance?start=2003-01-01&end=2003-01-31",{},context);
assert.equal(largeReport.status,422);
const largeReportData = await largeReport.json();
assert.equal(largeReportData.report.error,"report_too_large");
assert.ok(Array.isArray(largeReportData.choices.categories));
sqlite.exec("DELETE FROM transactions WHERE description='report limit fixture'");
const financePath = "/api/dashboard/finance?from=2002-03&to=2002-04";
assert.equal((await get(financePath)).status,404);
assert.equal((await staffCall(financePath)).status,403);
const financeRows = [
  ["2002-03-10","income",100,1],["2002-04-01","income",50,1],["2002-04-20","refund",120,1],
  ["2002-03-12","income",250,2],["2002-04-21","refund",250,2],["2002-03-02","income",40,null],
  ["2002-04-22","refund",15,null],
];
const insertFinance = sqlite.prepare(`INSERT INTO transactions(occurred_on,kind,amount,stay_id,category,description)
  VALUES(?,?,?,?,'test','dashboard finance fixture')`);
for (const row of financeRows) insertFinance.run(...row);
const finance = await (await staffCall(financePath,{},context)).json();
assert.deepEqual(finance.totals,{income_cents:7000,refund_cents:38500,expense_cents:0,cash_flow_cents:5500});
assert.deepEqual(finance.trend.map((month) => month.income_cents),[4000,3000]);
assert.equal((await staffCall("/api/dashboard/finance?from=2002-13&to=2002-04",{},context)).status,400);
sqlite.exec("DELETE FROM transactions WHERE description='dashboard finance fixture'");
const summaryWithViews = await (await staffCall("/api/stays/1",{},context)).json();
assert.ok(summaryWithViews.timeline_views.some((link) => link.view_count === viewCount("b")));
const staffCarePath = "/api/stays/1/dogs/1/timeline";
const timelineEdit = (action,data={},origin="https://staff.example.test") => ({
  method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({action,...data}),
});
assert.equal((await staffCall(staffCarePath)).status,403);
assert.equal((await get(staffCarePath)).status,404);
assert.equal((await staffCall("/api/stays/2/dogs/2/timeline",{},context)).status,404);
assert.equal((await staffCall(staffCarePath+"?day=2026-02-31",{},context)).status,400);
const staffActivities = await (await staffCall(staffCarePath+"?day=2026-01-02",{},context)).json();
assert.equal(staffActivities.events.length,2);
const staffPreview = await (await staffCall(staffCarePath+"?day=2026-01-02&preview=1",{},context)).json();
assert.equal(staffPreview.events.length,1);
assert.equal(staffPreview.events[0].note,"<b>Visible</b>");
assert.equal((await staffCall(staffCarePath+"/photos/2",{},context)).status,200);
assert.equal((await staffCall(staffCarePath+"/photos/3",{},context)).status,404);
sqlite.exec("UPDATE stays SET status='checked_in',actual_checkout_at=NULL WHERE id=1");
assert.equal((await staffCall(staffCarePath,timelineEdit("create",{},"https://other.example.test"),context)).status,403);
assert.equal((await staff.fetch(new Request("https://staff.example.test"+staffCarePath,timelineEdit("create")),
  {...staffEnv,TIMELINE_ORIGIN:"https://customer.example.test/wrong"},context)).status,503);
assert.equal((await staffCall(staffCarePath,timelineEdit("create"),context)).status,200);
const sharedCare = await (await staffCall(staffCarePath,{},context)).json();
assert.equal(sharedCare.view_count,0);
assert.match(sharedCare.share_url,/^https:\/\/customer\.example\.test\/updates\/[A-Za-z0-9_-]{43}$/);
assert.equal((await staffCall(staffCarePath,timelineEdit("create"),context)).status,200);
assert.equal((await (await staffCall(staffCarePath,{},context)).json()).share_url,sharedCare.share_url);
const newLinkPath = new URL(sharedCare.share_url).pathname;
assert.equal((await get(newLinkPath+"/photos/2")).status,404);
assert.equal((await get(newLinkPath+"?day=all")).status,200);
const staffPreviewAfterView = await (await staffCall(staffCarePath+"?preview=1",{},context)).json();
assert.equal(staffPreviewAfterView.view_count,1);
assert.equal(staffPreviewAfterView.events.length,1);
const eventBody = {activity:"walk",note:"Private activity fixture",day:"2026-01-02",time:"08:15",
  visible:false,key:"5".repeat(32)};
assert.equal((await staffCall(staffCarePath,timelineEdit("add-event",{...eventBody,time:"24:00"}),context)).status,400);
const eventWrites = await Promise.all([0,1].map(() => staffCall(staffCarePath,timelineEdit("add-event",eventBody),context)));
assert.deepEqual(eventWrites.map((response) => response.status),[200,200]);
const eventList = await (await staffCall(staffCarePath+"?day=2026-01-02",{},context)).json();
const [createdEvent] = eventList.events.filter((event) => event.note === eventBody.note);
assert.equal(eventList.events.filter((event) => event.note === eventBody.note).length,1);
assert.doesNotMatch(await (await get(newLinkPath+"?day=all")).text(),/Private activity fixture/);
const eventJpeg = new Uint8Array(await readFile(join(media,"dogs/2.jpg")));
const photoWrite = (revision,uploadKey,body=eventJpeg) => ({
  method:"POST",headers:{Origin:"https://staff.example.test","Content-Type":"image/jpeg",
    "X-Event-Revision":revision,"X-Upload-Key":uploadKey},body,
});
const eventPhotosPath = staffCarePath+"/events/"+createdEvent.id+"/photos";
const photoUploadKey = "a".repeat(32);
assert.equal((await staffCall(eventPhotosPath,photoWrite(createdEvent.revision,photoUploadKey))).status,403);
assert.equal((await staffCall(eventPhotosPath,photoWrite(createdEvent.revision,photoUploadKey,new Uint8Array(2)),context)).status,400);
assert.equal((await staffCall(eventPhotosPath.replace("/dogs/1/","/dogs/2/"),photoWrite(createdEvent.revision,photoUploadKey),context)).status,409);
const duplicateUploads = await Promise.all([0,1].map(() =>
  staffCall(eventPhotosPath,photoWrite(createdEvent.revision,photoUploadKey),context)));
assert.deepEqual(duplicateUploads.map((response) => response.status),[200,200]);
const rowWithPhoto = (await (await staffCall(staffCarePath+"?day=2026-01-02",{},context)).json())
  .events.find((event) => event.id === createdEvent.id);
assert.equal(rowWithPhoto.photos.length,1);
const [fixtureUpload] = rowWithPhoto.photos;
assert.match(fixtureUpload.key,/^care\/uploads\/[a-f0-9-]{36}\.jpg$/);
assert.equal((await staffCall(staffCarePath+"/photos/"+fixtureUpload.id,{},context)).status,200);
assert.equal((await get(newLinkPath+"/photos/"+fixtureUpload.id)).status,404);
const editEvent = {...eventBody,eventId:createdEvent.id,revision:createdEvent.revision,activity:"play",
  note:"Published activity fixture",day:"2026-01-01",visible:true};
assert.equal((await staffCall("/api/stays/1/dogs/2/timeline",timelineEdit("edit-event",editEvent),context)).status,409);
assert.equal((await staffCall(staffCarePath,timelineEdit("edit-event",editEvent),context)).status,200);
assert.equal((await staffCall(staffCarePath,timelineEdit("edit-event",editEvent),context)).status,409);
assert.match(await (await get(newLinkPath+"?day=2026-01-01")).text(),/Published activity fixture/);
const editedEvent = (await (await staffCall(staffCarePath+"?day=2026-01-01",{},context)).json()).events[0];
const careExportPath = staffCarePath+"/export.";
assert.equal((await staffCall(careExportPath+"html?day=all")).status,403);
assert.equal((await get(careExportPath+"html?day=all")).status,404);
assert.equal((await staffCall(careExportPath+"html?day=2026-02-31",{},context)).status,400);
assert.equal((await staffCall("/api/stays/2/dogs/2/timeline/export.html?day=all",{},context)).status,404);
const viewsBeforeExport = sqlite.prepare("SELECT view_count FROM care_share_links WHERE token=?")
  .get(newLinkPath.split("/").at(-1)).view_count;
const carePrint = await staffCall(careExportPath+"html?day=all&lang=th",{},context);
assert.equal(carePrint.status,200);
const printedCare = await carePrint.text();
assert.match(printedCare,/สรุปกิจกรรมของน้อง/);
assert.match(printedCare,/เจ้าของ · Fixture owner/);
assert.match(printedCare,/&lt;script&gt;Fixture dog/);
assert.match(printedCare,new RegExp("/timeline/photos/"+fixtureUpload.id));
assert.doesNotMatch(printedCare,/private note|other dog note/);
assert.ok(printedCare.indexOf("&lt;b&gt;Visible&lt;/b&gt;") < printedCare.indexOf("Published activity fixture"));
const careRenderCalls = [];
const renderedCareEnv = {...staffEnv,BROWSER:{
  async quickAction(action,options) {
    careRenderCalls.push({action,options});
    return action === "pdf" ? new Response("%PDF-sample",{headers:{"Content-Type":"application/pdf"}})
      : new Response(new Uint8Array([137,80,78,71]),{headers:{"Content-Type":"image/png"}});
  },
}};
const renderCare = (path) => staff.fetch(new Request("https://staff.example.test"+path),renderedCareEnv,context);
const selectedCarePdf = await renderCare(careExportPath+"pdf?day=2026-01-01&lang=en");
assert.equal(selectedCarePdf.status,200);
assert.match(selectedCarePdf.headers.get("Content-Disposition"),/little-paws-care-1-1-2026-01-01-en\.pdf/);
assert.equal(careRenderCalls[0].action,"pdf");
assert.match(careRenderCalls[0].options.html,/Owner · Fixture owner/);
assert.match(careRenderCalls[0].options.html,/data:image\/jpeg;base64,/);
assert.match(careRenderCalls[0].options.html,/Published activity fixture/);
assert.doesNotMatch(careRenderCalls[0].options.html,/Visible/);
const carePng = await renderCare(careExportPath+"png?day=all&lang=th");
assert.equal(carePng.status,200);
assert.equal(careRenderCalls[1].action,"screenshot");
assert.match(careRenderCalls[1].options.html,/สรุปกิจกรรมของน้อง/);
assert.equal(sqlite.prepare("SELECT view_count FROM care_share_links WHERE token=?")
  .get(newLinkPath.split("/").at(-1)).view_count,viewsBeforeExport);
const publicFixture = await get(newLinkPath+"/photos/"+fixtureUpload.id);
assert.equal(publicFixture.status,200);
assert.deepEqual(new Uint8Array(await publicFixture.arrayBuffer()),eventJpeg);
const concurrentUploads = await Promise.all(["b","c","d","e"].map((char) =>
  staffCall(eventPhotosPath,photoWrite(editedEvent.revision,char.repeat(32)),context)));
assert.deepEqual(concurrentUploads.map((response) => response.status).sort(),[200,200,200,409]);
const deletePhotoPath = eventPhotosPath+"/"+fixtureUpload.id;
const photoDelete = (revision) => ({
  method:"DELETE",headers:{Origin:"https://staff.example.test","Content-Type":"application/json"},
  body:JSON.stringify({key:fixtureUpload.key,revision}),
});
assert.equal((await staffCall(deletePhotoPath,photoDelete(createdEvent.revision),context)).status,409);
assert.equal((await staffCall(deletePhotoPath,photoDelete(editedEvent.revision),context)).status,200);
assert.equal((await staffCall(deletePhotoPath,photoDelete(editedEvent.revision),context)).status,200);
assert.equal((await get(newLinkPath+"/photos/"+fixtureUpload.id)).status,404);
assert.ok(removedMedia.has(fixtureUpload.key));
const remainingPhotos = (await (await staffCall(staffCarePath+"?day=2026-01-01",{},context)).json()).events[0].photos;
assert.equal(remainingPhotos.length,3);
assert.equal((await staffCall(staffCarePath,timelineEdit("remove-event",{eventId:editedEvent.id,revision:editedEvent.revision}),context)).status,200);
assert.ok(remainingPhotos.every((photo) => removedMedia.has(photo.key)));
assert.doesNotMatch(await (await get(newLinkPath+"?day=all")).text(),/Published activity fixture/);
assert.equal((await staffCall(staffCarePath,timelineEdit("publish-day",{day:"2026-01-02"}),context)).status,200);
assert.equal((await get(newLinkPath+"/photos/2")).status,200);
sqlite.exec("UPDATE stays SET status='completed' WHERE id=1");
assert.equal((await staffCall(staffCarePath,timelineEdit("add-event",{...eventBody,key:"6".repeat(32)}),context)).status,409);
assert.equal((await staffCall(staffCarePath,timelineEdit("publish-day",{day:"2026-01-02"}),context)).status,409);
assert.equal((await staffCall(staffCarePath,timelineEdit("revoke"),context)).status,200);
assert.equal((await get(newLinkPath)).status,404);
const customersPath = "/api/customers";
const customerPath = customersPath + "/1";
const customerDogPhoto = customerPath + "/dogs/2/photo";
for (const privatePath of [customersPath, customerPath, customerDogPhoto]) {
  assert.equal((await staffCall(privatePath)).status, 403);
  assert.equal((await get(privatePath)).status, 404);
}
const directory = await (await staffCall(customersPath + "?q=Other%20dog", {}, context)).json();
assert.deepEqual(directory.customers.map(({dog_photos,...customer})=>customer), [{id:1,name:"Fixture owner",dog_count:2}]);
const directoryPhotos=JSON.parse(directory.customers[0].dog_photos);
assert.deepEqual(directoryPhotos.map(dog=>dog.id).sort(),[1,2]);
assert.ok(directoryPhotos.every(dog=>dog.customer_id===1 && [0,1].includes(dog.has_photo)));
assert.ok(directoryPhotos.every(dog=>Object.keys(dog).sort().join(',')==='customer_id,has_photo,id,name'));
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
  assert.deepEqual(JSON.parse(result.bookings[0].dog_photos).map(dog=>dog.id).sort(),[2]);
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
const renderedDocuments = [];
const staffWithRenderer = {...staffEnv,BROWSER:{
  async quickAction(action, options) {
    renderedDocuments.push({action,options});
    return action === "pdf"
      ? new Response("%PDF-test",{headers:{"Content-Type":"application/pdf"}})
      : new Response(new Uint8Array([137,80,78,71]),{headers:{"Content-Type":"image/png"}});
  },
}};
const documentRequest = (path,options,identity=context) =>
  staff.fetch(new Request("https://staff.example.test"+path,options),staffWithRenderer,identity);
const bookingDocument = "/api/documents/booking/1";
assert.equal((await staffCall(bookingDocument+".html")).status,403);
assert.equal((await get(bookingDocument+".html")).status,404);
assert.equal((await staffCall(bookingDocument+".pdf",{},context)).status,503);
assert.equal((await documentRequest(bookingDocument+".pdf",{headers:{"Sec-Fetch-Site":"cross-site"}})).status,403);
const previewDocument = await documentRequest(bookingDocument+".html?lang=th");
assert.equal(previewDocument.status,200);
assert.match(previewDocument.headers.get("Content-Security-Policy"),/default-src 'none'/);
const previewBookingHtml = await previewDocument.text();
assert.match(previewBookingHtml,/ใบยืนยันการจอง/);
assert.match(previewBookingHtml,/AB12CD/);
assert.match(previewBookingHtml,/081-426-6241/);
assert.match(previewBookingHtml,/data:image\/jpeg;base64,/);
assert.match(previewBookingHtml,/จำนวนวัน/);
const bookingImage = await documentRequest(bookingDocument+".png?lang=en");
assert.equal(bookingImage.headers.get("Content-Type"),"image/png");
assert.match(bookingImage.headers.get("Content-Disposition"),/little-paws-booking-1-en\.png/);
assert.equal(renderedDocuments.at(-1).action,"screenshot");
assert.match(renderedDocuments.at(-1).options.html,/Booking confirmation/);
const originalDepositId = detail.payments[0].id;
const receiptDocument = await documentRequest("/api/documents/deposit/1/"+originalDepositId+".pdf?lang=en");
assert.equal(receiptDocument.status,200);
assert.equal(receiptDocument.headers.get("Cache-Control"),"private, no-store");
assert.match(renderedDocuments.at(-1).options.html,/Deposit receipt/);
assert.match(renderedDocuments.at(-1).options.html,/Remaining balance for check-in/);
assert.match(renderedDocuments.at(-1).options.html,/฿850\.00/);
assert.equal((await documentRequest("/api/documents/deposit/2/"+originalDepositId+".pdf")).status,404);
const untrustedBooking = await (await documentRequest("/api/documents/booking/3.html?lang=en")).text();
assert.doesNotMatch(untrustedBooking, /<script>/);
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
const staffHtml = await staffPage.text();
assert.match(staffHtml,/ยอดค้างชำระ/);
assert.doesNotThrow(() => new Script(staffHtml.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]));
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
assert.deepEqual(JSON.parse(current.stays[0].dog_photos).map(dog=>dog.id).sort(),[1,2]);
const checkoutPath = "/api/stays/1/check-out";
const checkoutOptions = {method:"POST",headers:{Origin:"https://staff.example.test"}};
assert.equal((await staffCall(checkoutPath, checkoutOptions)).status,403);
assert.equal((await staffCall(checkoutPath, checkoutOptions, context)).status,200);
const checkoutTime = sqlite.prepare("SELECT actual_checkout_at FROM stays WHERE id=1").get().actual_checkout_at;
assert.ok(Number.isFinite(Date.parse(checkoutTime)));
assert.equal((await staffCall(checkoutPath, checkoutOptions, context)).status,200);
assert.equal(sqlite.prepare("SELECT actual_checkout_at FROM stays WHERE id=1").get().actual_checkout_at,checkoutTime);
assert.deepEqual((await (await staffCall("/api/stays/current", {}, context)).json()).stays, []);
const checkInPath = "/api/bookings/1/check-in";
const termsPath = checkInPath + "?lang=en";
assert.equal((await staffCall(termsPath)).status,403);
assert.equal((await get(termsPath)).status,404);
const savedTerms = await (await staffCall(termsPath,{},context)).json();
assert.equal(savedTerms.language,"en");
assert.equal(savedTerms.terms.sections.length,3);
sqlite.exec(`INSERT INTO coupons (code,kind,value,minimum_cents,expires_on,max_uses) VALUES
  ('000001','percent',1000,100000,'2099-12-31',1),
  ('000002','fixed',2500,20000,'2099-12-31',1),
  ('000003','percent',1000,150000,'2099-12-31',1),
  ('000004','fixed',2500,0,'2020-01-01',1),
  ('000005','fixed',100000,0,'2099-12-31',1)`);
const couponPath = "/api/stays/check-in/coupon";
assert.equal((await staffCall(couponPath,customerWrite("POST",{bookingId:1,code:"000001"}))).status,403);
const couponForBooking = (code) => staffCall(couponPath,customerWrite("POST",{bookingId:1,code}),context);
assert.equal((await (await couponForBooking("000003")).json()).status,"coupon_minimum");
assert.equal((await (await couponForBooking("000004")).json()).status,"coupon_unavailable");
assert.equal((await (await couponForBooking("000005")).json()).status,"coupon_exceeds");
const quote = await (await couponForBooking("000001")).json();
assert.deepEqual(quote,{status:"ready",discount_cents:12000,total_cents:108000,balance_cents:48000});
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM coupon_uses").get().count,0);
const checkIn = {language:"en",version:savedTerms.version,accepted:true,signature:[[[10,10],[30,20]]],
  revision:null,arrivalDay:"2026-01-10",arrivalTime:"09:15",pickupTime:"17:00",expectedBalance:48000,couponCode:"000001",
  amountCents:38000,paymentDate:"2026-01-10",receivedTime:"09:21",key:"8".repeat(32),
  intake:{food_packed:"1",food:"อาหารเม็ด",treats_packed:"1",supplies:"ไม่เลือก",exam_eyes:"normal",
    exam_ears:"abnormal",health_note:"ตรวจหูอีกครั้ง",behavior:"friendly",service_type:"malicious override"}};
assert.equal((await staffCall(checkInPath,customerWrite("POST",checkIn))).status,403);
assert.equal((await staffCall(checkInPath,customerWrite("POST",checkIn,"https://other.example.test"),context)).status,403);
assert.equal((await staffCall(checkInPath,customerWrite("POST",{...checkIn,accepted:false}),context)).status,422);
assert.equal((await staffCall(checkInPath,customerWrite("POST",{...checkIn,signature:[[[10,10],[11,11]]]}),context)).status,422);
assert.equal((await staffCall(checkInPath,customerWrite("POST",{...checkIn,version:"old"}),context)).status,422);
assert.equal((await staffCall(checkInPath,customerWrite("POST",{...checkIn,expectedBalance:60001}),context)).status,409);
assert.equal(sqlite.prepare("SELECT stay_id FROM appointments WHERE id=1").get().stay_id,null);
assert.equal((await staffCall(checkInPath,customerWrite("POST",{
  ...checkIn,intake:{exam_eyes:"yes"},
}),context)).status,400);
assert.equal(sqlite.prepare("SELECT stay_id FROM appointments WHERE id=1").get().stay_id,null);
const checkedIn = await Promise.all([0,1].map(() => staffCall(checkInPath,customerWrite("POST",checkIn),context)));
assert.deepEqual(checkedIn.map((response) => response.status).sort(),[200,201]);
const [firstCheckIn,secondCheckIn] = await Promise.all(checkedIn.map((response) => response.json()));
assert.equal(firstCheckIn.stayId,secondCheckIn.stayId);
const staySummaryPath = "/api/stays/" + firstCheckIn.stayId;
assert.equal((await staffCall(staySummaryPath)).status,403);
assert.equal((await get(staySummaryPath)).status,404);
const staySummary = await (await staffCall(staySummaryPath,{},context)).json();
assert.equal(staySummary.booking_number,"AB12CD");
assert.match(staySummary.stay_number,/^[A-Z0-9]{6}$/);
assert.equal(staySummary.actual_checkin_at,"2026-01-10T09:15:00+07:00");
assert.equal(staySummary.dogs[0].name,"Other dog");
assert.equal(staySummary.payments.filter((payment) => payment.payment_type === "deposit").length,2);
assert.equal(staySummary.payments.filter((payment) => payment.payment_type === "checkin").length,1);
assert.equal(staySummary.payments.at(-1).received_time,"09:21");
assert.equal(staySummary.due_cents,10000);
assert.equal(staySummary.total_cents,108000);
assert.equal(staySummary.coupon_code,"000001");
assert.equal(staySummary.coupon_discount_cents,12000);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM coupon_uses").get().count,1);
assert.deepEqual(staySummary.intake,{food_packed:"1",food:"อาหารเม็ด",treats_packed:"1",exam_eyes:"normal",
  exam_ears:"abnormal",health_note:"ตรวจหูอีกครั้ง",behavior:"friendly",service_type:"overnight",
  arrival_time:"09:15",pickup_time:"17:00"});
assert.equal(staySummary.consent.signed_language,"en");
assert.deepEqual(JSON.parse(staySummary.consent.signature),checkIn.signature);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM stay_consents WHERE stay_id=?").get(firstCheckIn.stayId).count,1);
const stayDoc = await documentRequest("/api/documents/stay/"+firstCheckIn.stayId+".pdf?lang=en");
assert.equal(stayDoc.status,200);
const stayDocHtml = renderedDocuments.at(-1).options.html;
assert.match(stayDocHtml,/Boarding summary/);
assert.match(stayDocHtml,new RegExp(staySummary.stay_number));
assert.match(stayDocHtml,/AB12CD/);
assert.match(stayDocHtml,/Accepted and signed/);
assert.match(stayDocHtml,/<polyline points="10,10 30,20"/);
assert.match(stayDocHtml,/รับทราบ|Boarding terms|Terms and Conditions/i);
assert.match(stayDocHtml,new RegExp(Buffer.from("fixture-qr-original").toString("base64")));
assert.equal((await staffCall("/api/stays/" + firstCheckIn.stayId + "/check-out",checkoutOptions,context)).status,200);
const finalPayment = customerWrite("POST",{amountCents:10000,paymentDate:"2026-01-13",receivedTime:"18:35",key:"7".repeat(32)});
assert.equal((await staffCall(staySummaryPath+"/payments",finalPayment,context)).status,201);
assert.equal((await staffCall(staySummaryPath+"/payments",finalPayment,context)).status,200);
const paidSummary = await (await staffCall(staySummaryPath,{},context)).json();
assert.equal(paidSummary.status,"completed");
assert.equal(paidSummary.due_cents,0);
assert.equal(paidSummary.payments.filter((payment) => payment.payment_type === "additional").length,1);
assert.equal(paidSummary.payments.at(-1).received_time,"18:35");
const directPath = "/api/stays/check-in";
const directPreviewPath = directPath + "/preview";
const draft = {...bookingForm,service:"daycare",checkin:"2025-12-22",checkout:"2025-12-22",quantity100:100,
  dogs:[{id:2,rate:25000}],discountCents:0,key:"6".repeat(32)};
const bookingCount = sqlite.prepare("SELECT count(*) AS count FROM appointments").get().count;
assert.equal((await staffCall(directPreviewPath,customerWrite("POST",draft))).status,403);
assert.equal((await staffCall(directPreviewPath,customerWrite("POST",{...draft,customerId:3}),context)).status,400);
assert.equal((await staffCall(directPreviewPath,customerWrite("POST",{...draft,dogs:[{id:2,rate:null}]}),context)).status,400);
const preview = await (await staffCall(directPreviewPath,customerWrite("POST",draft),context)).json();
assert.equal(preview.total_cents,25000);
const directConsent = await (await staffCall(directPath+"?lang=th",{},context)).json();
const directForm = {...checkIn,draft,key:draft.key,language:"th",version:directConsent.version,expectedBalance:25000,couponCode:undefined,
  amountCents:25000,arrivalDay:draft.checkin,paymentDate:draft.checkin};
assert.equal((await get(directPath)).status,404);
assert.equal((await staffCall(directPath,customerWrite("POST",{...directForm,amountCents:25001}),context)).status,400);
assert.equal((await staffCall(directPath,customerWrite("POST",{...directForm,expectedBalance:26000}),context)).status,400);
const directResults = await Promise.all([0,1].map(() => staffCall(directPath,customerWrite("POST",directForm),context)));
assert.deepEqual(directResults.map((result) => result.status).sort(),[200,201]);
const [walkIn,repeatedWalkIn] = await Promise.all(directResults.map((response) => response.json()));
assert.equal(walkIn.stayId,repeatedWalkIn.stayId);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM appointments").get().count,bookingCount);
const directStay = await (await staffCall("/api/stays/"+walkIn.stayId,{},context)).json();
assert.equal(directStay.booking_number,null);
assert.equal(directStay.service_type,"daycare");
assert.equal(directStay.due_cents,0);
assert.equal(directStay.payments.length,1);
assert.equal(directStay.consent.signed_language,"th");
const duplicateDates = await (await staffCall(directPath,customerWrite("POST",{...directForm,key:"3".repeat(32)}),context)).json();
assert.deepEqual(duplicateDates.warnings,["overlap"]);
assert.equal((await staffCall("/api/stays/"+walkIn.stayId+"/check-out",checkoutOptions,context)).status,200);
const fixedQuote = await (await staffCall(couponPath,customerWrite("POST",{draft,code:"000002"}),context)).json();
assert.deepEqual(fixedQuote,{status:"ready",discount_cents:2500,total_cents:22500,balance_cents:22500});
assert.equal((await (await staffCall(couponPath,customerWrite("POST",{draft,code:"000001"}),context)).json()).status,"coupon_unavailable");
const couponRace = await Promise.all(["2025-10-22","2025-11-22"].map((date,index) => {
  const request = {...directForm,draft:{...draft,checkin:date,checkout:date},arrivalDay:date,paymentDate:date,
    amountCents:22500,expectedBalance:22500,couponCode:"000002",key:(index ? "b" : "c").repeat(32)};
  return staffCall(directPath,customerWrite("POST",request),context);
}));
assert.deepEqual(couponRace.map((result) => result.status).sort(),[201,409]);
assert.equal((await couponRace.find((result) => result.status === 409).json()).status,"coupon_unavailable");
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM coupon_uses").get().count,2);
const couponAdmin = "/api/coupons";
const newCoupon = {kind:"percent",value:1250,minimumCents:10000,expiresOn:"2099-12-31",maxUses:4,key:"a".repeat(32)};
assert.equal((await get(couponAdmin)).status,404);
assert.equal((await staffCall(couponAdmin,{},context)).status,200);
assert.equal((await staffCall(couponAdmin,customerWrite("POST",newCoupon,"https://other.example.test"),context)).status,403);
sqlite.exec("UPDATE app_users SET is_admin=0 WHERE id=1");
assert.equal((await staffCall(reportPath,{},context)).status,403);
assert.equal((await staffCall(reportPath.replace("finance?","finance.xlsx?"),{},context)).status,403);
assert.equal((await staffCall(couponAdmin,{},context)).status,403);
assert.equal((await staffCall(couponAdmin,customerWrite("POST",newCoupon),context)).status,403);
const nonAdminPage = await (await staffCall("/",{},context)).text();
assert.doesNotMatch(nonAdminPage,/data-mode="coupons"/);
assert.doesNotMatch(nonAdminPage,/data-mode="settings"/);
assert.equal((await staffCall("/api/settings",{},context)).status,403);
assert.equal((await staffCall("/api/settings",customerWrite("PUT",{section:"theme",theme:"japan"}),context)).status,403);
sqlite.exec("UPDATE app_users SET is_admin=1 WHERE id=1");
assert.equal((await staffCall(couponAdmin,customerWrite("POST",{...newCoupon,value:10001}),context)).status,400);
assert.equal((await staffCall(couponAdmin,customerWrite("POST",{...newCoupon,expiresOn:"2020-12-31"}),context)).status,400);
const couponCreation = await Promise.all([0,1].map(() =>
  staffCall(couponAdmin,customerWrite("POST",newCoupon),context)));
assert.deepEqual(couponCreation.map((result) => result.status).sort(),[200,201]);
const [addedCoupon,duplicateCoupon] = await Promise.all(couponCreation.map((result) => result.json()));
assert.equal(addedCoupon.id,duplicateCoupon.id);
const couponDetailPath = couponAdmin + "/" + addedCoupon.id;
const couponDetail = await (await staffCall(couponDetailPath,{},context)).json();
assert.match(couponDetail.code,/^[0-9]{6}$/);
assert.equal(couponDetail.minimum_cents,10000);
assert.equal(couponDetail.qr.length,21);
assert.ok(couponDetail.qr.every((row) => /^[01]{21}$/.test(row)));
const activeCoupons = await (await staffCall(couponAdmin+"?status=active",{},context)).json();
assert.ok(activeCoupons.coupons.some((coupon) => coupon.id === addedCoupon.id));
assert.match(activeCoupons.defaultExpiry,/^\d{4}-\d{2}-\d{2}$/);
for (const id of [1,2]) {
  sqlite.prepare("INSERT INTO coupon_uses(stay_id,coupon_id,discount_cents) VALUES(?,?,?)").run(id,addedCoupon.id,200);
}
const usedCoupons = await (await staffCall(couponAdmin+"?status=used",{},context)).json();
assert.equal(usedCoupons.coupons.find((coupon) => coupon.id === addedCoupon.id).used,2);
const expiredCoupons = await (await staffCall(couponAdmin+"?status=expired",{},context)).json();
assert.ok(expiredCoupons.coupons.some((coupon) => coupon.code === "000004"));
assert.equal((await staffCall(couponDetailPath,customerWrite("PUT",{...newCoupon,maxUses:1}),context)).status,409);
assert.equal((await staffCall(couponDetailPath,customerWrite("PUT",{...newCoupon,kind:"fixed",value:2500,maxUses:3}),context)).status,200);
const editedCoupon = await (await staffCall(couponDetailPath,{},context)).json();
assert.equal(editedCoupon.code,couponDetail.code);
assert.equal(editedCoupon.kind,"fixed");
assert.equal((await staffCall(couponDetailPath,customerWrite("DELETE"),context)).status,200);
assert.equal((await staffCall(couponDetailPath,{},context)).status,404);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM coupon_uses WHERE coupon_id=?").get(addedCoupon.id).count,2);
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
const settingsPath = "/api/settings";
const readSettings = async () => (await staffCall(settingsPath,{},context)).json();
const writeSettings = (form,origin) => staffCall(settingsPath,customerWrite("PUT",form,origin),context);
assert.equal((await get(settingsPath)).status,404);
assert.equal((await staffCall(settingsPath)).status,403);
let settings = await readSettings();
assert.equal(settings.rates.overnight.small,400);
assert.equal(settings.rates.monthly.small,null);
assert.equal(settings.careLinkHours,48);
assert.equal((await writeSettings({section:"theme",theme:"japan",revisions:settings.revisions},
  "https://other.example.test")).status,403);
const oldRate = sqlite.prepare("SELECT nightly_rate_cents FROM appointment_dogs WHERE appointment_id=1").get().nightly_rate_cents;
const ratesCents = Object.fromEntries(Object.entries(settings.rates).map(([service,sizes]) =>
  [service,Object.fromEntries(Object.entries(sizes).map(([size,price]) => [size,price === null ? null : Math.round(price*100)]))]));
ratesCents.overnight.small = 42550;
ratesCents.monthly.medium = 850000;
assert.equal((await writeSettings({section:"rates",ratesCents,revisions:settings.revisions})).status,200);
assert.equal(sqlite.prepare("SELECT nightly_rate_cents FROM appointment_dogs WHERE appointment_id=1").get().nightly_rate_cents,oldRate);
const newRates = await (await staffCall("/api/bookings/rates",{},context)).json();
assert.equal(newRates.overnight.small,425.50);
assert.equal(newRates.monthly.medium,8500);
assert.equal(newRates.monthly.small,null);
assert.equal((await writeSettings({section:"capacity",capacity:5,careLinkHours:0,revisions:settings.revisions})).status,200);
assert.equal((await writeSettings({section:"capacity",capacity:7,careLinkHours:72,revisions:settings.revisions})).status,409);
settings = await readSettings();
assert.equal(settings.capacity,5);
assert.equal(settings.careLinkHours,0);
assert.equal((await writeSettings({section:"capacity",capacity:4,careLinkHours:24,
  revisions:{...settings.revisions,care_link_hours:null}})).status,409);
assert.equal((await readSettings()).capacity,5);
assert.equal((await writeSettings({section:"capacity",capacity:10001,careLinkHours:24,revisions:settings.revisions})).status,400);
assert.equal((await writeSettings({section:"theme",theme:"japan",revisions:settings.revisions})).status,200);
assert.match(await (await staffCall("/",{},context)).text(),/data-theme="japan"/);
assert.equal((await writeSettings({section:"care",action:"add",name:"เดินเล่น",revisions:settings.revisions})).status,400);
assert.equal((await writeSettings({section:"care",action:"add",name:"ถ่ายรูป",revisions:settings.revisions})).status,200);
const timelineWithNewOption = await (await staffCall(staffCarePath,{},context)).json();
assert.equal(timelineWithNewOption.options["activity:ถ่ายรูป"],"ถ่ายรูป");
assert.equal(timelineWithNewOption.expiry_hours,0);
settings = await readSettings();
assert.equal((await writeSettings({section:"care",action:"remove",name:"ถ่ายรูป",revisions:settings.revisions})).status,200);
assert.ok(!("activity:ถ่ายรูป" in (await (await staffCall(staffCarePath,{},context)).json()).options));
// Templates share admin authorization and optimistic revisions; event text stays untouched.
settings=await readSettings();
assert.equal(settings.templates.food.length,10);
const noteBefore=sqlite.prepare("SELECT note FROM care_events WHERE id=1").get()?.note;
const templateDraft={...settings.templates,food:["Warm test message 🩷"]};
assert.equal((await writeSettings({section:"templates",templates:templateDraft,revisions:settings.revisions})).status,200);
assert.equal((await writeSettings({section:"templates",templates:templateDraft,revisions:settings.revisions})).status,409);
assert.deepEqual((await (await staffCall(staffCarePath,{},context)).json()).templates.food,["Warm test message 🩷"]);
assert.equal(sqlite.prepare("SELECT note FROM care_events WHERE id=1").get()?.note,noteBefore);
settings=await readSettings();
assert.equal((await writeSettings({section:"templates",templates:{food:["x".repeat(501)]},revisions:settings.revisions})).status,400);
const holidaysPath = settingsPath + "/holidays";
const holiday = {name:"วันหยุดทดสอบ",starts_on:"2030-01-07",ends_on:"2030-01-09"};
assert.equal((await staffCall(holidaysPath,customerWrite("POST",{...holiday,ends_on:"2030-01-06"}),context)).status,400);
for (let retry=0; retry<2; retry++) {
  assert.equal((await staffCall(holidaysPath,customerWrite("POST",holiday),context)).status,200);
}
settings = await readSettings();
assert.equal(settings.holidays.filter((item) => item.name === holiday.name).length,1);
const entry = settings.holidays.find((item) => item.name === holiday.name);
const holidayPath = holidaysPath + "/" + entry.id;
assert.equal((await staffCall(holidayPath,customerWrite("PUT",{...holiday,ends_on:"2030-01-10",previous:entry}),context)).status,200);
assert.equal((await staffCall(holidayPath,customerWrite("DELETE",{previous:entry}),context)).status,409);
const holidayCalendar = await (await staffCall("/api/bookings/calendar?start=2030-01-10&end=2030-01-11",{},context)).json();
assert.equal(holidayCalendar.holidays.find((item) => item.id === entry.id).ends_on,"2030-01-10");
assert.equal((await staffCall(holidayPath,customerWrite("DELETE",{previous:{...entry,ends_on:"2030-01-10"}}),context)).status,200);
assert.equal((await readSettings()).holidays.some((item) => item.id === entry.id),false);
assert.equal((await staffCall(customerPath, customerWrite("DELETE"), context)).status, 200);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM stays WHERE customer_id=1").get().count, 5);
assert.equal(sqlite.prepare("SELECT count(*) AS count FROM dogs WHERE customer_id=1").get().count, 3);
assert.equal((await staffCall(customerDogPhoto, {}, context)).status, 404);
const historyPath = "/api/stays/history";
const historyPeriod = historyPath + "?start=2026-01-02&end=2026-01-02";
assert.equal((await get(historyPeriod)).status,404);
assert.equal((await staffCall(historyPeriod)).status,403);
assert.equal((await staffCall(historyPeriod+"&status=cancelled",{},context)).status,400);
assert.equal((await staffCall(historyPeriod+"&before=invalid",{},context)).status,400);
assert.equal((await staffCall(historyPath+"?start=2026-02-30&end=2026-03-01",{},context)).status,400);
sqlite.exec("UPDATE stays SET stay_number='QZ9T1B' WHERE id=1");
sqlite.exec("UPDATE stays SET status='cancelled' WHERE id=2");
const readHistory = async (path = historyPeriod) => (await staffCall(path,{},context)).json();
const stayList = await readHistory();
assert.deepEqual(JSON.parse(stayList.stays.find(stay=>stay.id===1).dog_photos).map(dog=>dog.id).sort(),[1,2]);
assert.ok(stayList.stays.some((stay) => stay.id === 1 && stay.due_cents > 0));
assert.ok(!stayList.stays.some((stay) => stay.id === 2));
for (const q of ["qz9t1b","fixture owner","other dog"]) {
  assert.ok((await readHistory(historyPeriod+"&status=completed&q="+encodeURIComponent(q))).stays.some((stay) => stay.id === 1));
}
assert.ok(!(await readHistory(historyPeriod+"&status=checked_in")).stays.some((stay) => stay.id === 1));
assert.equal((await readHistory(historyPeriod+"&q=nonmatching")).stays.length,0);
sqlite.exec(`WITH RECURSIVE rows(id) AS (SELECT 1000 UNION ALL SELECT id+1 FROM rows WHERE id<1025)
  INSERT INTO stays(id,customer_id,checkin,checkout,status) SELECT id,1,'2000-01-01','2000-01-02','completed' FROM rows`);
const pagination = historyPath+"?start=2000-01-01&end=2000-01-02";
const firstHistoryPage = await readHistory(pagination);
assert.equal(firstHistoryPage.stays.length,25);
assert.equal(firstHistoryPage.stays[0].id,1025);
assert.equal(firstHistoryPage.nextBefore,"2000-01-01:1001");
const secondHistoryPage = await readHistory(pagination+"&before="+encodeURIComponent(firstHistoryPage.nextBefore));
assert.deepEqual(secondHistoryPage.stays.map((stay) => stay.id),[1000]);
assert.equal(secondHistoryPage.nextBefore,null);
sqlite.exec(`INSERT INTO stays(id,customer_id,checkin,checkout,status,agreed_total,payment_tracking)
  VALUES(2000,1,'2026-01-01','2026-01-03','checked_in',1000,1),
        (2001,1,'2026-01-01','2026-01-03','completed',1000,1)`);
sqlite.exec(`INSERT INTO transactions
  (id,occurred_on,kind,category,description,amount,stay_id,payment_type,payment_key,received_time,auto_stay)
  VALUES (2000,'2026-01-02','income','boarding','legacy no payment key',300,2000,'checkin',NULL,NULL,0),
    (2001,'2026-01-02','income','boarding','normal deposit',400,2000,'deposit','new-key','09:45',0),
    (2002,'2026-01-02','income','boarding','manual income',500,2000,'',NULL,NULL,0),
    (2003,'2026-01-02','income','boarding','automatic legacy income',800,2000,'',NULL,NULL,1),
    (2004,'2026-01-02','income','boarding','completed payment',200,2001,'checkin',NULL,NULL,0)`);
sqlite.exec("INSERT INTO stay_dogs(stay_id,dog_id) VALUES(2000,1)");
sqlite.prepare("INSERT INTO care_share_links(stay_id,dog_id,token) VALUES(2000,1,?)").run("m".repeat(43));
const financialStay = "/api/stays/2000";
const removal = {requestKey:"d".repeat(32),reason:"ลงรายการซ้ำ",paymentKey:null,amountCents:30000,
  occurredOn:"2026-01-02",receivedTime:null,paymentType:"checkin"};
const removePayment = (form,path = financialStay+"/payments/2000",identity = context) =>
  staffCall(path,customerWrite("DELETE",form),identity);
const financialSummary = async () => (await staffCall(financialStay,{},context)).json();
assert.equal((await get(financialStay+"/payments/2000")).status,404);
assert.equal((await staffCall(financialStay+"/payments/2000",customerWrite("DELETE",removal))).status,403);
assert.equal((await removePayment({...removal,reason:" "})).status,400);
assert.equal((await removePayment({...removal,amountCents:100})).status,409);
assert.equal((await removePayment({...removal,amountCents:20000},"/api/stays/2001/payments/2004")).status,409);
assert.equal((await staffCall("/api/stays/2001/cancel",customerWrite("POST",{reason:"duplicate"}),context)).status,409);
const paymentRemoval = await Promise.all([removePayment(removal),removePayment(removal)]);
assert.ok(paymentRemoval.every((response) => response.status === 200));
const removedPayment = await financialSummary();
assert.equal(removedPayment.due_cents,60000);
assert.equal(removedPayment.payment_deletions.length,1);
assert.equal(removedPayment.payment_deletions[0].reason,"ลงรายการซ้ำ");
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM transactions WHERE id=2000").get().n,0);
assert.equal((await get(path("m")+"?day=all")).status,200);
const cancel = (reason) => staffCall(financialStay+"/cancel",customerWrite("POST",{reason}),context);
assert.equal((await cancel("")).status,400);
assert.equal((await cancel("ลูกค้ายกเลิก")).status,200);
assert.equal((await cancel("เขียนซ้ำ")).status,200);
assert.equal((await get(path("m")+"?day=all")).status,404);
const cancelled = await financialSummary();
assert.equal(cancelled.status,"cancelled");
assert.equal(cancelled.cancel_reason,"ลูกค้ายกเลิก");
assert.equal(cancelled.due_cents,0);
assert.equal(cancelled.payments.length,0);
assert.equal(cancelled.payment_deletions.length,2);
assert.equal(cancelled.refundable_cents,50000);
assert.equal(sqlite.prepare("SELECT amount FROM transactions WHERE id=2003").get().amount,0);
const recordRefund = (key,amountCents,reason = "คืนยอดจากรายการรับเงินจริง") =>
  staffCall(financialStay+"/refund",customerWrite("POST",{key,amountCents,reason,paymentDate:"2026-01-02",receivedTime:"10:40"}),context);
assert.equal((await recordRefund("a".repeat(32),50001)).status,422);
const refundRace = await Promise.all([recordRefund("a".repeat(32),30000),recordRefund("b".repeat(32),30000)]);
assert.deepEqual(refundRace.map(({status}) => status).sort(),[201,422]);
const successfulKey = refundRace[0].status === 201 ? "a".repeat(32) : "b".repeat(32);
assert.equal((await recordRefund(successfulKey,30000)).status,200);
const refundSummary = await financialSummary();
assert.equal(refundSummary.refundable_cents,20000);
assert.equal(refundSummary.refunds.length,1);
assert.equal(refundSummary.refunds[0].amount,300);
assert.equal(refundSummary.refunds[0].received_time,"10:40");
const ledgerPath = "/api/transactions";
const ledgerRange = ledgerPath+"?start=2026-01-01&end=2026-01-31&kind=expense";
const ledgerEntry = {occurredOn:"2026-01-02",kind:"expense",category:"ค่าน้ำไฟ",description:"รายการนำเข้าทดสอบ",
  amountCents:41775,customerId:null,stayId:null,merchant:"ร้านทดสอบ",paymentMethod:"",reference:"",note:"",
  revision:null,key:"a".repeat(32)};
assert.equal((await get(ledgerRange)).status,404);
assert.equal((await staffCall(ledgerRange)).status,403);
assert.equal((await staffCall(ledgerPath+"?start=2026-02-30",{},context)).status,400);
assert.equal((await staffCall(ledgerPath,customerWrite("POST",ledgerEntry,"https://other.example.test"),context)).status,403);
sqlite.exec(`INSERT INTO transactions(id,occurred_on,kind,category,description,amount,receipt)
  VALUES(2100,'2026-01-02','expense','อุปกรณ์','Imported fixture expense',417.75,'fixture.pdf')`);
const ledgerDetails = async (id) => (await staffCall(ledgerPath+"/"+id,{},context)).json();
const paymentsLocked = (await ledgerDetails(2004)).transaction;
assert.equal(paymentsLocked.managed,1);
assert.equal((await staffCall(ledgerPath+"/2004",customerWrite("DELETE",{revision:null}),context)).status,409);
assert.equal((await staffCall(ledgerPath+"/2100",customerWrite("PUT",ledgerEntry),context)).status,200);
const updatedLedger = (await ledgerDetails(2100)).transaction;
assert.equal(updatedLedger.category,"ค่าน้ำไฟ");
assert.equal(updatedLedger.amount_cents,41775);
assert.equal(updatedLedger.has_receipt,1);
assert.equal((await staffCall(ledgerPath+"/2100",customerWrite("PUT",ledgerEntry),context)).status,409);
assert.equal((await staffCall(ledgerPath+"/2100",customerWrite("DELETE",{revision:null}),context)).status,409);
const receiptBytes = "%PDF-1.4\nsynthetic ledger receipt";
const addLedgerWithReceipt = (type,bytes = receiptBytes) => {
  const body = new FormData();
  body.set("entry",JSON.stringify(ledgerEntry));
  body.set("receipt",new File([bytes],"fixture."+type,{type:"application/pdf"}));
  return staffCall(ledgerPath,{method:"POST",headers:{Origin:"https://staff.example.test"},body},context);
};
assert.equal((await addLedgerWithReceipt("pdf","this is not a PDF")).status,400);
const ledgerCreates = await Promise.all([addLedgerWithReceipt("pdf"),addLedgerWithReceipt("pdf")]);
assert.deepEqual(ledgerCreates.map((response) => response.status).sort(),[200,201]);
const [createdLedger,replayedLedger] = await Promise.all(ledgerCreates.map((response) => response.json()));
assert.equal(createdLedger.id,replayedLedger.id);
const uploadedReceipt = await staffCall("/api/receipts/"+createdLedger.id,{},context);
assert.equal(await uploadedReceipt.text(),receiptBytes);
const ledgerPage = await (await staffCall(ledgerRange,{},context)).json();
assert.ok(ledgerPage.transactions.every((row) => row.kind === "expense"));
assert.ok(ledgerPage.transactions.some((row) => row.id === createdLedger.id));
const createdRevision = (await ledgerDetails(createdLedger.id)).transaction.revision;
assert.equal((await staffCall(ledgerPath+"/"+createdLedger.id,customerWrite("DELETE",{revision:createdRevision}),context)).status,200);
assert.equal((await staffCall("/api/receipts/"+createdLedger.id,{},context)).status,404);
assert.equal((await staffCall("/api/receipts/2100",{},context)).status,200);
await testStaffUsers({sqlite,env,staffCall,context});
await testStayEdits({sqlite,staffCall,context});
await testCloudBackup({sqlite,staffCall,context});
sqlite.exec("UPDATE app_users SET active=0 WHERE id=1");
assert.equal((await staffCall(paymentPath, staffOptions, context)).status, 403);
assert.equal(await receiveStayPayment(env.DB, 1, {...payment, key: "5".repeat(32)}, actor, now), "forbidden");
sqlite.close();
console.log("Migration, Worker timeline and payment operation smoke checks passed");
