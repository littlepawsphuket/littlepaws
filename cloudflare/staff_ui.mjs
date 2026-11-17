const css = `
  body{font:1rem/1.5 "Sukhumvit Set",system-ui,sans-serif;background:#f2f7f3;color:#203c30;margin:0}
  main{margin:auto;max-width:52rem;padding:1rem}h1{margin:.2rem 0 1rem}
  article{background:#fff;border:1px solid #c8ded4;border-radius:1rem;margin:.6rem 0;padding:1rem}
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
    <script nonce="${nonce}">(${main.toString()})()</script></html>`, {
    headers: {
      "Content-Type":"text/html; charset=utf-8", "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
