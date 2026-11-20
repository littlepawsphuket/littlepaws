import {couponScreen} from "./coupon_ui.mjs";
import {settingsScreen} from "./settings_ui.mjs";
import {ledgerScreen} from "./ledger_ui.mjs";
import {ledgerKinds,ledgerCategories} from "./ledger.mjs";
import {themes,themeName} from "./system_settings.mjs";
import {intakeGroups} from "./stay_terms.mjs";
import {dashboardScreen} from "./dashboard_ui.mjs";
import {reportScreen} from "./report_ui.mjs";
import {applyStaffTheme,staffHeader,staffFooter,macStyleBridge} from "./staff_shell.mjs";
import {installCarePhotoViewer} from "../app/static/care-gallery.js";
import {workspaceCss} from "./workspace_styles.mjs";
import {boardingBookingCss,compactBoardingCss} from "./boarding_booking_styles.mjs";
import {careParityCss} from "./care_parity_styles.mjs";
import {careGalleryCss} from "./care_gallery_styles.mjs";
import {accountScreen} from './account_ui.mjs';
import {backupScreen} from './backup_ui.mjs';
import {storedArchive} from './portable_archive.mjs';
import {uiFunction,uiValues,uiMarkup,fixedUiLabels} from './ui_locale.mjs';

const css = `
  :root{--page:#f2f7f3;--wash:#e2f0e8;--line:#c8ded4;--ink:#203c30;--accent:#155747}
  [data-theme=christmas]{--page:#f6f8f4;--wash:#f6e8e5;--line:#bbd7cb;--accent:#185040}
  [data-theme=valentine]{--page:#fff5f8;--wash:#f8dfeb;--line:#eac3d3;--ink:#432332;--accent:#85274f}
  [data-theme=halloween]{--page:#fbf5fa;--wash:#f4e5d4;--line:#d9c4d9;--ink:#3d243e;--accent:#653767}
  [data-theme=songkran]{--page:#f2fbfb;--wash:#d9eefa;--line:#badce2;--ink:#17434b;--accent:#0e5969}
  [data-theme=buddhist]{--page:#fffaf1;--wash:#f7ead0;--line:#e4d1a6;--ink:#483219;--accent:#76511f}
  [data-theme=japan]{--page:#fcf6fa;--wash:#e5eef9;--line:#e3bdce;--ink:#432b39;--accent:#873750}
  body{font:1rem/1.5 "Sukhumvit Set",system-ui,sans-serif;background:linear-gradient(140deg,var(--wash),var(--page) 22rem);color:var(--ink);min-height:100vh;margin:0}
  main{margin:auto;max-width:52rem;padding:1rem}h1{margin:.2rem 0 1rem}
  article{background:#fff;border:1px solid var(--line);border-radius:1rem;margin:.6rem 0;padding:1rem}
  dialog{width:min(34rem,calc(100% - 4rem));max-height:80vh;padding:1rem;border:1px solid #a7cbb9;border-radius:1rem;color:inherit}
  .finance-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.5rem}
  .finance-totals article{margin:0}
  .finance-month{display:grid;gap:.35rem}
  .finance-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.35rem .65rem;align-items:center}
  .finance-bar progress{width:100%;grid-column:1/-1;accent-color:#24785a}
  .finance-bar[data-expense] progress{accent-color:#a47134}
  .coupon-preview{display:block;width:min(100%,30rem);height:auto;border-radius:1rem;margin:1rem auto .5rem}
  .coupon-code{font-size:1.6rem;letter-spacing:.18em}
  .calendar-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin:1rem 0}
  .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.3rem}
  .calendar-grid[data-view="day"]{grid-template-columns:minmax(0,1fr)}
  .calendar-day{background:#fff;border:1px solid #c8ded4;border-radius:.55rem;min-width:0;padding:.35rem;min-height:4rem}
  .calendar-day[data-muted]{background:#eaf0eb;color:#476052}
  .calendar-day button{display:block;width:100%;margin:.2rem 0;padding:.25rem;text-align:start;overflow-wrap:anywhere;font-size:.85rem}
  .calendar-holiday{display:block;background:#fff1d9;color:#593d19;border-radius:.35rem;padding:.2rem;overflow-wrap:anywhere;font-size:.85rem}
  @media(max-width:37rem){.calendar-grid:not([data-view="day"]){grid-template-columns:repeat(7,minmax(0,1fr));gap:.15rem}.calendar-day{padding:.2rem}.calendar-day button{font-size:.72rem}}
  .checkin-terms{flex-basis:100%;border:1px solid #c8ded4;border-radius:.6rem;padding:.6rem}
  .intake-details{flex-basis:100%;border:1px solid #c8ded4;border-radius:.65rem;padding:.6rem}
  .intake-details fieldset{margin:.7rem 0;border:1px solid #d9e4de;border-radius:.6rem;min-width:0}
  .intake-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:.55rem;align-items:start}
  .intake-choice{display:flex;flex-wrap:wrap;gap:.35rem}
  .intake-choice label{display:flex;align-items:center;padding:.32rem .45rem;border-radius:.5rem;border:1px solid #c8ded4;cursor:pointer}
  .intake-choice label:has(input:checked){background:#e4f1eb;border-color:#467b66}
  .checkin-signature{flex-basis:100%;min-width:0}
  .signature-canvas{display:block;width:100%;height:auto;border:1px solid #a7cbb9;border-radius:.55rem;background:white;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  .booking-warnings{flex-basis:100%;border:1px solid #d8ad6f;background:#fff7e9;color:#604119;border-radius:.7rem;padding:.55rem .65rem .55rem 2rem;margin:0}
  .photo-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0}
  .care-timeline-photo{width:min(100%,20rem);height:auto;border-radius:.85rem}
  .customer-dog-photo{width:6rem;height:6rem;object-fit:cover;border-radius:1rem}
  .delete-deposit{margin-inline-start:.75rem;background:#fff1ed;color:#8b3225;border-color:#e6a99b}
  dialog::backdrop{background:#203c3066}
  h2,p{margin:.15rem 0 .6rem}form{display:flex;flex-wrap:wrap;align-items:end;gap:.7rem}
  label{display:grid;gap:.2rem}input,textarea,select,button{font:inherit;padding:.55rem .7rem;border:1px solid #a7cbb9;border-radius:.6rem}
  button{background:var(--accent);color:#fff;cursor:pointer}button:disabled{opacity:.65} [hidden]{display:none}
  button[aria-pressed=false]{background:white;color:var(--accent);border-color:var(--line)}
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .workspace-menu,.settings-menu{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
  .settings-menu{margin-bottom:.65rem}
  .settings-icon{min-width:2.75rem}
  .settings-rate-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));flex-basis:100%;gap:.65rem}
  .settings-rate{display:grid;gap:.4rem;min-width:0;padding:.75rem;border:1px solid var(--line);border-radius:.7rem;background:var(--page)}
  .settings-rate h3,.settings-rate p{margin:0}
  .settings-rate input{min-width:0;width:100%;box-sizing:border-box}
  .settings-list-row{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:space-between;align-items:center;border-top:1px solid var(--line);margin-top:.7rem;padding:.55rem 0}
  .settings-list-row .settings-menu{margin:0}
  .settings-list-row strong{overflow-wrap:anywhere}
  .history-status{flex-basis:100%}
  .stay-due{display:table;margin:.35rem 0 .6rem;padding:.2rem .6rem;border-radius:1rem;background:#fff0d5;color:#68441a}
  .payment-entry{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.35rem 0;padding:.4rem 0;border-bottom:1px solid var(--line)}
  .payment-entry p{margin:0;flex:1}
  .payment-remove{display:grid;place-items:center;min-width:2.75rem;min-height:2.75rem;margin:0}
  .payment-correction{margin:.6rem 0;padding:.6rem;border:1px solid var(--line);border-radius:.65rem}
  .payment-correction label{min-width:0}
  .payment-correction textarea{box-sizing:border-box;width:100%}
  .ledger-sheet{overflow:auto;background:white;border:1px solid var(--line);border-radius:.75rem}
  .ledger-sheet table{border-collapse:collapse;width:100%;min-width:34rem;text-align:start}
  .ledger-sheet th,.ledger-sheet td{padding:.65rem;vertical-align:top;text-align:start;border-bottom:1px solid var(--line)}
  .ledger-sheet th{background:var(--page)}.ledger-sheet p{margin:.2rem 0 .3rem;overflow-wrap:anywhere}
  .ledger-sheet tr:last-child td{border-bottom:0}
  .ledger-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:.6rem;padding:0;margin:0;border:0;flex-basis:100%;min-width:0}
  .ledger-fields :is(input,select){width:100%;min-width:0;box-sizing:border-box}
  #ledger-editor{width:min(42rem,calc(100% - 3rem))}
  #stays>article>button{margin-top:1rem}
`;

function main(intakeGroups,couponScreen,settingsScreen,ledgerScreen,dashboardScreen,reportScreen,applyTheme,themeLabels,ledgerKinds,ledgerCategories,canExport,installCarePhotoViewer,accountScreen,backupScreen,storedArchive,uiLabels) {
  installCarePhotoViewer();
  const translateLabel=value=>Object.hasOwn(uiLabels,value) ? uiLabels[value] : value;
  for(const link of document.querySelectorAll('[data-ui-language]'))link.addEventListener('click',()=>{
    link.href='/?lang='+link.dataset.uiLanguage+location.hash;
  });
  const results = document.getElementById("stays");
  const message = document.getElementById("message");
  const more = document.getElementById("more");
  const qr = document.getElementById("payment-qr");
  fetch(qr.href, {method:"HEAD"}).then((response) => {
    qr.hidden = !response.ok || !response.headers.get("Content-Type")?.startsWith("image/jpeg");
  }).catch(() => {});
  const bookingSearch = document.getElementById("booking-search");
  const bookingQuery = document.getElementById("booking-query");
  const queries = {bookings:"", customers:""};
  const searchLabel = document.getElementById("directory-search-label");
  let cursor = null;
  let requestNumber = 0;
  let selected = "dashboard";
  const modes = document.querySelectorAll("[data-mode]");
  const baht = new Intl.NumberFormat("th-TH", {style:"currency", currency:"THB"});
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Bangkok",
    year:"numeric", month:"2-digit", day:"2-digit"});
  const statuses = {booked:"จอง", checked_in:"เข้าพัก", completed:"กลับบ้านแล้ว", cancelled:"ยกเลิกแล้ว"};
  const errors = {invalid:"กรุณาตรวจยอดและวันที่", forbidden:"สิทธิ์บัญชีถูกยกเลิก",
    balance_exceeded:"ยอดเกินยอดค้างหรือรายการถูกยกเลิก", not_found:"ไม่พบรายการเข้าพัก"};
  const node = (tag, text) => Object.assign(document.createElement(tag), {
    textContent:text, className:tag === "article" ? "card" : "",
  });
  const key = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");

  const calendarToolbar = document.getElementById("calendar-toolbar");
  const calendarAnchor = document.getElementById("calendar-date");
  const calendarView = document.getElementById("calendar-view");
  const calendarTitle = document.getElementById("calendar-title");
  const calendarMonth = new Intl.DateTimeFormat("th-TH", {month:"long",year:"numeric",timeZone:"UTC"});
  const calendarWeekday = new Intl.DateTimeFormat("th-TH",{weekday:"short",timeZone:"UTC"});
  const calendarDay = new Intl.DateTimeFormat("th-TH",{day:"numeric",month:"short",timeZone:"UTC"});
  const isoDay = (date) => date.toISOString().slice(0,10);
  const shiftDay = (date, days) => new Date(date.valueOf() + days * 86400000);
  calendarAnchor.value = parts.format(new Date());
  const historyToolbar = document.getElementById("history-toolbar");
  const historyStart = document.getElementById("history-start");
  const historyEnd = document.getElementById("history-end");
  const historySearch = document.getElementById("history-search");
  const historyButtons = historyToolbar.querySelectorAll("[data-status]");
  const bangkokMonth = new Date(calendarAnchor.value + "T00:00:00Z");
  historyStart.value = calendarAnchor.value.slice(0,7) + "-01";
  historyEnd.value = isoDay(new Date(Date.UTC(bangkokMonth.getUTCFullYear(),bangkokMonth.getUTCMonth()+1,0)));
  let historyQuery = {start:historyStart.value,end:historyEnd.value,q:"",status:"all"};
  function applyHistory(status) {
    historyEnd.setCustomValidity(historyStart.value > historyEnd.value ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น" : "");
    if (!historyToolbar.reportValidity()) return;
    historyQuery = {start:historyStart.value,end:historyEnd.value,q:historySearch.value,status};
    for (const item of historyButtons) item.setAttribute("aria-pressed",String(item.dataset.status === status));
    message.textContent = "";
    load(true);
  }
  historyToolbar.addEventListener("input",() => historyEnd.setCustomValidity(""));
  historyToolbar.addEventListener("submit",(event) => { event.preventDefault(); applyHistory(historyQuery.status); });
  for (const button of historyButtons) button.onclick = () => applyHistory(button.dataset.status);

  function calendarRange() {
    const anchor = new Date(calendarAnchor.value + "T00:00:00Z");
    if (!Number.isFinite(anchor.valueOf())) return null;
    if (calendarView.value === "day") return {start:anchor,end:anchor,anchor};
    const first = calendarView.value === "week"
      ? anchor : new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),1));
    const last = calendarView.value === "week"
      ? first : new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0));
    return {start:shiftDay(first,-((first.getUTCDay()+6)%7)),end:shiftDay(last,(7-last.getUTCDay())%7),anchor};
  }
  function navigateCalendar(direction) {
    const range = calendarRange();
    if (!range) return;
    const {anchor} = range;
    const next = calendarView.value === "month"
      ? new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+direction,1))
      : shiftDay(anchor,direction*(calendarView.value === "week" ? 7 : 1));
    calendarAnchor.value = isoDay(next);
    load(true);
  }
  document.getElementById("calendar-prev").onclick = () => navigateCalendar(-1);
  document.getElementById("calendar-next").onclick = () => navigateCalendar(1);
  document.getElementById("calendar-today").onclick = () => {
    calendarAnchor.value = parts.format(new Date());
    load(true);
  };
  calendarAnchor.addEventListener("change", () => load(true));
  calendarView.addEventListener("change", () => load(true));

  function renderCalendar(data,range) {
    const view = calendarView.value;
    calendarTitle.textContent = view === "month" ? calendarMonth.format(range.anchor)
      : view === "day" ? bookingDate.format(range.anchor)
        : [range.start,range.end].map((date) => bookingDate.format(date)).join(" – ");
    const grid = node("div");
    grid.className = "calendar-grid";
    grid.dataset.view = view;
    for (let day = range.start; day <= range.end; day = shiftDay(day,1)) {
      const date = isoDay(day);
      const cell = node("section");
      cell.className = "calendar-day";
      if (date === parts.format(new Date())) cell.dataset.today = "";
      if (view === "month" && day.getUTCMonth() !== range.anchor.getUTCMonth()) cell.dataset.muted = "";
      if (view === "month") {
        const heading = Object.assign(node("time"),{dateTime:date,className:"calendar-date"});
        heading.setAttribute("aria-label",bookingDate.format(day));
        heading.append(node("small",["อา.","จ.","อ.","พ.","พฤ.","ศ.","ส."][day.getUTCDay()]),
          node("strong",String(day.getUTCDate())));
        cell.append(heading);
      } else cell.append(node("strong", calendarWeekday.format(day) + " " + calendarDay.format(day)));
      for (const holiday of data.holidays) {
        if (date < holiday.starts_on || date > holiday.ends_on) continue;
        const label = node("span", "วันหยุด · " + holiday.name);
        label.className = "calendar-holiday";
        cell.append(label);
      }
      for (const booking of data.bookings) {
        if (date < booking.checkin || date > booking.checkout) continue;
        const label = (booking.dogs || booking.customer) + (booking.stay_id ? " · เช็กอินแล้ว" : "");
        const open = Object.assign(node("button",label),{type:"button",title:booking.booking_number || label});
        open.className = "calendar-booking";
        open.dataset.state = booking.stay_id ? "checked_in" : "pending";
        open.addEventListener("click", () => showBooking(booking.id));
        cell.append(open);
      }
      grid.append(cell);
    }
    results.replaceChildren(bookingForecastView(data.forecast),grid);
  }

  const financeToolbar = document.getElementById("finance-toolbar");
  const financeFrom = document.getElementById("finance-from");
  const financeTo = document.getElementById("finance-to");
  financeFrom.value = financeTo.value = parts.format(new Date()).slice(0,7);
  financeToolbar.addEventListener("submit", (event) => {
    event.preventDefault();
    message.textContent = "";
    load(true);
  });

  function renderFinance(data) {
    const money = (cents) => baht.format(cents/100);
    const labels = {income_cents:"รายรับคงเหลือหลังหักส่วนที่คืน",refund_cents:"คืนเงิน",
      expense_cents:"รายจ่าย",cash_flow_cents:"กระแสเงินสดสุทธิ"};
    const cards = node("div");
    cards.className = "finance-totals";
    for (const [kind,label] of Object.entries(labels)) {
      const card = node("article");
      card.append(node("p",label),node("strong",money(data.totals[kind])));
      cards.append(card);
    }
    const maximum = Math.max(1,...data.trend.flatMap((month) => [month.income_cents,month.expense_cents]));
    results.replaceChildren(cards,node("h2","รายรับคงเหลือเทียบรายจ่าย · รายเดือน"));
    for (const month of data.trend) {
      const row = node("article");
      row.className = "finance-month";
      row.append(node("h3",calendarMonth.format(new Date(month.month + "-01"))));
      for (const [label,value] of [["รายรับคงเหลือ",month.income_cents],["รายจ่าย",month.expense_cents]]) {
        const bar = node("div");
        bar.className = "finance-bar";
        if (label === "รายจ่าย") bar.dataset.expense = "";
        const progress = Object.assign(node("progress"),{max:maximum,value:Math.max(0,value)});
        progress.setAttribute("aria-label",label);
        bar.append(node("span",label),node("strong",money(value)),progress);
        row.append(bar);
      }
      results.append(row);
    }
  }

  async function load(reset = false) {
    const requestId = ++requestNumber;
    if (reset) {
      cursor = null;
      document.getElementById("finance-home").append(financeToolbar);
      results.replaceChildren();
    }
    results.dataset.screen = selected;
    more.disabled = true;
    try {
      if(selected==='backup'){more.hidden=true;backups.render();return;}
      if (selected === "dashboard") {
        more.hidden = true;
        const query = new URLSearchParams({from:financeFrom.value,to:financeTo.value});
        const response = await fetch("/api/dashboard?"+query);
        if (requestId !== requestNumber) return;
        if (response.status === 400) { message.textContent = "กรุณาตรวจช่วงเดือน (ไม่เกิน 120 เดือน)"; return; }
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId === requestNumber) dashboard.render(data);
        return;
      }
      if (selected === "finance") {
        more.hidden = true;
        const query = new URLSearchParams({from:financeFrom.value,to:financeTo.value});
        const response = await fetch("/api/dashboard/finance?" + query);
        if (requestId !== requestNumber) return;
        if (response.status === 400) { message.textContent = "กรุณาตรวจช่วงเดือน (ไม่เกิน 120 เดือน)"; return; }
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId === requestNumber) renderFinance(data);
        return;
      }
      if (selected === "reports") {
        more.hidden = true;
        const response = await fetch("/api/reports/"+reports.name()+"?"+reports.query());
        if (requestId !== requestNumber) return;
        if (response.status === 400) {message.textContent="กรุณาตรวจวันที่และเงื่อนไขรายงาน";return;}
        if (response.status === 422) {
          const data = await response.json();
          if (requestId === requestNumber) {
            reports.render(data);
            message.textContent="รายงานเกิน 5,000 รายการ กรุณาเลือกช่วงสั้นลงหรือเพิ่มตัวกรอง";
          }
          return;
        }
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId === requestNumber) reports.render(data);
        return;
      }
      if (selected === "coupons") {
        const response = await fetch("/api/coupons?" + couponAdmin.query(cursor));
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId !== requestNumber) return;
        cursor = data.nextBefore;
        couponAdmin.render(data);
        more.hidden = cursor === null;
        return;
      }
      if (selected === "settings") {
        more.hidden = true;
        const response = await fetch("/api/settings");
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId === requestNumber) settingsAdmin.render(data);
        return;
      }
      if (selected === "ledger") {
        const response = await fetch("/api/transactions?" + ledger.query(cursor));
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId !== requestNumber) return;
        cursor = data.nextBefore;
        ledger.render(data);
        more.hidden = !cursor;
        return;
      }
      if (selected === "calendar") {
        more.hidden = true;
        const range = calendarRange();
        if (!range) { message.textContent = "กรุณาเลือกวันที่"; return; }
        const query = new URLSearchParams({start:isoDay(range.start),end:isoDay(range.end)});
        const response = await fetch("/api/bookings/calendar?" + query);
        if (!response.ok) throw Error();
        const data = await response.json();
        if (requestId === requestNumber) renderCalendar(data,range);
        return;
      }
      const directory = selected === "bookings" || selected === "customers";
      const directoryPath = selected === "bookings" ? "/api/bookings/pending" : "/api/customers";
      let url = "/api/stays/" + selected + (cursor ? "?" + new URLSearchParams({before:cursor}) : "");
      if (directory) url = directoryPath + "?" + new URLSearchParams({after:cursor || 0,q:queries[selected]});
      if (selected === "history") {
        const query = new URLSearchParams(historyQuery);
        if (cursor) query.set("before",cursor);
        url = "/api/stays/history?" + query;
      }
      const response = await fetch(url);
      if (requestId === requestNumber && selected === "history" && response.status === 400) {
        message.textContent = "กรุณาตรวจช่วงวันที่และคำค้นหา";
        more.hidden = true;
        return;
      }
      if (!response.ok) throw Error();
      const data = await response.json();
      if (requestId !== requestNumber) return;
      if (directory) {
        cursor = data.nextAfter;
        if(selected === "bookings" && !results.querySelector(".booking-forecast")) results.prepend(bookingForecastView(data.forecast));
        const render = selected === "bookings" ? bookingCard : customerCard;
        for (const record of data[selected]) results.append(render(record));
      } else {
        cursor = data.nextBefore;
        for (const stay of data.stays) results.append(card(stay));
      }
      if (!results.childElementCount || (selected === "bookings" && !results.querySelector(".reservation-card"))) results.append(node("p", {
        customers:"ไม่พบลูกค้า", bookings:"ไม่พบการจองที่รอเช็กอิน", current:"ไม่มีสุนัขที่กำลังเข้าพัก",
        outstanding:"ไม่มียอดค้างชำระ", history:"ไม่พบการเข้าพักตามตัวกรอง",
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
  const customerDialog = document.getElementById("customer-detail");
  const addCustomer = document.getElementById("add-customer");
  const customerContent = document.getElementById("customer-content");
  let customerRequest;
  document.getElementById("close-customer").addEventListener("click", () => customerDialog.close());
  customerDialog.addEventListener("close", () => customerRequest?.abort());

  addCustomer.addEventListener("click", () => customerEditor());

  let pendingCustomer;
  function customerEditor(customer,onSaved = null) {
    const editing = Boolean(customer);
    const attempt = editing ? null : pendingCustomer;
    customerRequest?.abort();
    if (!customerDialog.open) customerDialog.showModal();
    const form = node("form");
    const inputs = {};
    for (const [field, label, limit] of [
      ["name","ชื่อลูกค้า",120], ["owner_phone","เบอร์โทร",50], ["line_id","Line ID / Facebook",120],
      ["emergency_address","ที่อยู่ฉุกเฉิน",500], ["note","หมายเหตุ",800],
    ]) {
      const input = node(limit >= 500 ? "textarea" : "input");
      Object.assign(input, {maxLength:limit, required:field === "name",
        value:customer?.[field] ?? attempt?.[field] ?? ""});
      if (field === "owner_phone") input.type = "tel";
      const caption = node("label", label);
      caption.append(input);
      inputs[field] = input;
      form.append(caption);
    }
    const status = node("p", attempt ? "กรุณาส่งข้อมูลเดิมอีกครั้งเพื่อยืนยันผล" : "");
    status.setAttribute("role", "status");
    const submit = node("button", "บันทึก");
    form.append(submit, status);
    customerContent.replaceChildren(node("h3", editing ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้า"), form);
    const back = Object.assign(node("button", "กลับไปดูข้อมูล"), {type:"button"});
    if (editing) {
      back.addEventListener("click", () => showCustomer(customer.id));
      customerContent.append(back);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([field, input]) => [field, input.value.trim()]));
      if (!values.name) {
        status.textContent = "กรุณาระบุชื่อลูกค้า";
        return;
      }
      if (!editing && pendingCustomer && Object.keys(values).some((field) => values[field] !== pendingCustomer[field])) {
        status.textContent = "ส่งข้อมูลเดิมอีกครั้งเพื่อยืนยันผลการบันทึกครั้งก่อน";
        return;
      }
      const body = editing ? values : pendingCustomer || {...values, key:key()};
      if (!editing) pendingCustomer = body;
      submit.disabled = true;
      try {
        const response = await fetch("/api/customers" + (editing ? "/" + customer.id : ""), {
          method:editing ? "PUT" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) {
          if (!editing && response.status < 500) pendingCustomer = null;
          status.textContent = "บันทึกไม่ได้ กรุณาตรวจข้อมูล";
          return;
        }
        if (!editing) pendingCustomer = null;
        if(onSaved && form.isConnected && customerDialog.open){customerDialog.close();await onSaved({...values,id:result.id});}
        else if (form.isConnected && customerDialog.open) await showCustomer(result.id);
        if (selected === "customers") await load(true);
        message.textContent = "บันทึกข้อมูลลูกค้าแล้ว";
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาลองส่งข้อมูลเดิมอีกครั้ง";
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function removeCustomer(customer, button) {
    if (!confirm("นำ " + customer.name + " ออกจากรายชื่อลูกค้าที่ใช้งานและเก็บประวัติไว้หรือไม่?")) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/customers/" + customer.id, {method:"DELETE"});
      if (!response.ok) throw Error();
      if (button.isConnected && customerDialog.open) customerDialog.close();
      if (selected === "customers") await load(true);
      message.textContent = "นำลูกค้าออกจากรายการแล้ว";
    } catch {
      if (button.isConnected) document.getElementById("customer-status").textContent = "นำลูกค้าออกไม่ได้ กรุณาลองใหม่";
    } finally {
      button.disabled = false;
    }
  }

  function cardDogPhotos(record) {
    let dogs=record.dog_photos;
    if(typeof dogs === "string"){try{dogs=JSON.parse(dogs);}catch{dogs=[];}}
    const gallery=Object.assign(node("div"),{className:"record-dog-photos"});
    if(!Array.isArray(dogs))return gallery;
    for(const dog of dogs){
      const figure=node("figure");
      const photo=Object.assign(node("img"),{alt:dog.name,loading:"lazy",decoding:"async",width:76,height:76,
        src:dog.has_photo ? "/api/customers/"+dog.customer_id+"/dogs/"+dog.id+"/photo" : "/static/little-paws-icon.png"});
      photo.onerror=()=>{photo.onerror=null;photo.src="/static/little-paws-icon.png";};
      figure.append(photo,node("figcaption",dog.name));gallery.append(figure);
    }return gallery;
  }

  function customerCard(customer) {
    const article = Object.assign(node("article"),{className:"card customer-directory-card"});
    const details = Object.assign(node("button", "ดูข้อมูลลูกค้า"), {type:"button"});
    details.addEventListener("click", () => showCustomer(customer.id));
    const initial=Object.assign(node("span",Array.from(customer.name || "?")[0]),{className:"customer-initial"});initial.setAttribute("aria-hidden","true");
    const copy=node("div");copy.append(node("h2",customer.name),node("p","สุนัข " + customer.dog_count + " ตัว"));
    article.append(initial,copy,cardDogPhotos(customer),details);
    return article;
  }

  const sizes = {small:"เล็ก",medium:"กลาง",large:"ใหญ่"};
  const yesNo = {yes:"ใช่",no:"ไม่ใช่"};
  const genders = {male:"เพศผู้",female:"เพศเมีย"};
  const neutered = {yes:"ทำหมันแล้ว",no:"ยังไม่ทำหมัน"};
  const dogAttempts = new Map();

  function readProfile(dog) {
    try { return JSON.parse(dog?.profile) || {}; } catch { return {}; }
  }

  function dogEditor(customerId, dog) {
    customerRequest?.abort();
    const profile = readProfile(dog);
    const attempt = dog ? null : dogAttempts.get(customerId);
    const values = attempt || {...profile,...dog};
    const form = node("form");
    const inputs = {};
    function field(name, label, type, setting) {
      const input = node(type === "select" ? "select" : type === "textarea" ? "textarea" : "input");
      if (type === "select") {
        for (const [value, text] of Object.entries(setting)) input.append(new Option(text, value));
      } else if (type !== "textarea") input.type = type;
      if (typeof setting === "number") input.maxLength = setting;
      if (type === "checkbox") input.checked = Boolean(values[name]);
      else input.value = values[name] ?? (name === "size" ? "small" : "");
      input.required = name === "name";
      const caption = node("label", label);
      caption.append(input);
      inputs[name] = input;
      form.append(caption);
    }
    field("name","ชื่อสุนัข","text",120);
    field("size","ขนาด","select",sizes);
    field("breed","สายพันธุ์","text",120);
    field("gender","เพศ","select",{"":"—", ...genders});
    field("neutered","สถานะทำหมัน","select",{"":"—", ...neutered});
    field("weight","น้ำหนัก (กก.)","text",6);
    field("birth_date","วันเกิด","date");
    field("birth_estimated","วันเกิดโดยประมาณ","checkbox");
    field("age_years","ระบุอายุแทนวันเกิด (ปี)","text",2);
    field("age_months","ระบุอายุแทนวันเกิด (เดือน)","text",2);
    field("vaccinated","วัคซีนพื้นฐานใน 1 ปีที่ผ่านมา","select",{"":"—", ...yesNo});
    field("rabies","วัคซีนพิษสุนัขบ้าใน 1 ปีที่ผ่านมา","select",{"":"—", ...yesNo});
    field("flea_tick","ป้องกันเห็บหมัดใน 1 เดือนที่ผ่านมา","select",{"":"—", ...yesNo});
    field("medical_history","ประวัติสุขภาพ / แพ้อาหาร","textarea",600);
    field("required_care","โรคประจำตัว / การดูแลที่ต้องการ","textarea",600);
    field("medications","ยาประจำตัว","textarea",600);
    field("note","นิสัย / ข้อควรระวัง","textarea",600);
    if (dog) {
      inputs.birth_date.addEventListener("change", () => {
        inputs.age_years.value = "";
        inputs.age_months.value = "";
        inputs.birth_estimated.checked = false;
      });
    }
    const status = node("p", attempt ? "ส่งข้อมูลเดิมอีกครั้งเพื่อยืนยันผล" : "");
    status.setAttribute("role","status");
    const submit = node("button","บันทึกข้อมูลสุนัข");
    const back = Object.assign(node("button","กลับไปดูข้อมูลลูกค้า"), {type:"button"});
    back.addEventListener("click", () => showCustomer(customerId));
    form.append(submit, back, status);
    customerContent.replaceChildren(node("h3", dog ? "แก้ไขสุนัข" : "เพิ่มสุนัข"), form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([field,input]) =>
        [field,input.type === "checkbox" ? input.checked : input.value.trim()]));
      const pending = dog ? null : dogAttempts.get(customerId);
      if (pending && Object.keys(values).some((field) => values[field] !== pending[field])) {
        status.textContent = "ส่งข้อมูลเดิมอีกครั้งเพื่อยืนยันผลการบันทึกครั้งก่อน";
        return;
      }
      const body = dog ? values : pending || {...values,key:key()};
      if (!dog) dogAttempts.set(customerId, body);
      submit.disabled = true;
      try {
        const response = await fetch("/api/customers/" + customerId + "/dogs" + (dog ? "/" + dog.id : ""), {
          method:dog ? "PUT" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
        });
        if (!response.ok) {
          if (!dog && response.status < 500) dogAttempts.delete(customerId);
          status.textContent = "บันทึกไม่ได้ กรุณาตรวจชื่อ วันเกิด อายุ และน้ำหนัก";
          return;
        }
        if (!dog) dogAttempts.delete(customerId);
        if (form.isConnected && customerDialog.open) {
          await showCustomer(customerId);
          document.getElementById("customer-status").textContent = "บันทึกข้อมูลสุนัขแล้ว";
        }
        if (selected === "customers") await load(true);
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาลองส่งข้อมูลเดิมอีกครั้ง";
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function removeDog(customerId, dog, button) {
    if (!confirm("นำ " + dog.name + " ออกจากรายชื่อสุนัขโดยเก็บประวัติไว้หรือไม่?")) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/customers/" + customerId + "/dogs/" + dog.id, {method:"DELETE"});
      if (!response.ok) throw Error();
      if (button.isConnected && customerDialog.open) {
        await showCustomer(customerId);
        document.getElementById("customer-status").textContent = "นำสุนัขออกจากรายชื่อแล้ว";
      }
      if (selected === "customers") await load(true);
    } catch {
      if (button.isConnected) document.getElementById("customer-status").textContent = "นำสุนัขออกไม่ได้ กรุณาลองใหม่";
    } finally {
      button.disabled = false;
    }
  }

  function dogAge(birth) {
    const [year,month,day] = parts.format(new Date()).split("-").map(Number);
    let months = (year - birth.getUTCFullYear()) * 12 + month - 1 - birth.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (Math.min(lastDay, birth.getUTCDate()) > day) months -= 1;
    return Math.floor(months / 12) + " ปี " + (months % 12) + " เดือน";
  }

  async function resizedPhoto(file) {
    if (file.size > 7 * 1024 * 1024) throw Error("กรุณาเลือกรูปไม่เกิน 7 MB");
    const url = URL.createObjectURL(file);
    try {
      const source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(Error("เปิดรูปนี้ไม่ได้ กรุณาเลือกรูปที่อุปกรณ์รองรับ"));
        image.src = url;
      });
      const scale = Math.min(1, 1024 / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = node("canvas");
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext("2d", {alpha:false});
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84,0.7,0.5]) {
        const output = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (output?.type === "image/jpeg" && output.size <= 512 * 1024) return output;
      }
      throw Error("ย่อรูปให้มีขนาดเหมาะสมไม่ได้ กรุณาเลือกรูปอื่น");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function photoActions(customerId, dog) {
    const actions = node("div");
    actions.className = "photo-actions";
    const status = node("span", "");
    status.setAttribute("role", "status");
    const buttons = [];
    for (const [label,capture] of [["เลือกรูป",false],["📷 ถ่ายรูป",true]]) {
      const input = Object.assign(node("input"), {type:"file",accept:"image/*",hidden:true});
      if (capture) input.setAttribute("capture","environment");
      const button = Object.assign(node("button", label), {type:"button"});
      button.addEventListener("click", () => input.click());
      buttons.push(button);
      actions.append(input, button);
      input.addEventListener("change", async () => {
        const file = input.files[0];
        input.value = "";
        if (!file) return;
        buttons.forEach((item) => { item.disabled = true; });
        status.textContent = "กำลังย่อและบันทึกรูป…";
        try {
          const photo = await resizedPhoto(file);
          const response = await fetch("/api/customers/" + customerId + "/dogs/" + dog.id + "/photo", {
            method:"PUT", headers:{"Content-Type":"image/jpeg"}, body:photo,
          });
          if (!response.ok) throw Error("บันทึกรูปไม่ได้ กรุณาลองใหม่");
          if (actions.isConnected && customerDialog.open) {
            await showCustomer(customerId);
            document.getElementById("customer-status").textContent = "บันทึกรูปสุนัขแล้ว";
          }
        } catch (error) {
          status.textContent = error.message || "บันทึกรูปไม่ได้ กรุณาลองใหม่";
        } finally {
          buttons.forEach((item) => { item.disabled = false; });
        }
      });
    }
    actions.append(status);
    return actions;
  }

  function dogCard(customerId, dog) {
    const item = Object.assign(node("article"),{className:"card customer-dog-card"});
    item.append(node("h4", dog.name));
    const photo=Object.assign(node("img"),{className:"customer-dog-photo",alt:dog.name,loading:"lazy",
      src:dog.has_photo ? "/api/customers/"+customerId+"/dogs/"+dog.id+"/photo" : "/static/little-paws-icon.png"});
    photo.onerror=()=>{photo.onerror=null;photo.src="/static/little-paws-icon.png";};item.prepend(photo);
    const profile = readProfile(dog);
    const birth = new Date(profile.birth_date);
    const facts = [
      sizes[dog.size], profile.breed, genders[profile.gender], neutered[profile.neutered],
      profile.birth_date && Number.isFinite(birth.getTime())
        ? (profile.birth_estimated ? "วันเกิดโดยประมาณ " : "วันเกิด ") + bookingDate.format(birth) + " (" + dogAge(birth) + ")" : "",
    ].filter(Boolean);
    if (facts.length) item.append(node("p", facts.join(" · ")));
    if (dog.note) item.append(node("p", dog.note));
    const edit = Object.assign(node("button", "แก้ไขสุนัข"), {type:"button"});
    edit.addEventListener("click", () => dogEditor(customerId, dog));
    const remove = Object.assign(node("button", "นำออกจากรายชื่อ"), {type:"button",className:"delete-deposit"});
    remove.addEventListener("click", () => removeDog(customerId, dog, remove));
    const actions=Object.assign(node("div"),{className:"record-actions"});actions.append(edit,remove);
    item.append(photoActions(customerId,dog),actions);
    return item;
  }

  async function showCustomer(id) {
    customerRequest?.abort();
    const controller = customerRequest = new AbortController();
    customerContent.replaceChildren(node("p", "กำลังโหลด…"));
    if (!customerDialog.open) customerDialog.showModal();
    document.getElementById("customer-status").textContent = "";
    let historyList;
    async function loadHistory(offset, nextButton) {
      if (nextButton) nextButton.disabled = true;
      try {
        const response = await fetch("/api/customers/" + id + "?offset=" + offset, {signal:controller.signal});
        if (!response.ok) throw Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!offset) {
          const customer = data.customer;
          const edit = Object.assign(node("button", "แก้ไข"), {type:"button"});
          edit.addEventListener("click", () => customerEditor(customer));
          const archive = Object.assign(node("button", "นำออกจากรายการ"), {type:"button",className:"delete-deposit"});
          archive.addEventListener("click", () => removeCustomer(customer, archive));
          const heading=Object.assign(node("div"),{className:"customer-profile-heading"});
          const actions=Object.assign(node("div"),{className:"record-actions"});actions.append(edit,archive);
          heading.append(node("h3",customer.name),actions);customerContent.replaceChildren(heading);
          const facts=Object.assign(node("dl"),{className:"record-facts"});
          for (const [label,value] of [["โทร",customer.owner_phone], ["Line ID / Facebook",customer.line_id],
            ["ที่อยู่ฉุกเฉิน",customer.emergency_address], ["หมายเหตุ",customer.note]]) {
            if(value){const fact=node("div");fact.append(node("dt",label),node("dd",value));facts.append(fact);}
          }
          if(facts.childElementCount)customerContent.append(facts);
          const addDog = Object.assign(node("button", "เพิ่มสุนัข"), {type:"button"});
          addDog.addEventListener("click", () => dogEditor(customer.id));
          const dogHeading=Object.assign(node("div"),{className:"customer-section-heading"});dogHeading.append(node("h3","สุนัข"),addDog);
          const dogs=Object.assign(node("div"),{className:"customer-dog-grid"});
          customerContent.append(dogHeading,dogs);
          for (const dog of data.dogs) dogs.append(dogCard(customer.id,dog));
          if (!data.dogs.length) customerContent.append(node("p", "ยังไม่มีข้อมูลสุนัข"));
          historyList=Object.assign(node("section"),{className:"customer-history"});
          historyList.append(node("h3","ประวัติการเข้าพัก"));customerContent.append(historyList);
          if(!data.stays.length)historyList.append(node("p","ยังไม่มีประวัติการเข้าพัก"));
        }
        nextButton?.remove();
        for (const stay of data.stays) {
          const item = node("article");
          item.append(node("h4", [stay.stay_number || "#" + stay.id, statuses[stay.status] || stay.status].join(" · ")),
            node("p", stay.dogs || "—"),
            node("p", [stay.checkin, stay.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")));
          const summary = Object.assign(node("button",stay.due_cents > 0
            ? "ค้างชำระ " + baht.format(stay.due_cents / 100) : "ดูสรุปการเข้าพัก"),{type:"button"});
          summary.addEventListener("click", () => { customerDialog.close(); showStay(stay.id); });
          item.append(cardDogPhotos(stay));
          item.append(summary);
          historyList.append(item);
        }
        if (data.nextOffset !== null) {
          const moreHistory = Object.assign(node("button", "ดูประวัติเพิ่มเติม"), {type:"button"});
          moreHistory.addEventListener("click", () => loadHistory(data.nextOffset, moreHistory));
          historyList.append(moreHistory);
        }
      } catch {
        if (controller.signal.aborted) return;
        if (nextButton) {
          nextButton.disabled = false;
          nextButton.textContent = "โหลดไม่สำเร็จ ลองใหม่";
        } else customerContent.replaceChildren(node("p", "โหลดข้อมูลลูกค้าไม่ได้ กรุณาลองใหม่"));
      }
    }
    await loadHistory(0);
  }

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
    const form = Object.assign(node("form"),{className:"record-payment-form"});
    form.append(node("h4","รับมัดจำ"));
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
          if (selected === "bookings" || selected === "calendar") await load(true);
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

  function depositDeleteButton(bookingId, payment) {
    const label = "ลบรายการมัดจำ " + baht.format(payment.amount_cents / 100);
    const button = Object.assign(node("button", "🗑"), {type:"button", title:label});
    button.setAttribute("aria-label", label);
    button.className = "delete-deposit";
    button.addEventListener("click", async () => {
      if (!confirm("ยืนยัน" + label + " หรือไม่?")) return;
      button.disabled = true;
      const status = document.getElementById("booking-status");
      try {
        const response = await fetch("/api/bookings/" + bookingId + "/deposits/" + payment.id, {
          method:"DELETE", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({key:payment.payment_key}),
        });
        if (!response.ok) throw Error();
        if (button.isConnected && bookingDialog.open) {
          await showBooking(bookingId);
          status.textContent = "ลบรายการมัดจำแล้ว";
        }
        if (["bookings","calendar","dashboard"].includes(selected)) await load(true);
      } catch {
        if (button.isConnected) status.textContent = "ยังยืนยันการลบไม่ได้ กรุณาตรวจรายการแล้วลองใหม่";
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  let bookingRequest;
  const addBooking = document.getElementById("add-booking");
  document.getElementById("direct-checkin").addEventListener("click", () => bookingEditor(null,true));
  const warningLabels = {holiday:"ช่วงที่เลือกตรงกับวันหยุดร้าน",overlap:"สุนัขมีรายการอื่นทับช่วงวันที่เลือก",
    capacity:"จำนวนสุนัขเกินความจุที่ตั้งไว้"};
  addBooking.addEventListener("click", () => bookingEditor());
  let createBookingKey;

  async function bookingEditor(booking, direct = false, draftState = null, stayEdit = false) {
    bookingDialog.classList.remove("care-workspace","record-workspace");
    bookingDialog.classList.add("checkin-workspace");
    const draft = draftState?.draft;
    const initial = booking || (draft && {customer:draftState.customer,customer_id:draft.customerId,
      checkin:draft.checkin,checkout:draft.checkout,service_type:draft.service,charged_nights:draft.quantity100/100,
      discount_cents:draft.discountCents,note:draft.note,
      dogs:draft.dogs.map((dog) => ({id:dog.id,nightly_rate_cents:dog.rate}))});
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    if (!bookingDialog.open) bookingDialog.showModal();
    const status = node("p", "");
    status.setAttribute("role","status");
    const today = parts.format(new Date());
    const form = Object.assign(node("form"),{className:"checkin-form"});
    const submit = node("button",stayEdit ? "บันทึกการเข้าพัก" : direct ? "ไปหน้าเช็กอิน" : "บันทึกการจอง");
    const warnings = node("ul");
    warnings.className = "booking-warnings";
    warnings.hidden = true;
    submit.disabled = true;
    const search = Object.assign(node("input"), {type:"search", maxLength:100, placeholder:"พิมพ์ชื่อแล้วกดค้นหา"});
    const searchButton = Object.assign(node("button","ค้นหา"),{type:"button"});
    const owner = node("select");
    owner.required = true;
    owner.append(new Option("เลือกลูกค้า",""));
    const ownerGroup = node("label","ลูกค้า");
    ownerGroup.append(owner);
    const ownerOptions=Object.assign(node("div"),{className:"checkin-customer-options",id:"checkin-customer-options",hidden:true});
    ownerOptions.setAttribute("role","listbox");
    search.setAttribute("role","combobox");search.setAttribute("aria-autocomplete","list");
    search.setAttribute("aria-controls",ownerOptions.id);search.setAttribute("aria-expanded","false");
    search.placeholder="เลือกหรือพิมพ์ชื่อลูกค้า";
    let searchTimer;
    controller.signal.addEventListener("abort",()=>clearTimeout(searchTimer),{once:true});
    const dogs = Object.assign(node("fieldset"),{className:"checkin-dog-list"});
    dogs.append(node("legend","สุนัขและราคา"));
    const choices = new Map();
    let rates;
    let requestId = 0;
    let pendingSave = false;
    let warningToken = null;
    function field(label, type, value) {
      const input = Object.assign(node("input"), {type,value});
      const wrapper = node("label", label);
      wrapper.append(input);
      form.append(wrapper);
      return input;
    }
    if (booking) {
      owner.append(new Option(booking.customer, booking.customer_id));
      owner.value = booking.customer_id;
      owner.disabled = true;
    } else {
      owner.hidden=true;owner.required=false;
      search.required=true;searchButton.hidden=true;
      ownerGroup.append(search,ownerOptions);
      search.addEventListener("input",()=>{
        owner.value="";submit.disabled=true;
        clearTimeout(searchTimer);searchTimer=setTimeout(searchOwners,180);
      });
      search.addEventListener("focus",()=>{if(!ownerOptions.childElementCount)searchOwners();else{ownerOptions.hidden=false;search.setAttribute("aria-expanded","true");}});
      search.addEventListener("keydown",event=>{
        if(event.key==="ArrowDown"){event.preventDefault();ownerOptions.querySelector("button")?.focus();}
        if(event.key==="Escape"){ownerOptions.hidden=true;search.setAttribute("aria-expanded","false");}
      });
      if (initial) {
        owner.append(new Option(initial.customer,initial.customer_id));
        owner.value = initial.customer_id;search.value=initial.customer;
      }
    }
    const ownerSection=Object.assign(node("section"),{className:"checkin-owner-section"});
    ownerSection.append(ownerGroup);
    if(!booking){
      const addOwner=Object.assign(node("button","เพิ่มลูกค้า"),{type:"button",className:"secondary"});
      addOwner.onclick=()=>customerEditor(null,async customer=>{
        owner.append(new Option(customer.name,customer.id));owner.value=customer.id;search.value=customer.name;await loadDogs();
      });ownerSection.append(addOwner);
    }
    const ownerFacts=Object.assign(node("p"),{className:"checkin-owner-facts"});ownerSection.append(ownerFacts);
    const editOwner=Object.assign(node("button","แก้ไขข้อมูลลูกค้า"),{type:"button",className:"secondary"});
    editOwner.onclick=()=>{if(owner.value)showCustomer(Number(owner.value));};ownerSection.append(editOwner);
    const addDog=Object.assign(node("button","เพิ่มสุนัข"),{type:"button",className:"secondary"});
    addDog.onclick=()=>{if(owner.value){if(!customerDialog.open)customerDialog.showModal();dogEditor(Number(owner.value));}};
    ownerSection.append(addDog);
    customerDialog.addEventListener("close",()=>{if(form.isConnected && owner.value)loadDogs();},{signal:controller.signal});
    form.append(ownerSection);
    const service = node("select");
    for (const [value,[label]] of Object.entries(services)) service.append(new Option(label,value));
    service.value = initial?.service_type || "overnight";
    const serviceLabel = node("label","ประเภทบริการ");
    serviceLabel.append(service);
    serviceLabel.hidden = true;
    const segments = Object.assign(node("div"),{className:"service-segments"});
    segments.setAttribute("role","group");segments.setAttribute("aria-label","ประเภทบริการ");
    const serviceButtons = [];
    for (const [value,[caption]] of Object.entries(services)) {
      const button = Object.assign(node("button",caption),{type:"button",className:"secondary"});
      button.setAttribute("aria-pressed",String(value===service.value));
      button.onclick=()=>{service.value=value;for(const [key,item] of serviceButtons)item.setAttribute("aria-pressed",String(key===value));service.dispatchEvent(new Event("change"));};
      serviceButtons.push([value,button]);segments.append(button);
    }
    form.append(serviceLabel,segments);
    const defaultDay = !direct && selected === "calendar" ? calendarAnchor.value || today : today;
    const checkin = field("วันเข้าพัก","date",initial?.checkin || defaultDay);
    const checkout = field("วันรับกลับ","date",initial?.checkout || defaultDay);
    const quantity = field("จำนวนวัน / เดือน","number",initial?.charged_nights ?? 1);
    const discount = field("ส่วนลด (บาท)","number",(initial?.discount_cents || 0)/100);
    const note = field("หมายเหตุ","text",initial?.note || "");
    let stayIntake=null,couponCode=null;
    if(stayEdit){
      couponCode=field("รหัสคูปอง","text",booking.coupon_code || "");couponCode.maxLength=6;
      discount.value=Math.max(0,booking.discount_cents-(booking.coupon_discount_cents || 0))/100;
      stayIntake=checkInDetails(booking.intake);
      form.append(stayIntake.panel);
    }
    note.maxLength = 800;note.parentElement.classList.add("checkin-wide");
    quantity.min = discount.min = "0";
    discount.step = "0.01";
    checkin.required = checkout.required = quantity.required = true;
    const formActions=Object.assign(node("div"),{className:"record-actions checkin-wide"});
    formActions.append(submit);
    if(booking){const back=Object.assign(node("button","กลับไปหน้าสรุป"),{type:"button",className:"secondary"});
      back.onclick=()=>stayEdit ? showStay(booking.id) : showBooking(booking.id);formActions.append(back);}
    form.append(dogs,warnings,formActions,status);
    bookingContent.replaceChildren(node("h3",stayEdit ? "แก้ไขการเข้าพัก" : direct ? "เช็กอินโดยตรง" : booking ? "แก้ไขการจอง" : "สร้างการจอง"),form);
    function defaults() {
      quantity.step = service.value === "monthly" ? "0.01" : "1";
      const days = (Date.parse(checkout.value) - Date.parse(checkin.value)) / 86400000;
      if (Number.isFinite(days) && days >= 0) quantity.value = service.value === "monthly"
        ? (days / 30).toFixed(2) : Math.max(service.value === "daycare" ? 1 : 0,days);
    }
    quantity.step = service.value === "monthly" ? "0.01" : "1";
    checkin.addEventListener("change", defaults);
    checkout.addEventListener("change", defaults);
    service.addEventListener("change", () => {
      defaults();
      for (const {dog,rate} of choices.values()) rate.value = rates?.[service.value]?.[dog.size] ?? "";
    });
    async function searchOwners() {
      const call = ++requestId;
      searchButton.disabled = true;
      try {
        const response = await fetch("/api/customers?" + new URLSearchParams({q:search.value}), {signal:controller.signal});
        if (!response.ok) throw Error();
        const result = await response.json();
        if (controller.signal.aborted || call !== requestId) return;
        const selectedOwner=owner.value;
        const selectedName=owner.selectedOptions[0]?.textContent || "";
        owner.replaceChildren(new Option("เลือกลูกค้า",""), ...result.customers.map((c) => new Option(c.name,c.id)));
        if(selectedOwner && ![...owner.options].some(option=>option.value===selectedOwner))owner.append(new Option(selectedName,selectedOwner));
        owner.value=selectedOwner;
        ownerOptions.replaceChildren();
        for(const customer of result.customers){
          const option=Object.assign(node("button",customer.name),{type:"button",className:"secondary"});
          option.setAttribute("role","option");
          option.onclick=()=>{owner.value=customer.id;search.value=customer.name;ownerOptions.hidden=true;search.setAttribute("aria-expanded","false");owner.dispatchEvent(new Event("change"));};
          ownerOptions.append(option);
        }
        if(!result.customers.length)ownerOptions.append(node("p","ไม่พบลูกค้า"));
        ownerOptions.hidden=false;search.setAttribute("aria-expanded","true");
        status.textContent = result.customers.length ? "" : "ไม่พบลูกค้า";
      } catch {
        if (!controller.signal.aborted) status.textContent = "ค้นหาลูกค้าไม่ได้";
      } finally {
        searchButton.disabled = false;
      }
    }
    searchButton.addEventListener("click", searchOwners);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); searchOwners(); }
    });
    async function loadDogs() {
      const call = ++requestId;
      submit.disabled = true;
      const retained = new Map([...choices].map(([id,value])=>[id,{checked:value.include.checked,rate:value.rate.value}]));
      dogs.replaceChildren(node("legend","สุนัขและราคา"));
      choices.clear();
      if (!owner.value) return;
      const existing = new Map((initial?.dogs || []).map((dog) => [dog.id,dog]));
      let available = [];
      try {
        const response = await fetch("/api/customers/" + owner.value,{signal:controller.signal});
        if (response.ok) {
          const data=await response.json();available=data.dogs;
          ownerFacts.textContent=[data.customer.owner_phone,data.customer.line_id,data.customer.emergency_address].filter(Boolean).join(" · ");
        }
        else if (!booking || response.status !== 404) throw Error();
      } catch {
        if (!controller.signal.aborted && call === requestId) status.textContent = "โหลดรายชื่อสุนัขไม่ได้";
        return;
      }
      if (controller.signal.aborted || call !== requestId) return;
      const allDogs = new Map(available.map((dog) => [dog.id,dog]));
      if (booking) for (const dog of existing.values()) if (!allDogs.has(dog.id)) allDogs.set(dog.id,dog);
      for (const dog of allDogs.values()) {
        const original = existing.get(dog.id);
        const include = Object.assign(node("input"),{type:"checkbox",checked:!!original});
        const rate = Object.assign(node("input"),{type:"number",min:"0",max:"999999.99",step:"0.01",
          value:original ? (original.nightly_rate_cents === null ? "" : original.nightly_rate_cents / 100)
            : rates?.[service.value]?.[dog.size] ?? ""});
        const row = Object.assign(node("div"),{className:"checkin-dog-choice"});
        const dogLabel = node("label", dog.name);
        dogLabel.prepend(include);
        const priceLabel = node("label","ราคา (บาท)");
        priceLabel.append(rate);
        dogLabel.className="care-share-opt-in";
        const avatar=Object.assign(node("img"),{className:"customer-dog-photo",alt:dog.name,
          src:dog.has_photo ? "/api/customers/"+owner.value+"/dogs/"+dog.id+"/photo" : "/static/little-paws-icon.png"});
        const profile=readProfile(dog);
        const summary=node("p",[profile.breed,genders[profile.gender],neutered[profile.neutered],sizes[dog.size]].filter(Boolean).join(" · "));
        const edit=Object.assign(node("button","แก้ไขข้อมูลสุนัข"),{type:"button",className:"secondary"});
        edit.onclick=()=>{if(!customerDialog.open)customerDialog.showModal();dogEditor(Number(owner.value),dog);};
        row.append(avatar,dogLabel,summary,priceLabel,edit);
        dogs.append(row);
        if(retained.has(dog.id)){include.checked=retained.get(dog.id).checked;rate.value=retained.get(dog.id).rate;}
        choices.set(dog.id,{dog,include,rate});
      }
      submit.disabled = choices.size === 0;
    }
    owner.addEventListener("change", loadDogs);
    function clearWarnings() {
      warningToken = null;
      warnings.replaceChildren();
      warnings.hidden = true;
      submit.textContent = stayEdit ? "บันทึกการเข้าพัก" : direct ? "ไปหน้าเช็กอิน" : "บันทึกการจอง";
    }
    form.addEventListener("input",clearWarnings);
    owner.addEventListener("change",clearWarnings);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pendingSave) return;
      const selectedDogs = [...choices].filter(([,entry]) => entry.include.checked)
        .map(([id,{rate}]) => ({id, rate:rate.value === "" ? null : Math.round(Number(rate.value)*100)}));
      if (!selectedDogs.length) { status.textContent = "กรุณาเลือกสุนัขอย่างน้อยหนึ่งตัว"; return; }
      if (!booking && !direct) createBookingKey ??= key();
      const quantity100 = Math.round(Number(quantity.value)*100);
      const discountCents = Math.round(Number(discount.value)*100);
      const samePrice = booking && quantity100 === Math.round(booking.charged_nights*100) &&
        discountCents === booking.discount_cents && selectedDogs.length === booking.dogs.length &&
        selectedDogs.every((dog) => booking.dogs.some((old) => old.id === dog.id && old.nightly_rate_cents === dog.rate));
      if ((direct || stayEdit) && selectedDogs.some((dog) => dog.rate === null)) {
        status.textContent = "กรุณาระบุราคาของสุนัขทุกตัวก่อนเช็กอิน";
        return;
      }
      const body = {customerId:Number(owner.value),service:service.value, checkin:checkin.value,checkout:checkout.value,
        quantity100,discountCents,
        dogs:selectedDogs,note:note.value,warningToken,wholeBaht:!samePrice || booking.rounding_cents > 0,
        key:direct ? draft?.key || key() : createBookingKey,revision:booking?.cloud_revision ?? null};
      if(stayEdit)Object.assign(body,{intake:stayIntake.values(),couponCode:couponCode.value,
        paymentSnapshot:booking.payment_snapshot});
      pendingSave = true;
      submit.disabled = true;
      try {
        const response = await fetch(stayEdit ? "/api/stays/"+booking.id : direct ? "/api/stays/check-in/preview" : "/api/bookings" + (booking ? "/" + booking.id : ""),{
          method:booking ? "PUT" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const result = await response.json();
        if (result.status === "warning") {
          warnings.replaceChildren(...result.warnings.map((value) => node("li",warningLabels[value] || value)));
          warnings.hidden = false;
          warningToken = result.token;
          status.textContent = "ตรวจคำเตือน แล้วเลือกแก้ข้อมูลหรือยืนยันบันทึก";
          submit.textContent = "ยืนยันบันทึกการจอง";
          submit.focus();
          return;
        }
        if (!response.ok) {
          status.textContent = response.status === 409
            ? "บันทึกไม่ได้ กรุณาตรวจยอดมัดจำหรือเปิดรายละเอียดล่าสุดอีกครั้ง" : "บันทึกไม่ได้ กรุณาตรวจวัน ราคา และสุนัข";
          return;
        }
        if(stayEdit){
          if(form.isConnected && bookingDialog.open)await showStay(booking.id);
          await load(true);message.textContent="บันทึกการเข้าพักแล้ว";return;
        }
        if (direct) {
          if (form.isConnected && bookingDialog.open) bookingCheckIn({...result,checkout:body.checkout,
            checkin:body.checkin,paid_cents:0,cloud_revision:null},body);
          return;
        }
        if (!booking) createBookingKey = undefined;
        if (form.isConnected && bookingDialog.open) await showBooking(result.id);
        if (selected === "bookings" || selected === "calendar") await load(true);
        message.textContent = "บันทึกการจองแล้ว";
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาตรวจรายการก่อนลองใหม่";
      } finally {
        pendingSave = false;
        submit.disabled = false;
      }
    });
    try {
      const response = await fetch("/api/bookings/rates",{signal:controller.signal});
      if (!response.ok) throw Error();
      rates = await response.json();
      if (initial) await loadDogs();
      else await searchOwners();
    } catch {
      if (!controller.signal.aborted) status.textContent = "โหลดการตั้งค่าราคาไม่ได้ กรุณาเปิดหน้าจอใหม่";
    }
  }

  function bookingActions(booking) {
    const actions = Object.assign(node("div"),{className:"record-actions"});
    const edit = Object.assign(node("button","แก้ไขการจอง"),{type:"button"});
    edit.addEventListener("click", () => bookingEditor(booking));
    const remove = Object.assign(node("button","ลบการจอง"),{type:"button",className:"delete-deposit"});
    remove.addEventListener("click", async () => {
      if (!confirm("ยืนยันลบการจองนี้หรือไม่?")) return;
      remove.disabled = true;
      const status = document.getElementById("booking-status");
      try {
        const response = await fetch("/api/bookings/" + booking.id,{method:"DELETE"});
        if (!response.ok) {
          status.textContent = response.status === 409 ? "กรุณาตรวจยอดมัดจำและสถานะเช็กอินก่อนลบ" : "ลบการจองไม่ได้";
          return;
        }
        if (remove.isConnected && bookingDialog.open) bookingDialog.close();
        if (selected === "bookings" || selected === "calendar") await load(true);
        message.textContent = "ลบการจองแล้ว";
      } catch {
        status.textContent = "ยังยืนยันการลบไม่ได้ กรุณาลองใหม่";
      } finally { remove.disabled = false; }
    });
    const checkIn = Object.assign(node("button","เช็กอิน"),{type:"button"});
    checkIn.disabled = booking.balance_cents === null;
    if (checkIn.disabled) checkIn.title = "กรุณาระบุราคาของสุนัขทุกตัวก่อนเช็กอิน";
    checkIn.addEventListener("click", () => bookingCheckIn(booking));
    actions.append(checkIn,edit,remove);
    return actions;
  }

  function checkInDetails(initial={}) {
    const panel = node("details");
    panel.className = "intake-details";
    panel.append(node("summary","รายละเอียดตอนเช็กอิน · ไม่บังคับกรอก"));
    const fields = [];
    for (const {title,fields:group} of intakeGroups) {
      const fieldset = node("fieldset");
      const grid = node("div");
      grid.className = "intake-grid";
      fieldset.append(node("legend",title),grid);
      for (const [field,label,kind] of group) {
        if (field === "health") continue;
        if (kind === "item") {
          const item = node("div");
          const box = Object.assign(node("input"),{type:"checkbox",checked:initial[field+"_packed"]=== "1"});
          const toggle = node("label",label);
          toggle.prepend(box);
          const detail = Object.assign(node("input"),{type:"text",maxLength:600,disabled:true});
          const detailLabel = node("label","รายละเอียด " + label);
          detailLabel.append(detail);
          detailLabel.hidden = !box.checked;
          detail.value=initial[field] || "";detail.disabled=!box.checked;
          box.addEventListener("change", () => { detail.disabled = detailLabel.hidden = !box.checked; });
          item.append(toggle,detailLabel);
          grid.append(item);
          fields.push([field,() => box.checked ? detail.value.trim() : ""],[field+"_packed",() => box.checked ? "1" : ""]);
        } else if (kind === "exam") {
          const item = node("div");
          const choices = node("div");
          choices.className = "intake-choice";
          item.append(node("strong",label),choices);
          const options = [];
          for (const [value,caption] of [["","ไม่ระบุ"],["normal","ปกติ"],["abnormal","พบความผิดปกติ"]]) {
            const radio = Object.assign(node("input"),{type:"radio",name:field,value,checked:value===(initial[field] || "")});
            const option = node("label",caption);
            option.prepend(radio);
            options.push(radio);
            choices.append(option);
          }
          fields.push([field,() => options.find((input) => input.checked)?.value || ""]);
          grid.append(item);
        } else {
          const input = typeof kind === "object" ? node("select") : node("textarea");
          if (typeof kind === "object") {
            input.append(new Option("ไม่ระบุ",""), ...Object.entries(kind).map(([value,caption]) => new Option(caption,value)));
          } else { input.rows = 2; input.maxLength = 600; }
          input.value=initial[field] || "";
          const wrapper = node("label",label);
          wrapper.append(input);
          fields.push([field,() => input.value.trim()]);
          grid.append(wrapper);
        }
      }
      panel.append(fieldset);
    }
    return {panel,values:() => Object.fromEntries(fields.map(([field,read]) => [field,read()]).filter(([,value]) => value))};
  }

  function showIntake(intake) {
    if (!intake || typeof intake !== "object") return null;
    const sections = [];
    for (const {title,fields} of intakeGroups) {
      const list = node("ul");
      for (const [field,label,kind] of fields) {
        const value = typeof intake[field] === "string" ? intake[field] : "";
        if (kind === "item" && !value && intake[field+"_packed"] !== "1") continue;
        if (kind !== "item" && !value) continue;
        const text = kind === "exam" ? ({normal:"ปกติ",abnormal:"พบความผิดปกติ","1":"ตรวจแล้ว"}[value] || value)
          : typeof kind === "object" && Object.hasOwn(kind,value) ? kind[value] : value;
        list.append(node("li", text ? label + " · " + text : label));
      }
      if (list.childElementCount) sections.push(node("h4",title),list);
    }
    if (!sections.length) return null;
    const panel = node("details");
    panel.className = "intake-details";
    panel.append(node("summary","รายละเอียดตอนเช็กอิน"),...sections);
    return panel;
  }

  function signatureCanvas() {
    const canvas = Object.assign(node("canvas"),{width:720,height:240,className:"signature-canvas"});
    canvas.setAttribute("aria-label","ช่องลายเซ็นลูกค้า");
    return canvas;
  }

  function paintSignature(canvas, strokes) {
    const context = canvas.getContext("2d");
    context.clearRect(0,0,canvas.width,canvas.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#203c30";
    for (const stroke of strokes) {
      if (!stroke.length) continue;
      context.beginPath();
      context.moveTo(...stroke[0]);
      for (const point of stroke.slice(1)) context.lineTo(...point);
      context.stroke();
    }
  }

  const couponErrors = {
    coupon_invalid:"กรุณากรอกรหัสคูปอง 6 หลัก",coupon_unavailable:"คูปองนี้ไม่พร้อมใช้งานหรือใช้ครบแล้ว",
    coupon_minimum:"ยอดค่าฝากไม่ถึงขั้นต่ำของคูปอง",coupon_exceeds:"ส่วนลดเกินยอดที่หักได้หลังตรวจยอดชำระเดิม",
  };
  function bookingCheckIn(booking, draft = null) {
    bookingDialog.classList.remove("care-workspace","record-workspace");
    bookingDialog.classList.remove("record-workspace");
    bookingDialog.classList.toggle("checkin-workspace",true);
    const endpoint = draft ? "/api/stays/check-in" : "/api/bookings/" + booking.id + "/check-in";
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    const form = Object.assign(node("form"),{className:"checkin-form"});
    const status = node("p","");
    status.setAttribute("role","status");
    const today = parts.format(new Date());
    const now = bangkokTime.format(new Date());
    function field(label,type,value,required=true) {
      const input = Object.assign(node("input"),{type,value,required});
      const wrapper = node("label",label);
      wrapper.append(input);
      form.append(wrapper);
      return input;
    }
    const arrival = field("วันที่เช็กอินจริง","date",draft ? draft.checkin : today);
    arrival.max = today < booking.checkout ? today : booking.checkout;
    const arrivalTime = field("เวลาเช็กอินจริง","time",now);
    const pickupDate = field("วันรับกลับ","date",booking.checkout);
    pickupDate.readOnly = true;
    const returnTime = field("เวลานัดรับกลับ","time",now,false);
    const amount = field("ยอดรับเพิ่ม (บาท)","number",(booking.balance_cents/100).toFixed(2));
    let coupon = null;
    let couponRequest = 0;
    Object.assign(amount,{min:"0",step:"0.01",max:(booking.balance_cents/100).toFixed(2)});
    const paymentDay = field("วันที่ชำระ","date",today);
    paymentDay.max = today;
    const paymentTime = field("เวลาชำระ","time",now);
    const stayTiming=Object.assign(node("section"),{className:"checkin-timing-grid"});
    for(const input of [arrival,arrivalTime,pickupDate,returnTime])stayTiming.append(input.parentElement);
    const payments=Object.assign(node("section"),{className:"checkin-payment-grid"});
    for(const input of [amount,paymentDay,paymentTime])payments.append(input.parentElement);
    const identity=Object.assign(node("section"),{className:"checkin-identity-summary"});
    const ownerInfo=node("p",booking.customer);
    const editCustomer=Object.assign(node("button","แก้ไขข้อมูลลูกค้า"),{type:"button",className:"secondary"});
    editCustomer.onclick=()=>showCustomer(booking.customer_id || draft.customerId);
    identity.append(node("h4","ลูกค้า"),ownerInfo,editCustomer);
    const dogInfo=Object.assign(node("div"),{className:"checkin-dog-summary"});
    for(const dog of booking.dogs || draft?.dogs || []){
      const row=Object.assign(node("div"),{className:"checkin-dog-summary-row"});
      const photo=Object.assign(node("img"),{className:"customer-dog-photo",alt:dog.name || "",
        src:"/api/customers/"+(booking.customer_id || draft.customerId)+"/dogs/"+dog.id+"/photo"});
      photo.onerror=()=>{photo.onerror=null;photo.src="/static/little-paws-icon.png";};
      row.dataset.dogId=dog.id;row.append(photo,node("strong",dog.name || ""));dogInfo.append(row);
    }
    identity.append(dogInfo);
    fetch("/api/customers/"+(booking.customer_id || draft.customerId),{signal:controller.signal}).then(response=>response.ok?response.json():null).then(data=>{
      if(data && !controller.signal.aborted){
        ownerInfo.textContent=[data.customer.name,data.customer.owner_phone,data.customer.line_id].filter(Boolean).join(" · ");
        for(const row of dogInfo.children){const dog=data.dogs.find(dog=>String(dog.id)===row.dataset.dogId);if(dog){row.querySelector("strong").textContent=dog.name;row.querySelector("img").alt=dog.name;}}
      }
    }).catch(()=>{});
    form.append(identity,stayTiming,payments);
    const couponPanel = node("section");
    couponPanel.className = "intake-details";
    const couponInput = Object.assign(node("input"),{type:"text",inputMode:"numeric",maxLength:6});
    const couponLabel = node("label","รหัสคูปอง");
    couponLabel.append(couponInput);
    const applyCoupon = Object.assign(node("button","ใช้คูปอง"),{type:"button"});
    const resetCoupon = Object.assign(node("button","นำคูปองออก"),{type:"button",hidden:true});
    const couponStatus = node("p","");
    couponStatus.setAttribute("role","status");
    couponPanel.append(couponLabel,applyCoupon,resetCoupon,couponStatus);
    form.append(couponPanel);
    const totalLine = node("p");
    const money = (cents) => baht.format(cents/100);
    function updateBill(nextCoupon) {
      const oldBalance = coupon?.balance_cents ?? booking.balance_cents;
      const newBalance = nextCoupon?.balance_cents ?? booking.balance_cents;
      if (Math.round(Number(amount.value)*100) === oldBalance || Number(amount.value)*100 > newBalance) {
        amount.value = (newBalance/100).toFixed(2);
      }
      amount.max = (newBalance/100).toFixed(2);
      coupon = nextCoupon;
      resetCoupon.hidden = !coupon;
      totalLine.textContent = "ยอดสุทธิ " + money(coupon?.total_cents ?? booking.total_cents) +
        " · รับมัดจำแล้ว " + money(booking.paid_cents) + " · คงเหลือ " + money(newBalance);
    }
    updateBill(null);
    resetCoupon.addEventListener("click",() => {
      couponRequest++;
      couponInput.value = "";
      applyCoupon.disabled = false;
      couponStatus.textContent = "";
      updateBill(null);
    });
    couponInput.addEventListener("input",() => {
      couponRequest++;
      applyCoupon.disabled = false;
      couponStatus.textContent = "";
      if (coupon) updateBill(null);
    });
    applyCoupon.addEventListener("click",async () => {
      const code = couponInput.value.trim();
      if (!/^\d{6}$/.test(code)) { couponStatus.textContent = couponErrors.coupon_invalid; return; }
      const request = ++couponRequest;
      applyCoupon.disabled = true;
      try {
        const response = await fetch("/api/stays/check-in/coupon",{
          method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
          body:JSON.stringify({code,bookingId:draft ? undefined : booking.id,draft:draft || undefined}),
        });
        const result = await response.json();
        if (request !== couponRequest || controller.signal.aborted) return;
        if (!response.ok) {
          couponStatus.textContent = couponErrors[result.status] || "ตรวจคูปองไม่ได้ กรุณาตรวจรายการ";
          updateBill(null);
          return;
        }
        updateBill({...result,code});
        couponStatus.textContent = "ส่วนลดคูปอง " + money(result.discount_cents);
      } catch {
        if (request === couponRequest && !controller.signal.aborted) couponStatus.textContent = "ตรวจคูปองไม่ได้ กรุณาลองใหม่";
      } finally {
        if (request === couponRequest) applyCoupon.disabled = false;
      }
    });
    const termsBox = node("section");
    termsBox.className = "checkin-terms";
    const picker = node("select");
    picker.append(new Option("ไทย","th"),new Option("English","en"));
    picker.value=document.documentElement.lang;
    const languageLabel = node("label","ภาษาเงื่อนไข");
    languageLabel.append(picker);
    const termsContent = node("div");
    termsBox.append(languageLabel,termsContent);

    const accept = Object.assign(node("input"),{type:"checkbox",required:true});
    const acknowledgement = node("span","ลูกค้ารับทราบและยอมรับเงื่อนไข");
    const acceptLabel = Object.assign(node("label"),{className:"care-share-opt-in checkin-acknowledgement"});
    acceptLabel.append(accept,acknowledgement);
    const signatureArea = node("section");
    signatureArea.className = "checkin-signature";
    const canvas = signatureCanvas();
    const clear = Object.assign(node("button","ล้างลายเซ็น"),{type:"button"});
    signatureArea.append(node("h4","ลายเซ็นลูกค้า"),canvas,clear);
    const submit = node("button","ยืนยันเช็กอิน");
    submit.disabled = true;
    const back = Object.assign(node("button",draft ? "กลับไปแก้รายละเอียด" : "กลับไปดูการจอง"),{type:"button"});
    back.addEventListener("click", () => draft ? bookingEditor(null,true,{draft,customer:booking.customer}) : showBooking(booking.id));
    const intakeForm = checkInDetails();
    const warnings = node("ul");
    warnings.className = "booking-warnings";
    warnings.hidden = true;
    let warningToken;
    const resetWarning = () => { warningToken = undefined; warnings.hidden = true; submit.textContent = "ยืนยันเช็กอิน"; };
    arrival.addEventListener("change",resetWarning);
    intakeForm.panel.open = true;
    totalLine.className = "checkin-bill-summary";
    const footer = Object.assign(node("div"),{className:"actions checkin-form-actions"});
    back.classList.add("secondary");
    footer.append(back,submit);
    form.append(intakeForm.panel,termsBox,acceptLabel,signatureArea,warnings,footer,status);
    bookingContent.replaceChildren(node("h3","เช็กอิน · " + booking.customer),totalLine,form);

    const strokes = [];
    let active = null;
    let points = 0;
    const clearSignature = () => {
      strokes.length = 0;
      active = null;
      points = 0;
      paintSignature(canvas,strokes);
    };
    clear.addEventListener("click",clearSignature);
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return [Math.round(Math.max(0,Math.min(720,(event.clientX-rect.left)*720/rect.width))),
        Math.round(Math.max(0,Math.min(240,(event.clientY-rect.top)*240/rect.height)))];
    }
    canvas.addEventListener("pointerdown",(event) => {
      if (active !== null || event.button !== 0 || strokes.length >= 150 || points >= 4000) return;
      if (event.pointerType === "touch" && (event.width > 40 || event.height > 40)) return;
      event.preventDefault();
      active = event.pointerId;
      canvas.setPointerCapture(active);
      strokes.push([point(event)]);
      points++;
    });
    canvas.addEventListener("pointermove",(event) => {
      if (event.pointerId !== active || points >= 4000) return;
      const stroke = strokes.at(-1);
      const next = point(event);
      const previous = stroke.at(-1);
      if (next[0] === previous[0] && next[1] === previous[1]) return;
      stroke.push(next);
      points++;
      const context = canvas.getContext("2d");
      context.lineWidth = 3;
      context.lineCap = "round";
      context.strokeStyle = "#203c30";
      context.beginPath();
      context.moveTo(...previous);
      context.lineTo(...next);
      context.stroke();
    });
    for (const event of ["pointerup","pointercancel","lostpointercapture"]) {
      canvas.addEventListener(event,(pointer) => { if (pointer.pointerId === active) active = null; });
    }
    canvas.addEventListener("contextmenu",(event) => event.preventDefault());

    let termsVersion;
    let termsRequest = 0;
    async function loadTerms() {
      const request = ++termsRequest;
      const lang = picker.value;
      termsVersion = null;
      accept.checked = false;
      clearSignature();
      acknowledgement.textContent = lang === "en" ? "I have read and accept the boarding terms."
        : "ลูกค้ารับทราบและยอมรับเงื่อนไข";
      submit.disabled = true;
      termsContent.replaceChildren(node("p","กำลังโหลดเงื่อนไข…"));
      try {
        const response = await fetch(endpoint + "?lang=" + lang,{signal:controller.signal});
        if (!response.ok) throw Error();
        const data = await response.json();
        if (request !== termsRequest || controller.signal.aborted) return;
        termsVersion = data.version;
        const details = node("details");
        details.open = true;
        details.append(node("summary",data.terms.title),node("p",data.terms.business),node("p",data.terms.intro));
        for (const section of data.terms.sections) {
          const list = node("ul");
          for (const item of section.items) list.append(node("li",item));
          details.append(node("h4",section.heading),list);
        }
        termsContent.replaceChildren(details);
        submit.disabled = false;
      } catch {
        if (!controller.signal.aborted && request === termsRequest) {
          const retry = Object.assign(node("button","โหลดเงื่อนไขอีกครั้ง"),{type:"button"});
          retry.addEventListener("click",loadTerms);
          termsContent.replaceChildren(retry);
        }
      }
    }
    picker.addEventListener("change",loadTerms);
    loadTerms();

    const paymentKey = draft?.key || key();
    let saving = false;
    form.addEventListener("submit",async (event) => {
      event.preventDefault();
      if (saving || !termsVersion) return;
      if (couponInput.value.trim() && (!coupon || couponInput.value.trim() !== coupon.code)) {
        status.textContent = "กดใช้คูปองก่อนเช็กอิน หรือล้างรหัสคูปอง";
        return;
      }
      if (!strokes.some((stroke) => stroke.length > 1)) { status.textContent = "กรุณาให้ลูกค้าเซ็นลายเซ็น"; return; }
      saving = true;
      submit.disabled = true;
      const body = {language:picker.value,version:termsVersion,accepted:accept.checked,signature:strokes,
        revision:booking.cloud_revision, arrivalDay:arrival.value,arrivalTime:arrivalTime.value,pickupTime:returnTime.value,
        expectedBalance:coupon?.balance_cents ?? booking.balance_cents,couponCode:coupon?.code,amountCents:Math.round(Number(amount.value)*100),
        paymentDate:paymentDay.value,receivedTime:paymentTime.value,key:paymentKey,intake:intakeForm.values(),draft,warningToken};
      try {
        const response = await fetch(endpoint,{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const result = await response.json();
        if (result.status === "warning") {
          warnings.replaceChildren(...result.warnings.map((value) => node("li",warningLabels[value] || value)));
          warnings.hidden = false;
          warningToken = result.token;
          submit.textContent = "ยืนยันเช็กอินตามคำเตือน";
          status.textContent = "ตรวจคำเตือน แล้วเลือกแก้รายละเอียดหรือยืนยัน";
          return;
        }
        if (!response.ok) {
          status.textContent = couponErrors[result.status] || (result.status === "conflict" ? "ราคา คูปอง หรือยอดมัดจำเปลี่ยนแล้ว กรุณาตรวจรายละเอียดล่าสุด"
            : result.status === "consent_required" ? "กรุณาตรวจการยอมรับเงื่อนไขและลายเซ็น"
            : "เช็กอินไม่ได้ กรุณาตรวจวัน เวลา และยอดรับชำระ");
          return;
        }
        if (form.isConnected && bookingDialog.open) await showStay(result.stayId);
        if (["calendar","bookings","current","outstanding","dashboard"].includes(selected)) await load(true);
        message.textContent = "เช็กอินแล้ว";
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาตรวจรายการหรือส่งข้อมูลเดิมอีกครั้ง";
      } finally {
        saving = false;
        submit.disabled = !termsVersion;
      }
    });
  }

  function careIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    for (const [key,value] of Object.entries({viewBox:"0 0 24 24",width:"20",height:"20",fill:"none",stroke:"currentColor","stroke-width":"1.8","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"})) svg.setAttribute(key,value);
    const path = document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d",name === "edit" ? "m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14Z" : "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7");
    svg.append(path); return svg;
  }

  function showCareTimeline(stayId, dog, initialAction = null) {
    bookingDialog.classList.remove("checkin-workspace","record-workspace");
    bookingDialog.classList.add("care-workspace");
    if (!bookingDialog.open) bookingDialog.showModal();
    document.getElementById("booking-status").textContent = "";
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    const endpoint = "/api/stays/" + stayId + "/dogs/" + dog.id + "/timeline";
    const title = node("h3","ไทม์ไลน์ · " + dog.name);
    const toolbar = node("div");
    toolbar.className = "photo-actions";
    const back = Object.assign(node("button","กลับหน้าสรุป"),{type:"button"});
    back.onclick = () => showStay(stayId);
    const day = node("select");
    day.setAttribute("aria-label","วันที่ของกิจกรรม");
    const today = parts.format(new Date());
    day.append(new Option("วันนี้",today),new Option("ทุกวัน",""));
    const preview = Object.assign(node("button","ดูเฉพาะที่ลูกค้าเห็น"),{type:"button"});
    preview.setAttribute("aria-pressed","false");
    const dateControls = Object.assign(node("div"),{className:"care-date-controls"});
    const dateStrip = Object.assign(node("div"),{className:"care-date-strip"});
    dateControls.setAttribute("role","group");
    dateControls.setAttribute("aria-label","เลือกวันที่");
    day.hidden = true;
    const calendar = Object.assign(node("input"),{type:"date",value:today,max:today});
    calendar.setAttribute("aria-label","เลือกวันที่");
    calendar.onchange = () => {
      if (!calendar.value) return;
      if (![...day.options].some(option => option.value === calendar.value)) day.append(new Option(calendar.value,calendar.value));
      day.value = calendar.value;
      loadTimeline(true);
    };
    dateControls.append(dateStrip,calendar,day);
    toolbar.append(back,preview);
    function renderDates() {
      calendar.value = day.value || today;
      dateStrip.replaceChildren();
      for (const option of day.options) {
        const chip = Object.assign(node("button",option.value === "" ? "แสดงทั้งหมด" : option.textContent),{type:"button",className:"secondary"});
        chip.setAttribute("aria-pressed",String(option.value === day.value));
        chip.onclick = () => { day.value = option.value; loadTimeline(true); };
        dateStrip.append(chip);
      }
    }
    const sharing = node("section");
    sharing.className = "intake-details";
    const editor = Object.assign(node("dialog"),{className:"care-dialog care-activity-dialog"});
    editor.setAttribute("aria-label","บันทึกกิจกรรม");
    document.body.append(editor);
    controller.signal.addEventListener("abort",() => {editor.close(); editor.remove();},{once:true});

    const feed = node("section");
    const more = Object.assign(node("button","โหลดกิจกรรมเพิ่มเติม"),{type:"button",hidden:true});
    const status = node("p","กำลังโหลด…");
    status.setAttribute("role","status");
    const record = Object.assign(node("button","บันทึกกิจกรรม"),{type:"button",hidden:true});
    const heading = Object.assign(node("div"),{className:"heading"});
    heading.append(title,record);
    const timelinePanel = Object.assign(node("section"),{className:"card care-timeline"});
    timelinePanel.append(heading,dateControls,status,feed,more);
    sharing.classList.add("card","care-sharing");
    bookingContent.replaceChildren(toolbar,timelinePanel,sharing);
    let exportController;
    controller.signal.addEventListener("abort",() => exportController?.abort(),{once:true});
    let showingPublic = false;
    let next;
    let pending = false;
    let requestNumber = 0;
    function renderSharing(data) {
      sharing.replaceChildren(node("h4","แชร์ไทม์ไลน์ให้ลูกค้า"));
      if (data.has_link) sharing.append(node("p","จำนวนครั้งที่เปิดไทม์ไลน์ " +
        data.view_count.toLocaleString("th-TH") + " ครั้ง"));
      sharing.append(node("p","ลิงก์หมดอายุภายใน " + data.expiry_hours + " ชั่วโมงหลังเช็กเอาต์"));
      const controls = node("div");
      controls.className = "photo-actions";
      if (data.share_url) {
        const url = Object.assign(node("input"),{type:"url",value:data.share_url,readOnly:true});
        const label = node("label","ลิงก์สำหรับลูกค้า");
        label.append(url);
        sharing.append(label);
        const copy = Object.assign(node("button","คัดลอกลิงก์"),{type:"button"});
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(url.value);
            status.textContent = "คัดลอกลิงก์แล้ว";
          } catch {
            url.select();
            status.textContent = "เลือกข้อความลิงก์แล้ว แตะค้างเพื่อคัดลอก";
          }
        };
        controls.append(copy);
      } else if (!data.can_configure_link) {
        sharing.append(node("p","ยังไม่ได้ตั้งค่าที่อยู่ไทม์ไลน์ลูกค้า"));
      } else if (data.has_link && !data.can_share) sharing.append(node("p","ลิงก์หมดอายุหรือการเข้าพักถูกปิด"));
      function action(label,value,question,extra={}) {
        const button = Object.assign(node("button",label),{type:"button"});
        button.disabled = pending;
        button.onclick = async () => {
          if (pending || (question && !confirm(question))) return;
          pending = true;
          for (const item of controls.querySelectorAll("button")) item.disabled = true;
          try {
            const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:value,...extra})});
            if (!response.ok) throw Error();
            await loadTimeline(true);
            status.textContent = value === "publish-day" ? "แชร์กิจกรรมของวันที่เลือกแล้ว" : "อัปเดตลิงก์แล้ว";
          } catch { status.textContent = "อัปเดตลิงก์ไม่ได้ กรุณาตรวจสถานะแล้วลองใหม่"; }
          finally {
            pending = false;
            for (const item of sharing.querySelectorAll("button")) item.disabled = false;
          }
        };
        return button;
      }
      if (!data.has_link && data.can_share && data.can_configure_link) controls.append(action("สร้างลิงก์","create"));
      if (data.has_link) controls.append(action("ยกเลิกลิงก์","revoke","ยกเลิกลิงก์นี้หรือไม่?"));
      if (data.share_url && data.status === "checked_in" && day.value) {
        controls.append(action("แชร์กิจกรรมทั้งหมดของวันที่เลือก","publish-day",
          "แชร์ข้อความและรูปทั้งหมดของวันที่เลือกให้ลูกค้าเห็นหรือไม่?",{day:day.value}));
      }
      const refresh = Object.assign(node("button","อัปเดตยอดเปิด"),{type:"button"});
      refresh.onclick = () => loadTimeline(true);
      controls.append(refresh);
      exportController?.abort();
      exportController = new AbortController();
      sharing.append(controls,documentActions("care",stayId,exportController,null,{dogId:dog.id,day:day.value,today}));
    }
    async function submitCare(body) {
      const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)});
      if (!response.ok) throw Error(response.status === 409
        ? "รายการหรือสถานะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่" : "บันทึกไม่ได้ กรุณาตรวจวัน เวลา และรายละเอียด");
      return response.json();
    }
    function openEditor(options,event,templates={}) {
      const form = Object.assign(node("form"),{className:"form care-activity-form"});
      const activity = node("select");
      activity.required = true;
      activity.append(new Option("เลือกกิจกรรม",""));
      activity.append(...Object.entries(options).map(([id,label]) => new Option(translateLabel(label),id)));
      if (event) {
        const known = Object.keys(options).find((id) => options[id] === event.activity_label);
        if (!known && event.activity_label) activity.append(new Option(event.activity_label,"existing-activity"));
        activity.value = known || (event.activity_label ? "existing-activity" : event.kind);
      }
      const now = new Date();
      const recorded = event?.recorded_at;
      const date = Object.assign(node("input"),{type:"date",required:true,max:today,value:recorded?.slice(0,10) || today});
      const time = Object.assign(node("input"),{type:"time",required:true,value:recorded?.slice(11,16) || bangkokTime.format(now)});
      const note = Object.assign(node("textarea"),{rows:3,maxLength:500,value:event?.note || ""});
      const visible = Object.assign(node("input"),{type:"checkbox",checked:event ? Boolean(event.customer_visible) : true});
      const dateGrid = Object.assign(node("div"),{className:"formgrid"});
      for (const [caption,input] of [["วันที่กิจกรรม",date],["เวลากิจกรรม",time]]) {
        const label = node("label",caption); label.append(input); dateGrid.append(label);
      }
      form.append(dateGrid);
      for (const [caption,input] of [["ประเภทกิจกรรม",activity],["รายละเอียดเพิ่มเติม",note],
        ["แสดงข้อความและรูปกิจกรรมนี้ให้ลูกค้าเห็น",visible]]) {
        const label = node("label",caption);
        if(input === visible) {label.className="care-share-opt-in";label.prepend(input);} else label.append(input);
        form.append(label);
      }
      const suggestions=Object.assign(node("details"),{className:"care-note-templates"});
      suggestions.append(node("summary","เลือกข้อความแนะนำ"));
      const search=Object.assign(node("input"),{type:"search",placeholder:"ค้นหาข้อความแนะนำ"});
      search.setAttribute("aria-label","ค้นหาข้อความแนะนำ");
      const choices=Object.assign(node("div"),{className:"care-template-choices"});
      const hint=node("small","เลือกแล้วแก้ไขข้อความให้ตรงกับการดูแลจริงได้ก่อนบันทึก");
      suggestions.append(hint,search,choices);
      // Thai has no word boundaries: match compact text and short fragments as well as words.
      const normalize=value=>value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,"");
      function showSuggestions(){
        const query=normalize(search.value || note.value);
        const items=templates[activity.value] || [];
        const rank=text=>{
          const value=normalize(text);
          if(!query)return 1;
          if(value.includes(query))return 100;
          let score=0;
          for(let i=0;i<query.length-1;i++)if(value.includes(query.slice(i,i+2)))score++;
          return score;
        };
        const matched=items.map(text=>({text,score:rank(text)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
        choices.replaceChildren();
        for(const {text} of matched.slice(0,8)){
          const choose=Object.assign(node("button",text),{type:"button",className:"secondary care-template-choice"});
          choose.onclick=()=>{
            if(note.value.trim() && note.value!==text && !confirm("แทนที่รายละเอียดเพิ่มเติมด้วยข้อความนี้หรือไม่?"))return;
            note.value=text;search.value="";suggestions.open=false;note.focus();
          };
          choices.append(choose);
        }
        if(!matched.length)choices.append(node("p","ไม่พบข้อความแนะนำ สามารถพิมพ์รายละเอียดเองได้"));
      }
      activity.addEventListener("change",()=>{search.value="";showSuggestions();});
      search.addEventListener("input",showSuggestions);
      note.addEventListener("input",()=>{suggestions.open=Boolean(note.value.trim());showSuggestions();});
      suggestions.addEventListener("toggle",()=>{if(suggestions.open)showSuggestions();});
      note.parentElement.after(suggestions);showSuggestions();
      const attachments = node("fieldset");
      attachments.className = "intake-details";
      attachments.append(node("legend","รูปกิจกรรม · สูงสุด 4 รูป"));
      const removals = new Map();
      for (const photo of event?.photos || []) {
        const item = node("div");
        const image = Object.assign(node("img"),{src:endpoint+"/photos/"+photo.id,
          alt:"รูปกิจกรรมเดิม",loading:"lazy",className:"care-timeline-photo"});
        const check = Object.assign(node("input"),{type:"checkbox"});
        const remove = node("label","นำรูปนี้ออก");
        remove.prepend(check);
        item.append(image,remove);
        attachments.append(item);
        removals.set(check,photo);
      }
      const gallery = Object.assign(node("input"),{type:"file",accept:"image/*",multiple:true});
      const camera = Object.assign(node("input"),{type:"file",accept:"image/*"});
      camera.setAttribute("capture","environment");
      for (const [caption,input] of [["เลือกรูปจากเครื่อง",gallery],["📷 ถ่ายรูป",camera]]) {
        input.hidden = true;
        const choose = Object.assign(node("button",caption),{type:"button",className:"secondary care-file-action"});
        choose.onclick = () => input.click();
        const selected = node("small");
        selected.setAttribute("role","status");
        input.onchange=()=>{selected.textContent=Array.from(input.files).map(file=>file.name).join(", ");};
        attachments.append(input,choose,selected);
      }
      form.append(attachments);
      const submit = node("button","บันทึกกิจกรรม");
      const cancel = Object.assign(node("button","ยกเลิก"),{type:"button",className:"secondary"});
      cancel.onclick = () => editor.close();
      const outcome = node("p","");
      outcome.setAttribute("role","status");
      const actions = Object.assign(node("div"),{className:"actions"});
      actions.append(cancel,submit);
      form.append(outcome,actions);
      editor.setAttribute("aria-label",event ? "แก้ไขกิจกรรม" : "บันทึกกิจกรรม");
      editor.replaceChildren(node("h2",event ? "แก้ไขกิจกรรม" : "บันทึกกิจกรรม"),node("p",dog.name),form);
      editor.showModal();
      activity.focus();
      const createKey = key();
      let savedEvent;
      let photoWork;
      async function savePhotos() {
        const url = endpoint+"/events/"+savedEvent.eventId+"/photos";
        for (const photo of photoWork.remove) {
          const response = await fetch(url+"/"+photo.id,{method:"DELETE",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({key:photo.key,revision:savedEvent.revision})});
          if (!response.ok) throw Error();
        }
        for (const photo of photoWork.add) {
          const response = await fetch(url,{method:"POST",headers:{"Content-Type":"image/jpeg",
            "X-Event-Revision":savedEvent.revision,"X-Upload-Key":photo.key},body:photo.image});
          if (!response.ok) throw Error();
        }
      }
      form.onsubmit = async (action) => {
        action.preventDefault();
        submit.disabled = true;
        try {
          if (!savedEvent) {
            const files = [...gallery.files,...camera.files];
            const removed = [...removals].filter(([control]) => control.checked).map(([,photo]) => photo);
            if (files.length + removals.size - removed.length > 4) throw Error("แนบได้สูงสุด 4 รูปต่อกิจกรรม");
            const add = [];
            for (const file of files) add.push({image:await resizedPhoto(file),key:key()});
            photoWork = {add,remove:removed};
            savedEvent = await submitCare({action:event ? "edit-event" : "add-event",eventId:event?.id,
              revision:event?.revision,activity:activity.value,note:note.value,day:date.value,time:time.value,
              visible:visible.checked,key:createKey});
            for (const field of form.querySelectorAll("input,textarea,select")) field.disabled = true;
          }
          await savePhotos();
          if (form.isConnected && !controller.signal.aborted) {
            editor.close();
            editor.replaceChildren();
            if (day.value !== "" && day.value !== date.value) {
              if (![...day.options].some((entry) => entry.value === date.value)) {
                day.append(new Option(bookingDate.format(new Date(date.value)),date.value));
              }
              day.value = date.value;
            }
            await loadTimeline(true);
            status.textContent = "บันทึกกิจกรรมแล้ว";
          }
        } catch (error) {
          outcome.textContent = savedEvent ? "บันทึกกิจกรรมแล้ว แต่รูปบางรูปยังไม่สำเร็จ ลองส่งรูปอีกครั้ง" : error.message;
          if (savedEvent) submit.textContent = "ลองส่งรูปอีกครั้ง";
        } finally { submit.disabled = false; }
      };
    }
    async function loadTimeline(reset) {
      const loading = ++requestNumber;
      const selectedDay = day.value;
      const query = new URLSearchParams();
      if (selectedDay) query.set("day",selectedDay);
      if (showingPublic) query.set("preview","1");
      if (!reset && next) {
        query.set("before_at",next.recordedAt);
        query.set("before_id",next.id);
      }
      if (reset) { feed.replaceChildren(); next = null; }
      more.disabled = true;
      status.textContent = "กำลังโหลด…";
      try {
        const response = await fetch(endpoint+"?"+query,{signal:controller.signal});
        if (!response.ok) throw Error();
        const data = await response.json();
        if (loading !== requestNumber || controller.signal.aborted) return;
        renderSharing(data);
        record.hidden = showingPublic || data.status !== "checked_in";
        record.onclick = () => openEditor(data.options,null,data.templates);
        if (initialAction && !record.hidden) {
          const event = typeof initialAction === "object" ? data.events.find(event=>event.id===initialAction.eventId) : null;
          if(initialAction === "record" || event) {initialAction=null;openEditor(data.options,event,data.templates);}
        }
        const extraDays = [...new Set([selectedDay,...data.days])].filter((value) => value && value !== today).sort().reverse();
        day.replaceChildren(new Option("วันนี้",today),new Option("ทุกวัน",""),
          ...extraDays.map((value) => new Option(bookingDate.format(new Date(value)),value)));
        day.value = selectedDay;
        renderDates();
        for (const event of data.events) {
          const card = Object.assign(node("article"),{className:"care-event"});
          const eventHeading = Object.assign(node("div"),{className:"care-event-heading"});
          const eventCopy = Object.assign(node("div"),{className:"care-event-copy"});
          const eventMeta = Object.assign(node("div"),{className:"care-event-meta"});
          eventHeading.append(eventCopy);
          card.append(eventHeading);
          const moment = new Date(event.recorded_at);
          const local = Number.isFinite(moment.valueOf()) ? bangkokTime.format(moment) : "";
          const label = translateLabel(event.activity_label || {food:"ให้อาหารแล้ว",medicine:"ให้ยาแล้ว",custom:"กิจกรรมอื่น"}[event.kind] || "กิจกรรม");
          eventMeta.append(Object.assign(node("span",local),{className:"care-event-clock"}),node("strong",label));
          eventCopy.append(eventMeta);
          if (!selectedDay) eventCopy.append(Object.assign(node("small",bookingDate.format(new Date(event.recorded_at.slice(0,10)))),{className:"muted"}));
          if (!showingPublic) eventCopy.append(Object.assign(node("small",event.customer_visible ? "แชร์ให้ลูกค้าเห็น" : "สำหรับพนักงาน"),{className:"muted"}));
          if (event.note) eventCopy.append(Object.assign(node("p",event.note),{className:"care-event-note"}));
          if (event.photos.length) {
            const gallery = Object.assign(node("div"),{className:"care-media-gallery"});
            for (const photo of event.photos) {
              const link = Object.assign(node("a"),{href:endpoint+"/photos/"+photo.id});
              link.dataset.carePhoto = "";
              link.setAttribute("aria-haspopup","dialog");
              link.append(Object.assign(node("img"),{src:link.href,alt:"รูปกิจกรรม",loading:"lazy"}));
              gallery.append(link);
            }
            card.append(gallery);
          }
          if (!showingPublic && data.status === "checked_in") {
            const edit = Object.assign(node("button","แก้ไขกิจกรรม"),{type:"button"});
            const remove = Object.assign(node("button","ลบกิจกรรม"),{type:"button",className:"delete-deposit"});
            edit.onclick = () => openEditor(data.options,event,data.templates);
            remove.onclick = async () => {
              if (!confirm("ลบกิจกรรมนี้หรือไม่?")) return;
              remove.disabled = true;
              try {
                await submitCare({action:"remove-event",eventId:event.id,revision:event.revision});
                if (card.isConnected && !controller.signal.aborted) await loadTimeline(true);
              } catch (error) { status.textContent = error.message; }
              finally { remove.disabled = false; }
            };
            const actions = Object.assign(node("div"),{className:"care-event-actions"});
            for (const [button,icon] of [[edit,"edit"],[remove,"delete"]]) {
              button.setAttribute("aria-label",button.textContent);
              button.title = button.textContent;
              button.className = "appointment-icon " + (icon === "delete" ? "danger" : "secondary");
              button.replaceChildren(careIcon(icon));
            }
            actions.append(edit,remove); eventHeading.append(actions);
          }
          feed.append(card);
        }
        status.textContent = feed.querySelector("article") ? "" : "ยังไม่มีกิจกรรมในช่วงนี้";
        next = data.next;
        more.hidden = !next;
      } catch {
        if (loading === requestNumber && !controller.signal.aborted) status.textContent = "โหลดไทม์ไลน์ไม่ได้ กรุณาลองใหม่";
      } finally {
        if (loading === requestNumber) more.disabled = false;
      }
    }
    preview.onclick = () => {
      showingPublic = !showingPublic;
      preview.setAttribute("aria-pressed",showingPublic);
      preview.textContent = showingPublic ? "กลับไปดูกิจกรรมทั้งหมด" : "ดูเฉพาะที่ลูกค้าเห็น";
      loadTimeline(true);
    };
    day.onchange = () => loadTimeline(true);
    more.onclick = () => loadTimeline(false);
    loadTimeline(true);
  }

  function documentActions(kind,id,controller,paymentId=null,care=null) {
    const group = node("section");
    group.className = "intake-details document-tools";
    const heading = {stay:"เอกสารสรุปการเข้าพัก",booking:"ใบยืนยันการจอง",deposit:"ใบรับมัดจำ",care:"ส่งสรุปกิจกรรมที่แชร์ให้ลูกค้า"}[kind];
    group.append(node("h4",heading));
    const language = node("select");
    language.append(new Option("ไทย","th"),new Option("English","en"));
    language.value=document.documentElement.lang;
    const languageLabel = node("label","ภาษาเอกสาร");
    languageLabel.append(language);
    const base = care ? "/api/stays/"+id+"/dogs/"+care.dogId+"/timeline/export"
      : "/api/documents/"+kind+"/"+id+(paymentId === null ? "" : "/"+paymentId);
    const period = care ? node("select") : null;
    if (period) {
      if (care.day && care.day !== care.today) period.append(new Option("วันที่เลือก · "+bookingDate.format(new Date(care.day)),care.day));
      period.append(new Option("วันนี้",care.today),new Option("ทุกวัน","all"));
      period.value = care.day || "all";
    }
    const formatUrl = (kind) => base+"."+kind+"?"+new URLSearchParams(period
      ? {lang:language.value,day:period.value} : {lang:language.value});
    const print = Object.assign(node("a","เปิดแบบพิมพ์"),{href:formatUrl("html"),target:"_blank",rel:"noopener"});
    const actions = node("div");
    actions.className = "photo-actions";
    actions.append(languageLabel);
    if (period) {
      const field = node("label","ช่วงกิจกรรม");
      field.append(period);
      actions.append(field);
    }
    actions.append(print);
    group.append(actions);
    const preview = node("div");
    const status = node("p","");
    status.setAttribute("role","status");
    group.append(status,preview);
    let imageUrl;
    let generation = 0;
    function clearImage() {
      generation++;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = undefined;
      preview.replaceChildren();
    }
    controller.signal.addEventListener("abort",clearImage,{once:true});
    function refreshLinks() {
      print.href = formatUrl("html");
      status.textContent = "";
      clearImage();
    }
    language.addEventListener("change",refreshLinks);
    period?.addEventListener("change",refreshLinks);
    if (canExport) {
      const pdf = Object.assign(node("a","ดาวน์โหลด PDF"),{href:formatUrl("pdf"),target:"_blank",rel:"noopener"});
      const png = Object.assign(node("button","ดูรูป PNG"),{type:"button"});
      actions.append(pdf,png);
      const refreshPdf = () => { pdf.href = formatUrl("pdf"); };
      language.addEventListener("change",refreshPdf);
      period?.addEventListener("change",refreshPdf);
      png.onclick = async () => {
        clearImage();
        const attempt = generation;
        png.disabled = true;
        status.textContent = "กำลังสร้างรูป…";
        try {
          const response = await fetch(formatUrl("png"),{signal:controller.signal});
          if (response.status === 422) throw Error("รูปยาวหรือไฟล์แนบใหญ่เกินขนาด ลองเลือกวันเดียวหรือเปิดแบบพิมพ์");
          if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/png")) throw Error();
          const blob = await response.blob();
          if (attempt !== generation || controller.signal.aborted) return;
          imageUrl = URL.createObjectURL(blob);
          const img = Object.assign(node("img"),{src:imageUrl,alt:heading,className:"coupon-preview"});
          const documentRef = care ? id+"-"+care.dogId+"-"+period.value : id+(paymentId === null ? "" : "-"+paymentId);
          const fileName = "little-paws-"+kind+"-"+documentRef+"-"+language.value+".png";
          const download = Object.assign(node("a","ดาวน์โหลดรูป"),{href:imageUrl,download:fileName});
          preview.append(img,download,node("p","บนมือถือ แตะค้างที่รูปเพื่อบันทึกหรือแชร์"));
          status.textContent = "";
        } catch (error) {
          if (attempt === generation && !controller.signal.aborted) status.textContent =
            error.message || "สร้างรูปไม่ได้ กรุณาลองใหม่หรือเปิดแบบพิมพ์";
        } finally { png.disabled = false; }
      };
    }
    return group;
  }

  function stayPaymentDetails(stay,money,controller) {
    const view = Object.assign(node("section"),{className:"record-payment-history"});
    view.append(node("h4","ประวัติการชำระเงิน"));
    if (!stay.payments.length) view.append(node("p","ยังไม่มีรายการชำระ"));
    const locked = stay.status === "completed" || stay.status === "cancelled" || Boolean(stay.cancelled_at);
    const base = "/api/stays/" + stay.id;
    const day = (value) => bookingDate.format(new Date(value));
    const errors = {invalid:"กรุณาตรวจข้อมูลและระบุเหตุผล",forbidden:"บัญชีนี้ไม่มีสิทธิ์บันทึก",
      not_found:"ไม่พบรายการเข้าพัก",refund_exceeded:"ยอดคืนเกินยอดที่คืนได้",
      stay_closed:"แก้ไขได้เฉพาะการเข้าพักที่ยังไม่ได้เช็กเอาต์หรือยกเลิก",
      conflict:"รายการเปลี่ยนแล้ว กรุณาเปิดสรุปการเข้าพักใหม่"};

    async function mutate(path,method,body,control,status,success) {
      control.disabled = true;
      status.textContent = "กำลังบันทึก…";
      try {
        const response = await fetch(base+path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        if (controller.signal.aborted) return "closed";
        if (!response.ok) {
          const result = await response.json();
          status.textContent = errors[result.status] || "ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจรายการ";
          return response.status < 500 ? "rejected" : "uncertain";
        }
        if (["current","outstanding","history"].includes(selected)) await load(true);
        if (controller.signal.aborted) return "closed";
        await showStay(stay.id);
        document.getElementById("booking-status").textContent = success;
        return "saved";
      } catch {
        if (!controller.signal.aborted) status.textContent = "ยังยืนยันผลไม่ได้ กรุณาลองบันทึกรายการเดิมอีกครั้ง";
        return "uncertain";
      } finally { control.disabled = false; }
    }

    function reasonForm(label,submitText) {
      const form = Object.assign(node("form"),{className:"payment-correction"});
      const name = node("label",label);
      const reason = Object.assign(node("textarea"),{required:true,maxLength:500,rows:2});
      const submit = Object.assign(node("button",submitText),{type:"submit",className:"delete-deposit"});
      const status = node("p");
      status.setAttribute("role","status");
      name.append(reason);
      form.append(name,submit,status);
      return {form,reason,submit,status};
    }

    for (const payment of stay.payments) {
      const row = Object.assign(node("div"),{className:"payment-entry"});
      const text = node("p",[day(payment.occurred_on),payment.received_time,
        paymentLabels[payment.payment_type] || payment.payment_type,money(payment.amount_cents)].filter(Boolean).join(" · "));
      const label = "ลบรายการชำระเงิน " + money(payment.amount_cents);
      const remove = Object.assign(node("button"),{type:"button",disabled:locked,title:label,
        className:"delete-deposit payment-remove"});
      remove.setAttribute("aria-label",label);
      const ns = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(ns,"svg");
      for (const [name,value] of Object.entries({width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",
        stroke:"currentColor","stroke-width":"1.8","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"})) icon.setAttribute(name,value);
      const shape = document.createElementNS(ns,"path");
      shape.setAttribute("d","M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5");
      icon.append(shape);
      remove.append(icon);
      const {form,reason,submit,status} = reasonForm("เหตุผลที่ลบรายการ","ยืนยันลบรายการ");
      form.hidden = true;
      const requestKey = key();
      remove.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) reason.focus(); };
      form.onsubmit = (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        if (!reason.value.trim()) { status.textContent = "กรุณาระบุเหตุผล"; return; }
        mutate("/payments/"+payment.id,"DELETE",{requestKey,reason:reason.value,
          paymentKey:payment.payment_key,occurredOn:payment.occurred_on,receivedTime:payment.received_time,
          amountCents:payment.amount_cents,paymentType:payment.payment_type},submit,status,"ลบรายการชำระเงินแล้ว");
      };
      row.append(text,remove);
      view.append(row,form);
    }

    if (stay.payment_deletions.length) {
      const audit = Object.assign(node("details"),{className:"payment-correction"});
      audit.append(node("summary","ประวัติรายการชำระที่ลบแล้ว · " + stay.payment_deletions.length));
      for (const entry of stay.payment_deletions) {
        audit.append(node("p",[day(entry.occurred_on),paymentLabels[entry.payment_type] || entry.payment_type,
          money(entry.amount_cents),entry.reason].join(" · ")));
      }
      view.append(audit);
    }

    if (stay.cancelled_at) {
      const moment = new Date(stay.cancelled_at);
      const cancelledAt = Number.isFinite(moment.valueOf())
        ? [day(parts.format(moment)),bangkokTime.format(moment)] : [];
      view.append(node("h4","ยกเลิกรายการเข้าพัก"),
        node("p",[...cancelledAt,stay.cancel_reason].filter(Boolean).join(" · ")));
      if (stay.refunds.length) {
        view.append(node("h4","ประวัติการคืนเงิน"));
        for (const refund of stay.refunds) view.append(node("p",[day(refund.date),refund.received_time,
          money(Math.round(refund.amount*100)),refund.note].filter(Boolean).join(" · ")));
      }
      if (stay.refundable_cents > 0) {
        const {form,reason,submit,status} = reasonForm("เหตุผลที่คืนเงิน","บันทึกคืนเงิน");
        const today = parts.format(new Date());
        const amount = Object.assign(node("input"),{type:"number",min:".01",max:(stay.refundable_cents/100).toFixed(2),step:".01",required:true});
        const date = Object.assign(node("input"),{type:"date",value:today,max:today,required:true});
        const amountLabel = node("label","ยอดคืนเงิน (บาท)");
        const dateLabel = node("label","วันที่คืนเงิน");
        amountLabel.append(amount);
        dateLabel.append(date);
        form.prepend(amountLabel,dateLabel);
        let pending = null;
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (submit.disabled) return;
          if (!reason.value.trim()) { status.textContent = "กรุณาระบุเหตุผล"; return; }
          pending ||= {amountCents:Math.round(amount.valueAsNumber*100),paymentDate:date.value,key:key(),reason:reason.value};
          for (const input of [amount,date,reason]) input.readOnly = true;
          const result = await mutate("/refund","POST",pending,submit,status,"บันทึกคืนเงินแล้ว");
          if (result === "rejected") {
            pending = null;
            for (const input of [amount,date,reason]) input.readOnly = false;
          }
        };
        view.append(node("strong","ยอดที่คืนได้ " + money(stay.refundable_cents)),form);
      }
    } else if (locked) {
      view.append(Object.assign(node("button","ยกเลิกรายการเข้าพัก"),{type:"button",disabled:true}));
    } else {
      const section = Object.assign(node("details"),{className:"payment-correction"});
      const {form,reason,submit,status} = reasonForm("เหตุผลที่ยกเลิก","ยืนยันยกเลิกการเข้าพัก");
      form.onsubmit = (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        if (!reason.value.trim()) { status.textContent = "กรุณาระบุเหตุผล"; return; }
        if (confirm("ยืนยันยกเลิกการเข้าพักและรายการชำระเงินที่เกี่ยวข้องหรือไม่?")) {
          mutate("/cancel","POST",{reason:reason.value},submit,status,"ยกเลิกการเข้าพักและรายการชำระแล้ว");
        }
      };
      section.append(node("summary","ยกเลิกรายการเข้าพัก"),form);
      view.append(section);
    }
    return view;
  }

  function recordHeading(title,subtitle,state,kind) {
    const heading=Object.assign(node("div"),{className:"record-heading"});
    const copy=node("div");copy.append(node("h3",title),node("p",subtitle));
    const badge=Object.assign(node("span",state || ""),{className:"record-badge"});badge.dataset.state=kind || "";
    heading.append(copy,badge);return heading;
  }
  function recordFacts(record,service,unit) {
    const facts=Object.assign(node("dl"),{className:"record-facts"});
    const refs=[record.stay_number,record.booking_number].filter(Boolean).join(" / ") || "—";
    for(const [label,value] of [["ลูกค้า",record.customer],["หมายเลขอ้างอิง",refs],
      ["วันเข้าพัก",bookingDate.format(new Date(record.checkin))],["วันรับกลับ",bookingDate.format(new Date(record.checkout))],
      ["ประเภทบริการ",service],[unit === "เดือน" ? "จำนวนเดือน" : "จำนวนวัน",record.charged_nights+" "+unit]]){
      const item=node("div");item.append(node("dt",label),node("dd",value));facts.append(item);
    }return facts;
  }
  function recordAmounts(entries) {
    const totals=Object.assign(node("div"),{className:"record-amounts"});
    for(const [label,value] of entries){const item=node("div");
      item.append(node("small",label),node("strong",value === null || value === undefined ? "—" : baht.format(value/100)));totals.append(item);
    }return totals;
  }
  function recordDogs(record,unit,timeline) {
    const list=Object.assign(node("ul"),{className:"record-dogs"});
    for(const dog of record.dogs){
      const item=node("li");const photo=Object.assign(node("img"),{alt:dog.name,loading:"lazy",src:"/api/customers/"+record.customer_id+"/dogs/"+dog.id+"/photo"});
      photo.onerror=()=>{photo.onerror=null;photo.src="/static/little-paws-icon.png";};
      const copy=node("div");copy.append(node("strong",dog.name),node("small",dog.nightly_rate_cents === null ? "รอระบุราคา" : baht.format(dog.nightly_rate_cents/100)+" / "+unit));
      item.append(photo,copy);
      if(timeline){const button=Object.assign(node("button","จัดการไทม์ไลน์"),{type:"button",className:"secondary"});button.onclick=()=>showCareTimeline(record.id,dog);item.append(button);}
      list.append(item);
    }return list;
  }

  async function showStay(id) {
    bookingDialog.classList.remove("care-workspace","record-workspace");
    bookingDialog.classList.toggle("checkin-workspace",false);
    bookingDialog.classList.add("record-workspace");
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    if (!bookingDialog.open) bookingDialog.showModal();
    bookingContent.replaceChildren(node("p","กำลังโหลด…"));
    document.getElementById("booking-status").textContent = "";
    try {
      const response = await fetch("/api/stays/" + id,{signal:controller.signal});
      if (!response.ok) throw Error();
      const stay = await response.json();
      if (controller.signal.aborted) return;
      const [service,unit] = services[stay.service_type] || [stay.service_type,"วัน"];
      const money = (cents) => baht.format(cents / 100);
      bookingContent.replaceChildren(recordHeading("สรุปการเข้าพัก",stay.customer,statuses[stay.status],stay.status),
        recordFacts(stay,service,unit),
        recordAmounts([["ยอดสุทธิ",stay.total_cents],["รับชำระแล้ว",stay.payments.reduce((sum,payment)=>sum+payment.amount_cents,0)],
          ["ยอดคงเหลือ",stay.status === "cancelled" ? null : stay.due_cents]]));
      if (stay.coupon_code) bookingContent.append(node("p","คูปอง " + stay.coupon_code +
        " · ส่วนลด " + money(stay.coupon_discount_cents)));
      for (const [label,value] of [["เช็กอินจริง",stay.actual_checkin_at],["เช็กเอาต์จริง",stay.actual_checkout_at]]) {
        if (!value) continue;
        const moment = new Date(value);
        if (!Number.isFinite(moment.valueOf())) continue;
        const display = value.length === 10 ? bookingDate.format(moment)
          : bookingDate.format(new Date(parts.format(moment))) + " · " + bangkokTime.format(moment);
        bookingContent.append(Object.assign(node("p",label + " " + display),{className:"record-actual-time"}));
      }
      bookingContent.append(node("h4","สุนัขที่เข้าพัก"),recordDogs(stay,unit,true));
      if(stay.note)bookingContent.append(node("p",stay.note));
      const intake = showIntake(stay.intake);
      if (intake) bookingContent.append(intake);
      bookingContent.append(stayPaymentDetails(stay,money,controller));
      if (canReceiveStayPayment(stay)) {
        const payment = stayPaymentForm(stay,async () => {
          if (["current","outstanding","history"].includes(selected)) await load(true);
          if (payment.isConnected && bookingDialog.open) {
            await showStay(stay.id);
            document.getElementById("booking-status").textContent = "บันทึกรับชำระแล้ว";
          }
        });
        bookingContent.append(payment);
        if (!qr.hidden) {
          bookingContent.append(Object.assign(node("a","เปิด QR สำหรับชำระเงิน"),{
            href:qr.href,target:"_blank",rel:"noopener",
          }));
        }
      }
      if (stay.timeline_views.length) {
        bookingContent.append(node("h4","จำนวนครั้งที่เปิดไทม์ไลน์"));
        for (const link of stay.timeline_views) {
          bookingContent.append(node("p",link.dog_name + " · " + link.view_count.toLocaleString("th-TH") + " ครั้ง"));
        }
      }
      if(!qr.hidden){
        const paymentQr=Object.assign(node("details"),{className:"record-qr"});
        const image=Object.assign(node("img"),{src:qr.href,alt:"QR สำหรับชำระเงิน",loading:"lazy"});
        paymentQr.append(node("summary","QR สำหรับชำระเงิน"),image);bookingContent.append(paymentQr);
      }
      bookingContent.append(documentActions("stay",stay.id,controller));
      const edit=Object.assign(node('button','แก้ไขการเข้าพัก'),{type:'button'});
      edit.disabled=stay.status!=='checked_in' || !!stay.cancelled_at;
      edit.onclick=()=>bookingEditor(stay,false,null,true);
      bookingContent.append(edit);
      const reopen=Object.assign(node('button','เช็กอินอีกครั้ง'),{type:'button'});
      reopen.disabled=stay.status!=='completed' || !!stay.cancelled_at;
      reopen.onclick=()=>{
        const form=node('form');form.className='payment-correction';
        form.append(node('h3','ยกเลิกเช็กเอาต์ · ยืนยันด้วยรหัสผ่านแอดมิน'));
        const username=Object.assign(node('input'),{required:true,maxLength:32,autocomplete:'username'});
        const password=Object.assign(node('input'),{type:'password',required:true,maxLength:128,autocomplete:'current-password'});
        for(const [label,input] of [['ชื่อผู้ใช้แอดมิน',username],['รหัสผ่านแอดมิน',password]]){
          const caption=node('label',label);caption.append(input);form.append(caption);
        }
        const save=node('button','ยืนยันเช็กอินอีกครั้ง');
        const cancel=Object.assign(node('button','กลับไปหน้าสรุป'),{type:'button'});cancel.onclick=()=>showStay(stay.id);
        const status=node('p');status.setAttribute('role','status');form.append(save,cancel,status);
        form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;
          try{const response=await fetch('/api/stays/'+stay.id+'/recheck-in',{method:'POST',
            headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});
            password.value='';
            if(!response.ok){status.textContent=response.status===429?'ลองหลายครั้ง กรุณารอ 1 นาที':
              response.status===401?'ชื่อผู้ใช้หรือรหัสผ่านแอดมินไม่ถูกต้อง':'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดสรุปล่าสุด';return;}
            await showStay(stay.id);await load(true);
          }catch{status.textContent='ยังยืนยันผลไม่ได้ กรุณาเปิดสรุปการเข้าพักล่าสุด';}finally{save.disabled=false;}};
        bookingContent.replaceChildren(form);username.focus();
      };
      if(stay.status==='completed')bookingContent.append(reopen);
      if (stay.consent) {
        bookingContent.append(node("h4","ลายเซ็นลูกค้า"),node("p",stay.consent.customer_name));
        const canvas = signatureCanvas();
        try { paintSignature(canvas,JSON.parse(stay.consent.signature)); bookingContent.append(canvas); } catch {}
      }
    } catch {
      if (!controller.signal.aborted) bookingContent.replaceChildren(node("p","โหลดสรุปการเข้าพักไม่ได้"));
    }
  }

  async function showBooking(id) {
    bookingDialog.classList.remove("care-workspace","checkin-workspace");
    bookingDialog.classList.add("record-workspace");
    document.getElementById("booking-status").textContent = "";
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
      bookingContent.replaceChildren(recordHeading("รายละเอียดการจอง",data.customer,state,data.stay_id ? "checked_in" : data.status),
        recordFacts(data,service,unit),recordAmounts([["ยอดรวม",data.total_cents],["รับชำระแล้ว",data.paid_cents],["ยอดคงเหลือ",data.balance_cents]]));
      if(data.contact)bookingContent.append(Object.assign(node("p",data.contact),{className:"record-contact"}));
      if (!data.stay_id && data.status === "pending") bookingContent.append(bookingActions(data));
      if (data.stay_id) {
        const stay = Object.assign(node("button","ดูสรุปการเข้าพัก"),{type:"button"});
        stay.addEventListener("click",() => showStay(data.stay_id));
        bookingContent.append(stay);
      }

      if (data.note) bookingContent.append(node("p", data.note));
      bookingContent.append(node("h3", "สุนัขที่จอง"));
      bookingContent.append(recordDogs(data,unit,false), node("h3", "การชำระเงิน"));
      if (!data.payments.length) bookingContent.append(node("p", "ยังไม่มีรายการชำระ"));
      for (const payment of data.payments) {
        const date = bookingDate.format(new Date(payment.occurred_on));
        const row = node("p", [date, payment.received_time, paymentLabels[payment.payment_type] || payment.payment_type,
          money(payment.amount_cents)].filter(Boolean).join(" · "));
        row.className="payment-entry";
        if (!data.stay_id && payment.payment_type === "deposit" && payment.payment_key) {
          row.append(depositDeleteButton(data.id, payment));
        }
        bookingContent.append(row);
        if (payment.payment_type === "deposit") bookingContent.append(documentActions("deposit",data.id,controller,payment.id));
      }
      if (pendingDeposits.has(data.id) || (!data.stay_id && data.status === "pending" && data.balance_cents !== 0)) {
        bookingContent.append(depositForm(data));
      }
      bookingContent.append(documentActions("booking",data.id,controller));
    } catch {
      if (!controller.signal.aborted) bookingContent.replaceChildren(node("p", "โหลดข้อมูลการจองไม่ได้ กรุณาลองใหม่"));
    }
  }

  function bookingForecastView(summary) {
    const view=Object.assign(node("section"),{className:"card booking-forecast"});
    view.setAttribute("aria-label","รายได้คาดการณ์จากการจอง");
    if(!summary)return view;
    view.append(node("h2","รายได้คาดการณ์จากการจอง"),node("p","การจองที่รอเช็กอินทั้งหมด · "+summary.booking_count+" รายการ"),
      recordAmounts([["ยอดจองรวม",summary.total_cents],["รับมัดจำแล้ว",summary.deposit_cents],["ยอดรอรับชำระ",summary.balance_cents]]),
      node("small","ยอดประมาณการหลังส่วนลด ไม่รวมรายการที่เช็กอินหรือยกเลิกแล้ว"));
    if(summary.unpriced_count) view.append(node("p","ยังไม่กำหนดราคา · "+summary.unpriced_count+" รายการ (ยังไม่รวมในยอดประมาณการ)"));
    return view;
  }
  function compactCardHeader(record,state,label,reference) {
    const header=recordHeading(record.customer,"",label,state);
    const copy=header.firstElementChild;
    copy.append(Object.assign(node("small",reference || "#"+record.id),{className:"record-reference"}));
    const content=Object.assign(node("div"),{className:"reservation-identity"});
    content.append(cardDogPhotos(record),header);
    return content;
  }

  function bookingCard(booking) {
    const article = Object.assign(node("article"),{className:"card reservation-card"});
    article.append(compactCardHeader(booking,"pending","รอเช็กอิน",booking.booking_number),
      Object.assign(node("p",[booking.checkin,booking.checkout].map(day=>bookingDate.format(new Date(day))).join(" – ")),{className:"reservation-period"}));
    article.append(recordAmounts([["ยอดรวม",booking.quote_pending ? null : booking.total_cents],
      ["รับมัดจำ",booking.deposit_cents],["ยอดคงเหลือ",booking.quote_pending ? null : Math.max(0,booking.total_cents-booking.deposit_cents)]]));
    const details=Object.assign(node("button","ดูการจอง"),{type:"button"});
    details.onclick=()=>showBooking(booking.id);
    const actions=Object.assign(node("div"),{className:"record-actions"});actions.append(details);article.append(actions);
    return article;
  }

  function card(stay) {
    const article = Object.assign(node("article"),{className:"card reservation-card"});
    article.append(compactCardHeader(stay,stay.status,statuses[stay.status] || stay.status,stay.stay_number));
    if (stay.checkin && stay.checkout) {
      const date = (value) => bookingDate.format(new Date(value+"T00:00:00Z"));
      article.append(Object.assign(node("p",date(stay.checkin) + " – " + date(stay.checkout)),{className:"reservation-period"}));
    }
    if (stay.due_cents > 0) article.append(Object.assign(node("strong","ค้างชำระ " + baht.format(stay.due_cents/100)),
      {className:"stay-due"}));
    const summary = Object.assign(node("button","ดูสรุปการเข้าพัก"),{type:"button"});
    summary.addEventListener("click",() => showStay(stay.id));
    const actions=Object.assign(node("div"),{className:"record-actions"});
    actions.append(summary);article.append(actions);
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
      checkout.className="secondary";
      actions.append(checkout);
    }
    if (canReceiveStayPayment(stay)) article.append(stayPaymentForm(stay,async () => {
      await load(true);
      message.textContent = "บันทึกรับชำระแล้ว";
    }));
    return article;
  }

  const pendingStayPayments = new Map();
  function canReceiveStayPayment(stay) {
    return stay.status !== "cancelled" && !stay.cancelled_at && (stay.due_cents > 0 || pendingStayPayments.has(stay.id));
  }

  function stayPaymentForm(stay, onSaved) {
    const form = Object.assign(node("form"),{className:"record-payment-form"});
    form.append(node("h4","รับชำระยอดคงเหลือ"));
    const pending = pendingStayPayments.get(stay.id);
    const now = new Date();
    const today = parts.format(now);
    const amount = Object.assign(node("input"), {type:"number",step:"0.01",min:"0.01",required:true,
      value:((pending?.amountCents ?? stay.due_cents)/100).toFixed(2)});
    if (!pending) amount.max = (stay.due_cents/100).toFixed(2);
    const date = Object.assign(node("input"),{type:"date",value:pending?.paymentDate || today,max:today,required:true});
    const time = Object.assign(node("input"),{type:"time",value:pending?.receivedTime || bangkokTime.format(now),required:true});
    for (const [label,input] of [["ยอดรับชำระ (บาท)",amount],["วันที่รับชำระ",date],["เวลารับชำระ",time]]) {
      const wrapper = node("label",label);
      wrapper.append(input);
      form.append(wrapper);
    }
    const status = node("p",pending ? "ส่งรายการเดิมอีกครั้งเพื่อยืนยันผล" : "");
    status.setAttribute("role","status");
    const button = node("button","บันทึกรับชำระ");
    form.append(button,status);
    form.addEventListener("submit",async (event) => {
      event.preventDefault();
      const submitted = {amountCents:Math.round(Number(amount.value)*100),paymentDate:date.value,receivedTime:time.value};
      const stored = pendingStayPayments.get(stay.id);
      if (stored && Object.keys(submitted).some((field) => submitted[field] !== stored[field])) {
        status.textContent = "กรุณาส่งยอด วันที่ และเวลาเดิมเพื่อยืนยันผลครั้งก่อน";
        return;
      }
      const attempt = stored || {...submitted,key:key()};
      pendingStayPayments.set(stay.id,attempt);
      button.disabled = true;
      try {
        const response = await fetch("/api/stays/" + stay.id + "/payments",{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(attempt),
        });
        const data = await response.json();
        if (response.ok) {
          pendingStayPayments.delete(stay.id);
          if (form.isConnected) await onSaved();
        } else {
          if (response.status < 500) pendingStayPayments.delete(stay.id);
          status.textContent = errors[data.status] || "บันทึกไม่ได้ กรุณาตรวจสอบและลองใหม่";
        }
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาลองส่งรายการเดิมอีกครั้ง";
      } finally {
        button.disabled = false;
      }
    });
    return form;
  }

  const couponAdmin = couponScreen({node,key,baht,results,message,thaiDate:bookingDate,
    reload:() => { message.textContent = ""; return load(true); },isActive:() => selected === "coupons"});
  const accounts = accountScreen({node,resizedPhoto});
  const backups=backupScreen({node,results,message,storedArchive,back:()=>setMode('settings')});
  const settingsAdmin = settingsScreen({node,results,message,themeLabels,thaiDate:bookingDate,openUsers:accounts.directory,
    reload:() => load(true),isActive:() => selected === "settings",openLedger:() => setMode("ledger"),
    applyTheme,openCoupons:() => setMode("coupons"),openReports:() => setMode("reports"),openBackup:()=>setMode('backup')});
  const ledger = ledgerScreen({translateLabel,node,results,message,reload:() => load(true),isActive:() => selected === "ledger",
    today:() => parts.format(new Date()),dateLabel:(day) => bookingDate.format(new Date(day)),key,baht,
    openStay:showStay,openBooking:showBooking,labels:ledgerKinds,categories:ledgerCategories});
  const reports = reportScreen({translateLabel,node,results,message,today:() => parts.format(new Date()),
    reload:() => load(true),isActive:() => selected === "reports",canExport,back:() => setMode("settings"),
    openRecord:({type,id}) => ({stay:showStay,booking:showBooking,customer:showCustomer,transaction:ledger.open})[type](id)});
  const dashboard = dashboardScreen({translateLabel,node,results,baht,today:() => parts.format(new Date()),
    dateLabel:(day) => bookingDate.format(new Date(day+"T00:00:00Z")),
    monthLabel:(month) => calendarMonth.format(new Date(month+"-01T00:00:00Z")),
    openStay:showStay,openCustomer:showCustomer,openTimeline:showCareTimeline,viewBooking:showBooking,setMode,activityIcon:careIcon,onCareChange:()=>load(true),
    checkInBooking:async (id) => {
      try {
        const response = await fetch("/api/bookings/"+id);
        if (!response.ok) throw Error();
        const booking = await response.json();
        if (booking.balance_cents === null) { await showBooking(id); return; }
        bookingRequest?.abort();
        bookingRequest = new AbortController();
        if (!bookingDialog.open) bookingDialog.showModal();
        bookingCheckIn(booking);
      } catch { message.textContent = "โหลดข้อมูลการจองไม่ได้ กรุณาลองใหม่"; }
    },
    checkout:async (id,button) => {
      if (!confirm("ยืนยันเช็กเอาต์สุนัขทุกตัวในรายการนี้หรือไม่?")) return;
      button.disabled = true;
      try {
        const response = await fetch("/api/stays/"+id+"/check-out",{method:"POST"});
        if (!response.ok) throw Error();
        if (selected === "dashboard") await load(true);
        message.textContent = "เช็กเอาต์แล้ว";
      } catch { message.textContent = "เช็กเอาต์ไม่สำเร็จ กรุณาตรวจสถานะแล้วลองใหม่"; }
      finally { button.disabled = false; }
    },
  });
  const screenTitles = {dashboard:["ภาพรวมธุรกิจ","รายรับ รายจ่าย และการเข้าพักของ Little Paws"],
    current:["ฝากเลี้ยง","บันทึกการเข้าพักและดูแลน้องหมา"],history:["ประวัติการเข้าพัก","ค้นหาการเข้าพักและตรวจยอดชำระ"],
    calendar:["การจอง","ปฏิทินการจองและข้อมูลรอเช็กอิน"],bookings:["การจอง","รายการจองทั้งหมดที่รอเช็กอิน"],
    customers:["ลูกค้า","ข้อมูลเจ้าของ น้องหมา และประวัติการเข้าพัก"],settings:["ตั้งค่าระบบ","ราคา วันหยุด ธีม และการตั้งค่าร้าน"],
    ledger:["รายรับ–รายจ่าย","รายการรับและจ่ายตามวันที่เงินจริง"],coupons:["คูปอง","สร้างและจัดการคูปองส่วนลด"],
    reports:["รายงาน","สรุปข้อมูลร้านและส่งออกรายงาน"],backup:['สำรองข้อมูล','ดาวน์โหลดข้อมูลและรูปสำหรับกู้คืน'],
    outstanding:["ยอดค้างชำระ","การเข้าพักที่รอรับชำระเพิ่มเติม"],finance:["ภาพรวมการเงิน","รายรับคงเหลือและรายจ่ายรายเดือน"]};
  function setMode(mode) {
    if (selected === mode) return;
    selected = mode;
    if (location.hash !== "#"+mode) history.pushState(null,"","#"+mode);
    couponAdmin.visible(selected === "coupons");
    ledger.visible(selected === "ledger");
    financeToolbar.hidden = !["finance","dashboard"].includes(selected);
    historyToolbar.hidden = selected !== "history";
    addBooking.hidden = selected !== "bookings" && selected !== "calendar";
    calendarToolbar.hidden = selected !== "calendar";
    addCustomer.hidden = selected !== "customers";
    document.getElementById("direct-checkin").hidden = selected !== "current";
    bookingSearch.hidden = selected !== "bookings" && selected !== "customers";
    searchLabel.textContent = selected === "customers" ? "ชื่อลูกค้าหรือชื่อสุนัข" : "เลขจอง ชื่อลูกค้า หรือชื่อสุนัข";
    bookingQuery.value = queries[selected] || "";
    const activeMode = ({backup:'settings',ledger:"settings",coupons:"settings",reports:"settings",bookings:"calendar",outstanding:"current",finance:"dashboard"})[mode] || mode;
    for (const option of modes) {
      option.setAttribute("aria-pressed",String(option.dataset.mode === mode));
      if (option.matches(".primary-nav a")) {
        if (option.dataset.mode === activeMode) option.setAttribute("aria-current","page");
        else option.removeAttribute("aria-current");
      }
    }
    const [title,subtitle] = screenTitles[mode];
    document.getElementById("screen-title").textContent = title;
    document.getElementById("screen-subtitle").textContent = subtitle;
    document.getElementById("stay-actions").hidden = !["current","history","outstanding"].includes(mode);
    document.getElementById("booking-tabs").hidden = !["calendar","bookings"].includes(mode);
    document.title = title+" · Little Paws Homestay Phuket";
    message.textContent = "";
    load(true);
  }
  for (const mode of modes) mode.addEventListener("click",(event) => {event.preventDefault();setMode(mode.dataset.mode);});
  document.getElementById("ledger-back").onclick = () => setMode("settings");
  const openStaffLedger = document.getElementById("open-staff-ledger");
  if (openStaffLedger) openStaffLedger.onclick = () => setMode("ledger");
  bookingDialog.addEventListener("close", () => {
    bookingRequest?.abort();
    if (["dashboard","reports"].includes(selected)) load(true);
  });
  customerDialog.addEventListener("close", () => {
    if (["dashboard","reports"].includes(selected)) load(true);
  });
  document.getElementById("ledger-editor").addEventListener("close",() => {
    if (selected === "reports") load(true);
  });
  document.getElementById("close-booking").addEventListener("click", () => bookingDialog.close());
  bookingSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    queries[selected] = bookingQuery.value;
    message.textContent = "";
    load(true);
  });
  more.addEventListener("click", () => load());
  function restoreNavigation() {
    const mode = location.hash.slice(1);
    if (Object.hasOwn(screenTitles,mode) &&
      (!["settings","coupons","reports","backup"].includes(mode) || document.querySelector(".nav-settings-icon"))) setMode(mode);
  }
  addEventListener("popstate",restoreNavigation);
  addEventListener("hashchange",restoreNavigation);
  restoreNavigation();
  if (selected === "dashboard") load();
}

export function outstandingPage(isAdmin = false,canExport = false,theme = "classic",displayName = "",language="th") {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(uiMarkup(`<!doctype html><html lang="${language}" data-theme="${themeName(theme)}"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ภาพรวมธุรกิจ · Little Paws Homestay Phuket</title>
    <link rel="icon" href="/static/little-paws-icon.png">
    <style nonce="${nonce}">${css}${careParityCss}${boardingBookingCss}${workspaceCss}</style>
    <link rel="stylesheet" href="/static/style.css?v=80">
    <style nonce="${nonce}">${macStyleBridge}\n${careGalleryCss}\n${compactBoardingCss}</style>
    <body class="staff-app" data-theme="${themeName(theme)}">
    ${staffHeader(theme,isAdmin,displayName,language)}
    <main>
    <div id="stay-actions" class="staff-subnav" hidden>
      <button type="button" data-mode="current" aria-pressed="false">กำลังเข้าพัก</button>
      <button type="button" data-mode="outstanding" aria-pressed="false">ยอดค้างชำระ</button>
    </div>
    <div id="booking-tabs" class="staff-subnav" role="group" aria-label="มุมมองการจอง" hidden>
      <button type="button" data-mode="calendar" aria-pressed="false">ปฏิทิน</button>
      <button type="button" data-mode="bookings" aria-pressed="false">รายการจองทั้งหมดที่รอเช็กอิน</button>
    </div>
    <form id="booking-search" hidden>
      <label><span id="directory-search-label">เลขจอง ชื่อลูกค้า หรือชื่อสุนัข</span><input type="search" maxlength="100" id="booking-query"></label>
      <button type="submit">ค้นหา</button>
    </form>
    <p id="page-actions"><button id="direct-checkin" type="button" hidden>บันทึกการเข้าพัก</button><button id="add-booking" type="button" hidden>สร้างการจอง</button><button id="add-customer" type="button" hidden>เพิ่มลูกค้า</button></p>
    <p><a id="payment-qr" href="/api/payment-qr.jpg" target="_blank" rel="noopener" hidden>เปิด QR สำหรับชำระเงิน</a></p>
    <div id="calendar-toolbar" class="calendar-toolbar" hidden>
      <button type="button" id="calendar-prev" aria-label="ก่อนหน้า">‹</button>
      <button type="button" id="calendar-today">วันนี้</button>
      <button type="button" id="calendar-next" aria-label="ถัดไป">›</button>
      <label>เลือกวันที่<input id="calendar-date" type="date"></label>
      <label>มุมมอง<select id="calendar-view"><option value="month">รายเดือน</option>
        <option value="week">รายสัปดาห์</option><option value="day">รายวัน</option></select></label>
      <strong id="calendar-title" aria-live="polite"></strong>
    </div>
    <div id="finance-home"><form id="finance-toolbar" hidden>
      <label>ตั้งแต่เดือน<input id="finance-from" type="month" required></label>
      <label>ถึงเดือน<input id="finance-to" type="month" required></label>
      <button>แสดงผล</button>
      ${isAdmin ? "" : '<button type="button" id="open-staff-ledger">รายรับ–รายจ่าย</button>'}
    </form></div>
    <section id="ledger-toolbar" hidden>
      <h2>รายรับ–รายจ่าย</h2>
      <div class="workspace-menu">
        <button type="button" id="ledger-back" ${isAdmin ? "" : "hidden"}>กลับไปหน้าตั้งค่า</button>
        <button type="button" id="ledger-add">เพิ่มรายการ</button>
        <button type="button" id="ledger-export">Export CSV ทั้งหมด</button>
      </div>
      <form id="ledger-filters">
        <label>ประเภท<select id="ledger-kind"><option value="all">ทั้งหมด</option><option value="income">รายรับ</option>
          <option value="expense">รายจ่าย</option><option value="refund">คืนเงิน</option></select></label>
        <label>ตั้งแต่<input id="ledger-start" type="date" required></label>
        <label>ถึง<input id="ledger-end" type="date" required></label>
        <button>แสดงรายการ</button>
        <button type="button" id="ledger-reset">เดือนปัจจุบัน</button>
      </form>
    </section>
    <form id="history-toolbar" hidden>
      <div class="history-status workspace-menu" role="group" aria-label="สถานะการเข้าพัก">
        <button type="button" data-status="all" aria-pressed="true">ทั้งหมด</button>
        <button type="button" data-status="checked_in" aria-pressed="false">กำลังเข้าพัก</button>
        <button type="button" data-status="completed" aria-pressed="false">กลับบ้านแล้ว</button>
      </div>
      <label>ตั้งแต่<input type="date" id="history-start" required></label>
      <label>ถึง<input type="date" id="history-end" required></label>
      <label>เลขเข้าพัก ชื่อลูกค้า หรือชื่อสุนัข<input type="search" id="history-search" maxlength="120"></label>
      <button>ค้นหา</button>
    </form>
    <div id="coupon-toolbar" class="calendar-toolbar" hidden>
      <label>สถานะคูปอง<select id="coupon-group"><option value="active">ใช้งานอยู่</option>
        <option value="used">ใช้แล้ว</option><option value="expired">หมดอายุ</option></select></label>
      <button id="coupon-add" type="button" disabled>สร้างคูปอง</button>
    </div>
    <p id="message" role="status"></p><div id="stays"></div>
    <button id="more" type="button" hidden>โหลดเพิ่มเติม</button></main>
    <dialog id="booking-detail" aria-labelledby="booking-title">
      <h2 id="booking-title">การจองและการเข้าพัก</h2><button type="button" id="close-booking" autofocus>ปิด</button>
      <p id="booking-status" role="status"></p>
      <div id="booking-content" aria-live="polite"></div>
    </dialog>
    <dialog id="customer-detail" aria-labelledby="customer-title">
      <h2 id="customer-title">ข้อมูลลูกค้า</h2><button type="button" id="close-customer" autofocus>ปิด</button>
      <p id="customer-status" role="status"></p>
      <div id="customer-content" aria-live="polite"></div>
    </dialog>
    <dialog id="coupon-dialog" aria-labelledby="coupon-title">
      <h2 id="coupon-title">จัดการคูปอง</h2><button type="button" id="coupon-close" autofocus>ปิด</button>
      <p id="coupon-status" role="status"></p><div id="coupon-content"></div>
    </dialog>
    <dialog id="ledger-editor" aria-labelledby="ledger-title">
      <h2 id="ledger-title">รายรับ–รายจ่าย</h2><button type="button" id="ledger-close" autofocus>ปิด</button>
      <div id="ledger-content" aria-live="polite"></div>
    </dialog>
    ${staffFooter}
    <script nonce="${nonce}">(${uiFunction("main",main,language)})(${JSON.stringify(uiValues(intakeGroups,language))},${uiFunction("couponScreen",couponScreen,language)},${uiFunction("settingsScreen",settingsScreen,language)},${uiFunction("ledgerScreen",ledgerScreen,language)},${uiFunction("dashboardScreen",dashboardScreen,language)},${uiFunction("reportScreen",reportScreen,language)},${applyStaffTheme.toString()},${JSON.stringify(uiValues(themes,language))},${JSON.stringify(uiValues(ledgerKinds,language))},${JSON.stringify(ledgerCategories)},${canExport},${installCarePhotoViewer.toString()},${uiFunction("accountScreen",accountScreen,language)},${uiFunction("backupScreen",backupScreen,language)},${storedArchive.toString()},${JSON.stringify(language==="en" ? fixedUiLabels : {})})</script></body></html>`,language), {
    headers: {
      "Content-Type":"text/html; charset=utf-8", "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
