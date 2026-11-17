const css = `
  body{font:1rem/1.5 "Sukhumvit Set",system-ui,sans-serif;background:#f2f7f3;color:#203c30;margin:0}
  main{margin:auto;max-width:52rem;padding:1rem}h1{margin:.2rem 0 1rem}
  article{background:#fff;border:1px solid #c8ded4;border-radius:1rem;margin:.6rem 0;padding:1rem}
  dialog{width:min(34rem,calc(100% - 4rem));max-height:80vh;padding:1rem;border:1px solid #a7cbb9;border-radius:1rem;color:inherit}
  dialog::backdrop{background:#203c3066}
  h2,p{margin:.15rem 0 .6rem}form{display:flex;flex-wrap:wrap;align-items:end;gap:.7rem}
  label{display:grid;gap:.2rem}input,button{font:inherit;padding:.55rem .7rem;border:1px solid #a7cbb9;border-radius:.6rem}
  button{background:#155747;color:#fff;cursor:pointer}button:disabled{opacity:.65} [hidden]{display:none}
`;

function main() {
  const results = document.getElementById("stays");
  const message = document.getElementById("message");
  const more = document.getElementById("more");
  const qr = document.getElementById("payment-qr");
  fetch(qr.href, {method:"HEAD"}).then((response) => {
    qr.hidden = !response.ok || !response.headers.get("Content-Type")?.startsWith("image/jpeg");
  }).catch(() => {});
  const bookingSearch = document.getElementById("booking-search");
  const bookingQuery = document.getElementById("booking-query");
  let activeBookingQuery = "";
  let cursor = null;
  let requestNumber = 0;
  let selected = "outstanding";
  const modes = document.querySelectorAll("[data-mode]");
  const baht = new Intl.NumberFormat("th-TH", {style:"currency", currency:"THB"});
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Bangkok",
    year:"numeric", month:"2-digit", day:"2-digit"});
  const statuses = {booked:"จอง", checked_in:"เข้าพัก", completed:"กลับบ้านแล้ว"};
  const errors = {invalid:"กรุณาตรวจยอดและวันที่", forbidden:"สิทธิ์บัญชีถูกยกเลิก",
    balance_exceeded:"ยอดเกินยอดค้างหรือรายการถูกยกเลิก", not_found:"ไม่พบรายการเข้าพัก"};
  const node = (tag, text) => Object.assign(document.createElement(tag), {textContent: text});
  const key = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");

  async function load(reset = false) {
    const requestId = ++requestNumber;
    if (reset) {
      cursor = null;
      results.replaceChildren();
    }
    more.disabled = true;
    try {
      const bookings = selected === "bookings";
      const url = bookings
        ? "/api/bookings/pending?" + new URLSearchParams({after:cursor || 0, q:activeBookingQuery})
        : "/api/stays/" + selected + (cursor ? "?before=" + cursor : "");
      const response = await fetch(url);
      if (!response.ok) throw Error();
      const data = await response.json();
      if (requestId !== requestNumber) return;
      if (bookings) {
        cursor = data.nextAfter;
        for (const booking of data.bookings) results.append(bookingCard(booking));
      } else {
        cursor = data.nextBefore;
        for (const stay of data.stays) results.append(card(stay));
      }
      if (!results.childElementCount) results.append(node("p", {
        bookings:"ไม่พบการจองที่รอเช็กอิน", current:"ไม่มีสุนัขที่กำลังเข้าพัก", outstanding:"ไม่มียอดค้างชำระ",
      }[selected]));
      more.hidden = cursor === null;
    } catch {
      if (requestId !== requestNumber) return;
      message.textContent = "โหลดรายการไม่ได้ กรุณาลองใหม่";
      more.hidden = false;
    } finally {
      if (requestId === requestNumber) more.disabled = false;
    }
  }

  const bookingDate = new Intl.DateTimeFormat("th-TH", {dateStyle:"medium", timeZone:"UTC"});
  const bookingDialog = document.getElementById("booking-detail");
  const bookingContent = document.getElementById("booking-content");
  const services = {overnight:["ฝากค้างคืน","คืน"], daycare:["ฝากระหว่างวัน","วัน"], monthly:["ฝากรายเดือน","เดือน"]};
  const paymentLabels = {deposit:"มัดจำ", checkin:"ชำระวันเข้าพัก", additional:"ชำระเพิ่มเติม"};
  const bangkokTime = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Bangkok", hour:"2-digit", minute:"2-digit", hourCycle:"h23",
  });
  const pendingDeposits = new Map();
  function depositForm(booking) {
    const savedAttempt = pendingDeposits.get(booking.id);
    const form = node("form");
    const amount = Object.assign(node("input"), {type:"number", step:"0.01", min:"0.01", required:true,
      value:savedAttempt ? String(savedAttempt.amountCents / 100) : ""});
    if (!savedAttempt && booking.balance_cents !== null) amount.max = (booking.balance_cents / 100).toFixed(2);
    const now = new Date();
    const date = Object.assign(node("input"), {type:"date", required:true,
      value:savedAttempt?.paymentDate || parts.format(now), max:parts.format(now)});
    const time = Object.assign(node("input"), {type:"time", required:true,
      value:savedAttempt?.receivedTime || bangkokTime.format(now)});
    for (const [label, input] of [["ยอดมัดจำ (บาท)", amount], ["วันที่รับมัดจำ", date], ["เวลารับมัดจำ", time]]) {
      const field = node("label", label);
      field.append(input);
      form.append(field);
    }
    const submit = node("button", "บันทึกรับมัดจำ");
    const status = node("p", savedAttempt ? "กรุณาส่งรายการเดิมอีกครั้งเพื่อยืนยันผล" : "");
    status.setAttribute("role", "status");
    form.append(submit, status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const entry = {amountCents:Math.round(Number(amount.value) * 100), paymentDate:date.value, receivedTime:time.value};
      const pending = pendingDeposits.get(booking.id);
      if (pending && Object.keys(entry).some((field) => pending[field] !== entry[field])) {
        status.textContent = "กรุณาส่งยอด วันที่ และเวลาเดิมเพื่อยืนยันผลครั้งก่อน";
        return;
      }
      const payload = pending || {...entry, key:key()};
      pendingDeposits.set(booking.id, payload);
      submit.disabled = true;
      try {
        const response = await fetch("/api/bookings/" + booking.id + "/deposits", {
          method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload),
        });
        if (response.ok) {
          pendingDeposits.delete(booking.id);
          if (submit.isConnected && bookingDialog.open) await showBooking(booking.id);
          if (selected === "bookings") await load(true);
          message.textContent = "บันทึกรับมัดจำแล้ว";
        } else {
          const result = await response.json();
          if (response.status < 500) pendingDeposits.delete(booking.id);
          status.textContent = {
            balance_exceeded:"ยอดมัดจำเกินยอดคงเหลือ", booking_closed:"รายการนี้ปิดรับมัดจำแล้ว",
          }[result.status] || "บันทึกไม่ได้ กรุณาตรวจสอบข้อมูล";
        }
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาส่งรายการเดิมอีกครั้ง";
      } finally {
        submit.disabled = false;
      }
    });
    return form;
  }

  let bookingRequest;
  async function showBooking(id) {
    bookingContent.replaceChildren(node("p", "กำลังโหลด…"));
    if (!bookingDialog.open) bookingDialog.showModal();
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    try {
      const response = await fetch("/api/bookings/" + id, {signal:controller.signal});
      if (!response.ok) throw Error();
      const data = await response.json();
      if (controller.signal.aborted) return;
      const [service, unit] = services[data.service_type] || [data.service_type, "วัน"];
      const state = data.stay_id ? "เช็กอินแล้ว" : data.status === "cancelled" ? "ยกเลิกแล้ว" : "รอเช็กอิน";
      const money = (cents) => baht.format(cents / 100);
      bookingContent.replaceChildren(
        node("h3", [data.booking_number || "#" + data.id, state].join(" · ")),
        node("p", [data.customer, data.contact].filter(Boolean).join(" · ")),
        node("p", [data.checkin, data.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")),
        node("p", service + " · " + data.charged_nights + " " + unit),
      );
      if (data.note) bookingContent.append(node("p", data.note));
      bookingContent.append(node("h3", "สุนัขที่จอง"));
      const dogs = node("ul");
      for (const dog of data.dogs) {
        dogs.append(node("li", dog.name + " · " + (dog.nightly_rate_cents === null
          ? "รอระบุราคา" : money(dog.nightly_rate_cents) + " / " + unit)));
      }
      bookingContent.append(dogs, node("h3", "การชำระเงิน"));
      if (!data.payments.length) bookingContent.append(node("p", "ยังไม่มีรายการชำระ"));
      for (const payment of data.payments) {
        const date = bookingDate.format(new Date(payment.occurred_on));
        bookingContent.append(node("p", [date, payment.received_time, paymentLabels[payment.payment_type] || payment.payment_type,
          money(payment.amount_cents)].filter(Boolean).join(" · ")));
      }
      bookingContent.append(node("p", "รับชำระแล้ว " + money(data.paid_cents)));
      if (data.balance_cents !== null) {
        bookingContent.append(node("p", "ยอดรวม " + money(data.total_cents)),
          node("p", "ยอดคงเหลือ " + money(data.balance_cents)));
      }
      if (pendingDeposits.has(data.id) || (!data.stay_id && data.status === "pending" && data.balance_cents !== 0)) {
        bookingContent.append(depositForm(data));
      }
    } catch {
      if (!controller.signal.aborted) bookingContent.replaceChildren(node("p", "โหลดข้อมูลการจองไม่ได้ กรุณาลองใหม่"));
    }
  }

  function bookingCard(booking) {
    const article = node("article");
    article.append(node("h2", booking.customer),
      node("p", [booking.booking_number || "#" + booking.id, booking.dogs].filter(Boolean).join(" · ")),
      node("p", [booking.checkin, booking.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")));
    if (booking.quote_pending) article.append(node("p", "รอระบุราคา"));
    else article.append(node("p", "ยอดรวม " + baht.format(booking.total_cents / 100)));
    article.append(node("p", "รับมัดจำ " + baht.format(booking.deposit_cents / 100)));
    if (!booking.quote_pending) {
      article.append(node("p", "ยอดคงเหลือ " + baht.format(Math.max(0, booking.total_cents - booking.deposit_cents) / 100)));
    }
    const details = node("button", "ดูการจอง");
    details.type = "button";
    details.addEventListener("click", () => showBooking(booking.id));
    article.append(details);
    return article;
  }

  function card(stay) {
    const article = node("article");
    article.append(node("h2", stay.customer),
      node("p", [stay.stay_number || "#" + stay.id, statuses[stay.status] || stay.status,
        baht.format(stay.due_cents / 100)].join(" · ")));
    if (stay.dogs) article.append(node("p", stay.dogs));
    if (stay.status === "checked_in") {
      const checkout = node("button", "เช็กเอาต์");
      checkout.type = "button";
      checkout.addEventListener("click", async () => {
        if (!confirm("ยืนยันเช็กเอาต์สุนัขทุกตัวในรายการนี้หรือไม่?")) return;
        checkout.disabled = true;
        try {
          const response = await fetch("/api/stays/" + stay.id + "/check-out", {method:"POST"});
          if (!response.ok) throw Error();
          message.textContent = "เช็กเอาต์แล้ว";
          await load(true);
        } catch {
          message.textContent = "เช็กเอาต์ไม่สำเร็จ กรุณาตรวจสถานะแล้วลองใหม่";
        } finally {
          checkout.disabled = false;
        }
      });
      article.append(checkout);
    }
    if (!stay.due_cents) return article;
    const form = node("form");
    const amount = Object.assign(node("input"), {type:"number", step:"0.01", min:"0.01",
      value:(stay.due_cents/100).toFixed(2), max:(stay.due_cents/100).toFixed(2), required:true});
    const date = Object.assign(node("input"), {type:"date", value:parts.format(new Date()),
      max:parts.format(new Date()), required:true});
    const amountLabel = node("label","ยอดรับชำระ (บาท)");
    const dateLabel = node("label","วันที่รับชำระ");
    amountLabel.append(amount);
    dateLabel.append(date);
    const button = node("button","บันทึกรับชำระ");
    form.append(amountLabel,dateLabel,button);
    let pending = null;
    form.addEventListener("submit",async (event) => {
      event.preventDefault();
      const submitted = {amountCents:Math.round(Number(amount.value)*100), paymentDate:date.value};
      if (pending && (pending.amountCents !== submitted.amountCents || pending.paymentDate !== submitted.paymentDate)) {
        message.textContent = "กรุณาลองส่งยอดและวันที่เดิมเพื่อยืนยันผลครั้งก่อน";
        return;
      }
      pending ??= {...submitted,key:key()};
      button.disabled = true;
      try {
        const response = await fetch("/api/stays/" + stay.id + "/payments",{
          method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(pending),
        });
        const data = await response.json();
        if (response.ok) {
          message.textContent = "บันทึกรับชำระแล้ว";
          await load(true);
        } else {
          if (response.status < 500) pending = null;
          message.textContent = errors[data.status] || "บันทึกไม่ได้ กรุณาตรวจสอบและลองใหม่";
        }
      } catch {
        message.textContent = "ยังยืนยันผลไม่ได้ กรุณาลองส่งรายการเดิมอีกครั้ง";
      } finally {
        button.disabled = false;
      }
    });
    article.append(form);
    return article;
  }

  for (const mode of modes) {
    mode.addEventListener("click", () => {
      if (selected === mode.dataset.mode) return;
      selected = mode.dataset.mode;
      bookingSearch.hidden = selected !== "bookings";
      for (const option of modes) option.setAttribute("aria-pressed", option === mode);
      message.textContent = "";
      load(true);
    });
  }
  bookingDialog.addEventListener("close", () => bookingRequest?.abort());
  document.getElementById("close-booking").addEventListener("click", () => bookingDialog.close());
  bookingSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    activeBookingQuery = bookingQuery.value;
    message.textContent = "";
    load(true);
  });
  more.addEventListener("click", () => load());
  load();
}

export function outstandingPage() {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(`<!doctype html><html lang="th"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ยอดค้างชำระ · Little Paws</title><style nonce="${nonce}">${css}</style>
    <main><p>Little Paws Homestay Phuket</p><h1>จัดการการเข้าพัก</h1>
    <div role="group" aria-label="มุมมองการเข้าพัก">
      <button type="button" data-mode="outstanding" aria-pressed="true">ยอดค้างชำระ</button>
      <button type="button" data-mode="current" aria-pressed="false">กำลังเข้าพัก</button>
      <button type="button" data-mode="bookings" aria-pressed="false">การจองที่รอเช็กอิน</button>
    </div>
    <form id="booking-search" hidden>
      <label>เลขจอง ชื่อลูกค้า หรือชื่อสุนัข <input type="search" maxlength="100" id="booking-query"></label>
      <button type="submit">ค้นหา</button>
    </form>
    <p><a id="payment-qr" href="/api/payment-qr.jpg" target="_blank" rel="noopener" hidden>เปิด QR สำหรับชำระเงิน</a></p>
    <p id="message" role="status"></p><div id="stays"></div>
    <button id="more" type="button" hidden>โหลดเพิ่มเติม</button></main>
    <dialog id="booking-detail" aria-labelledby="booking-title">
      <h2 id="booking-title">รายละเอียดการจอง</h2><button type="button" id="close-booking" autofocus>ปิด</button>
      <div id="booking-content" aria-live="polite"></div>
    </dialog>
    <script nonce="${nonce}">(${main.toString()})()</script></html>`, {
    headers: {
      "Content-Type":"text/html; charset=utf-8", "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
