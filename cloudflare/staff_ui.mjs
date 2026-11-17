const css = `
  body{font:1rem/1.5 "Sukhumvit Set",system-ui,sans-serif;background:#f2f7f3;color:#203c30;margin:0}
  main{margin:auto;max-width:52rem;padding:1rem}h1{margin:.2rem 0 1rem}
  article{background:#fff;border:1px solid #c8ded4;border-radius:1rem;margin:.6rem 0;padding:1rem}
  dialog{width:min(34rem,calc(100% - 4rem));max-height:80vh;padding:1rem;border:1px solid #a7cbb9;border-radius:1rem;color:inherit}
  .calendar-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin:1rem 0}
  .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.3rem}
  .calendar-grid[data-view="day"]{grid-template-columns:minmax(0,1fr)}
  .calendar-day{background:#fff;border:1px solid #c8ded4;border-radius:.55rem;min-width:0;padding:.35rem;min-height:4rem}
  .calendar-day[data-muted]{background:#eaf0eb;color:#476052}
  .calendar-day button{display:block;width:100%;margin:.2rem 0;padding:.25rem;text-align:start;overflow-wrap:anywhere;font-size:.85rem}
  .calendar-holiday{display:block;background:#fff1d9;color:#593d19;border-radius:.35rem;padding:.2rem;overflow-wrap:anywhere;font-size:.85rem}
  @media(max-width:37rem){.calendar-grid:not([data-view="day"]){grid-template-columns:repeat(7,minmax(0,1fr));gap:.15rem}.calendar-day{padding:.2rem}.calendar-day button{font-size:.72rem}}
  .checkin-terms{flex-basis:100%;border:1px solid #c8ded4;border-radius:.6rem;padding:.6rem}
  .checkin-signature{flex-basis:100%;min-width:0}
  .signature-canvas{display:block;width:100%;height:auto;border:1px solid #a7cbb9;border-radius:.55rem;background:white;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  .booking-warnings{flex-basis:100%;border:1px solid #d8ad6f;background:#fff7e9;color:#604119;border-radius:.7rem;padding:.55rem .65rem .55rem 2rem;margin:0}
  .photo-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0}
  .customer-dog-photo{width:6rem;height:6rem;object-fit:cover;border-radius:1rem}
  .delete-deposit{margin-inline-start:.75rem;background:#fff1ed;color:#8b3225;border-color:#e6a99b}
  dialog::backdrop{background:#203c3066}
  h2,p{margin:.15rem 0 .6rem}form{display:flex;flex-wrap:wrap;align-items:end;gap:.7rem}
  label{display:grid;gap:.2rem}input,textarea,select,button{font:inherit;padding:.55rem .7rem;border:1px solid #a7cbb9;border-radius:.6rem}
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
  const queries = {bookings:"", customers:""};
  const searchLabel = document.getElementById("directory-search-label");
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
      if (view === "month" && day.getUTCMonth() !== range.anchor.getUTCMonth()) cell.dataset.muted = "";
      cell.append(node("strong", calendarWeekday.format(day) + " " + calendarDay.format(day)));
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
        open.addEventListener("click", () => showBooking(booking.id));
        cell.append(open);
      }
      grid.append(cell);
    }
    results.replaceChildren(grid);
  }

  async function load(reset = false) {
    const requestId = ++requestNumber;
    if (reset) {
      cursor = null;
      results.replaceChildren();
    }
    more.disabled = true;
    try {
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
      const url = directory
        ? directoryPath + "?" + new URLSearchParams({after:cursor || 0, q:queries[selected]})
        : "/api/stays/" + selected + (cursor ? "?before=" + cursor : "");
      const response = await fetch(url);
      if (!response.ok) throw Error();
      const data = await response.json();
      if (requestId !== requestNumber) return;
      if (directory) {
        cursor = data.nextAfter;
        const render = selected === "bookings" ? bookingCard : customerCard;
        for (const record of data[selected]) results.append(render(record));
      } else {
        cursor = data.nextBefore;
        for (const stay of data.stays) results.append(card(stay));
      }
      if (!results.childElementCount) results.append(node("p", {
        customers:"ไม่พบลูกค้า", bookings:"ไม่พบการจองที่รอเช็กอิน", current:"ไม่มีสุนัขที่กำลังเข้าพัก", outstanding:"ไม่มียอดค้างชำระ",
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
  function customerEditor(customer) {
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
        if (form.isConnected && customerDialog.open) await showCustomer(result.id);
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

  function customerCard(customer) {
    const article = node("article");
    const details = Object.assign(node("button", "ดูข้อมูลลูกค้า"), {type:"button"});
    details.addEventListener("click", () => showCustomer(customer.id));
    article.append(node("h2", customer.name), node("p", "สุนัข " + customer.dog_count + " ตัว"), details);
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

  async function resizedDogPhoto(file) {
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
          const photo = await resizedDogPhoto(file);
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
    const item = node("article");
    item.append(node("h4", dog.name));
    if (dog.has_photo) {
      const photo = Object.assign(node("img"), {className:"customer-dog-photo", alt:dog.name, loading:"lazy"});
      photo.src = "/api/customers/" + customerId + "/dogs/" + dog.id + "/photo";
      item.append(photo);
    }
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
    item.append(photoActions(customerId, dog), edit, remove);
    return item;
  }

  async function showCustomer(id) {
    customerRequest?.abort();
    const controller = customerRequest = new AbortController();
    customerContent.replaceChildren(node("p", "กำลังโหลด…"));
    if (!customerDialog.open) customerDialog.showModal();
    document.getElementById("customer-status").textContent = "";
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
          customerContent.replaceChildren(node("h3", customer.name), edit, archive);
          for (const [label,value] of [["โทร",customer.owner_phone], ["Line ID / Facebook",customer.line_id],
            ["ที่อยู่ฉุกเฉิน",customer.emergency_address], ["หมายเหตุ",customer.note]]) {
            if (value) customerContent.append(node("p", label + " · " + value));
          }
          const addDog = Object.assign(node("button", "เพิ่มสุนัข"), {type:"button"});
          addDog.addEventListener("click", () => dogEditor(customer.id));
          customerContent.append(node("h3", "สุนัข"), addDog);
          for (const dog of data.dogs) customerContent.append(dogCard(customer.id, dog));
          if (!data.dogs.length) customerContent.append(node("p", "ยังไม่มีข้อมูลสุนัข"));
          customerContent.append(node("h3", "ประวัติการเข้าพัก"));
          if (!data.stays.length) customerContent.append(node("p", "ยังไม่มีประวัติการเข้าพัก"));
        }
        nextButton?.remove();
        for (const stay of data.stays) {
          const item = node("article");
          item.append(node("h4", [stay.stay_number || "#" + stay.id, statuses[stay.status] || stay.status].join(" · ")),
            node("p", stay.dogs || "—"),
            node("p", [stay.checkin, stay.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")));
          if (stay.due_cents > 0) item.append(node("strong", "ค้างชำระ " + baht.format(stay.due_cents / 100)));
          customerContent.append(item);
        }
        if (data.nextOffset !== null) {
          const moreHistory = Object.assign(node("button", "ดูประวัติเพิ่มเติม"), {type:"button"});
          moreHistory.addEventListener("click", () => loadHistory(data.nextOffset, moreHistory));
          customerContent.append(moreHistory);
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
        if (selected === "bookings" || selected === "calendar") await load(true);
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
  addBooking.addEventListener("click", () => bookingEditor());
  let createBookingKey;

  async function bookingEditor(booking) {
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    if (!bookingDialog.open) bookingDialog.showModal();
    const status = node("p", "");
    status.setAttribute("role","status");
    const today = parts.format(new Date());
    const form = node("form");
    const submit = node("button","บันทึกการจอง");
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
    const dogs = node("fieldset");
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
    } else form.append(search,searchButton);
    form.append(ownerGroup);
    const service = node("select");
    for (const [value,[label]] of Object.entries(services)) service.append(new Option(label,value));
    service.value = booking?.service_type || "overnight";
    const serviceLabel = node("label","ประเภทบริการ");
    serviceLabel.append(service);
    form.append(serviceLabel);
    const defaultDay = selected === "calendar" ? calendarAnchor.value || today : today;
    const checkin = field("วันเข้าพัก","date",booking?.checkin || defaultDay);
    const checkout = field("วันรับกลับ","date",booking?.checkout || defaultDay);
    const quantity = field("จำนวนวัน / เดือน","number",booking?.charged_nights ?? 1);
    const discount = field("ส่วนลด (บาท)","number",(booking?.discount_cents || 0)/100);
    const note = field("หมายเหตุ","text",booking?.note || "");
    note.maxLength = 800;
    quantity.min = discount.min = "0";
    discount.step = "0.01";
    checkin.required = checkout.required = quantity.required = true;
    form.append(dogs,warnings,submit,status);
    bookingContent.replaceChildren(node("h3",booking ? "แก้ไขการจอง" : "สร้างการจอง"),form);
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
        owner.replaceChildren(new Option("เลือกลูกค้า",""), ...result.customers.map((c) => new Option(c.name,c.id)));
        dogs.replaceChildren(node("legend","สุนัขและราคา"));
        choices.clear();
        submit.disabled = true;
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
      dogs.replaceChildren(node("legend","สุนัขและราคา"));
      choices.clear();
      if (!owner.value) return;
      const existing = new Map((booking?.dogs || []).map((dog) => [dog.id,dog]));
      let available = [];
      try {
        const response = await fetch("/api/customers/" + owner.value,{signal:controller.signal});
        if (response.ok) available = (await response.json()).dogs;
        else if (!booking || response.status !== 404) throw Error();
      } catch {
        if (!controller.signal.aborted && call === requestId) status.textContent = "โหลดรายชื่อสุนัขไม่ได้";
        return;
      }
      if (controller.signal.aborted || call !== requestId) return;
      const allDogs = new Map(available.map((dog) => [dog.id,dog]));
      for (const dog of existing.values()) if (!allDogs.has(dog.id)) allDogs.set(dog.id,dog);
      for (const dog of allDogs.values()) {
        const original = existing.get(dog.id);
        const include = Object.assign(node("input"),{type:"checkbox",checked:!!original});
        const rate = Object.assign(node("input"),{type:"number",min:"0",max:"999999.99",step:"0.01",
          value:original ? (original.nightly_rate_cents === null ? "" : original.nightly_rate_cents / 100)
            : rates?.[service.value]?.[dog.size] ?? ""});
        const row = node("div");
        const dogLabel = node("label", dog.name);
        dogLabel.prepend(include);
        const priceLabel = node("label","ราคา (บาท)");
        priceLabel.append(rate);
        row.append(dogLabel,priceLabel);
        dogs.append(row);
        choices.set(dog.id,{dog,include,rate});
      }
      submit.disabled = choices.size === 0;
    }
    owner.addEventListener("change", loadDogs);
    function clearWarnings() {
      warningToken = null;
      warnings.replaceChildren();
      warnings.hidden = true;
      submit.textContent = "บันทึกการจอง";
    }
    form.addEventListener("input",clearWarnings);
    owner.addEventListener("change",clearWarnings);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pendingSave) return;
      const selectedDogs = [...choices].filter(([,entry]) => entry.include.checked)
        .map(([id,{rate}]) => ({id, rate:rate.value === "" ? null : Math.round(Number(rate.value)*100)}));
      if (!selectedDogs.length) { status.textContent = "กรุณาเลือกสุนัขอย่างน้อยหนึ่งตัว"; return; }
      if (!booking) createBookingKey ??= key();
      const quantity100 = Math.round(Number(quantity.value)*100);
      const discountCents = Math.round(Number(discount.value)*100);
      const samePrice = booking && quantity100 === Math.round(booking.charged_nights*100) &&
        discountCents === booking.discount_cents && selectedDogs.length === booking.dogs.length &&
        selectedDogs.every((dog) => booking.dogs.some((old) => old.id === dog.id && old.nightly_rate_cents === dog.rate));
      const body = {customerId:Number(owner.value),service:service.value, checkin:checkin.value,checkout:checkout.value,
        quantity100,discountCents,
        dogs:selectedDogs,note:note.value,warningToken,wholeBaht:!samePrice || booking.rounding_cents > 0,key:createBookingKey,revision:booking?.cloud_revision ?? null};
      pendingSave = true;
      submit.disabled = true;
      try {
        const response = await fetch("/api/bookings" + (booking ? "/" + booking.id : ""),{
          method:booking ? "PUT" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const result = await response.json();
        if (result.status === "warning") {
          const labels = {holiday:"ช่วงที่เลือกตรงกับวันหยุดร้าน", overlap:"สุนัขมีรายการอื่นทับช่วงวันที่เลือก",
            capacity:"จำนวนสุนัขเกินความจุที่ตั้งไว้"};
          warnings.replaceChildren(...result.warnings.map((value) => node("li",labels[value] || value)));
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
      if (booking) await loadDogs();
      else await searchOwners();
    } catch {
      if (!controller.signal.aborted) status.textContent = "โหลดการตั้งค่าราคาไม่ได้ กรุณาเปิดหน้าจอใหม่";
    }
  }

  function bookingActions(booking) {
    const actions = node("div");
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

  function bookingCheckIn(booking) {
    bookingRequest?.abort();
    const controller = bookingRequest = new AbortController();
    const form = node("form");
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
    const arrival = field("วันที่เช็กอินจริง","date",today);
    arrival.max = today < booking.checkout ? today : booking.checkout;
    const arrivalTime = field("เวลาเช็กอินจริง","time",now);
    const returnTime = field("เวลานัดรับกลับ","time","",false);
    const amount = field("ยอดรับเพิ่ม (บาท)","number",(booking.balance_cents/100).toFixed(2));
    Object.assign(amount,{min:"0",step:"0.01",max:(booking.balance_cents/100).toFixed(2)});
    const paymentDay = field("วันที่ชำระ","date",today);
    paymentDay.max = today;
    const paymentTime = field("เวลาชำระ","time",now);
    const termsBox = node("section");
    termsBox.className = "checkin-terms";
    const picker = node("select");
    picker.append(new Option("ไทย","th"),new Option("English","en"));
    const languageLabel = node("label","ภาษาเงื่อนไข");
    languageLabel.append(picker);
    const termsContent = node("div");
    termsBox.append(languageLabel,termsContent);

    const accept = Object.assign(node("input"),{type:"checkbox",required:true});
    const acknowledgement = node("span","ลูกค้ารับทราบและยอมรับเงื่อนไข");
    const acceptLabel = node("label");
    acceptLabel.append(accept,acknowledgement);
    const signatureArea = node("section");
    signatureArea.className = "checkin-signature";
    const canvas = signatureCanvas();
    const clear = Object.assign(node("button","ล้างลายเซ็น"),{type:"button"});
    signatureArea.append(node("h4","ลายเซ็นลูกค้า"),canvas,clear);
    const submit = node("button","ยืนยันเช็กอิน");
    submit.disabled = true;
    const back = Object.assign(node("button","กลับไปดูการจอง"),{type:"button"});
    back.addEventListener("click", () => showBooking(booking.id));
    form.append(termsBox,acceptLabel,signatureArea,submit,back,status);
    bookingContent.replaceChildren(node("h3","เช็กอิน · " + booking.customer),
      node("p","ยอดสุทธิ " + baht.format(booking.total_cents/100) +
        " · รับมัดจำแล้ว " + baht.format(booking.paid_cents/100) +
        " · คงเหลือ " + baht.format(booking.balance_cents/100)),form);

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
        const response = await fetch("/api/bookings/" + booking.id + "/check-in?lang=" + lang,{signal:controller.signal});
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

    const paymentKey = key();
    let saving = false;
    form.addEventListener("submit",async (event) => {
      event.preventDefault();
      if (saving || !termsVersion) return;
      if (!strokes.some((stroke) => stroke.length > 1)) { status.textContent = "กรุณาให้ลูกค้าเซ็นลายเซ็น"; return; }
      saving = true;
      submit.disabled = true;
      const body = {language:picker.value,version:termsVersion,accepted:accept.checked,signature:strokes,
        revision:booking.cloud_revision, arrivalDay:arrival.value,arrivalTime:arrivalTime.value,pickupTime:returnTime.value,
        expectedBalance:booking.balance_cents,amountCents:Math.round(Number(amount.value)*100),
        paymentDate:paymentDay.value,receivedTime:paymentTime.value,key:paymentKey};
      try {
        const response = await fetch("/api/bookings/" + booking.id + "/check-in",{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) {
          status.textContent = result.status === "conflict" ? "การจองหรือยอดมัดจำเปลี่ยนแล้ว กรุณาเปิดรายละเอียดล่าสุด"
            : result.status === "consent_required" ? "กรุณาตรวจการยอมรับเงื่อนไขและลายเซ็น"
            : "เช็กอินไม่ได้ กรุณาตรวจวัน เวลา และยอดรับชำระ";
          return;
        }
        if (form.isConnected && bookingDialog.open) await showStay(result.stayId);
        if (selected === "calendar" || selected === "bookings" || selected === "current" || selected === "outstanding") await load(true);
        message.textContent = "เช็กอินแล้ว";
      } catch {
        status.textContent = "ยังยืนยันผลไม่ได้ กรุณาตรวจรายการหรือส่งข้อมูลเดิมอีกครั้ง";
      } finally {
        saving = false;
        submit.disabled = !termsVersion;
      }
    });
  }

  async function showStay(id) {
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
      bookingContent.replaceChildren(node("h3","สรุปการเข้าพัก · " + stay.customer),
        node("p",[stay.stay_number,stay.booking_number,statuses[stay.status]].filter(Boolean).join(" · ")),
        node("p",[stay.checkin,stay.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")),
        node("p",service + " · " + stay.charged_nights + " " + unit),
        node("p","ยอดสุทธิ " + money(stay.total_cents)));
      for (const [label,value] of [["เช็กอินจริง",stay.actual_checkin_at],["เช็กเอาต์จริง",stay.actual_checkout_at]]) {
        if (!value) continue;
        const moment = new Date(value);
        if (!Number.isFinite(moment.valueOf())) continue;
        const display = value.length === 10 ? bookingDate.format(moment)
          : bookingDate.format(new Date(parts.format(moment))) + " · " + bangkokTime.format(moment);
        bookingContent.append(node("p",label + " " + display));
      }
      if (stay.due_cents !== null) bookingContent.append(node("strong","ยอดคงเหลือ " + money(stay.due_cents)));
      const dogs = node("ul");
      for (const dog of stay.dogs) dogs.append(node("li",dog.name + " · " +
        (dog.nightly_rate_cents === null ? "—" : money(dog.nightly_rate_cents) + " / " + unit)));
      bookingContent.append(node("h4","สุนัขที่เข้าพัก"),dogs,node("h4","ประวัติการชำระเงิน"));
      if (!stay.payments.length) bookingContent.append(node("p","ยังไม่มีรายการชำระ"));
      for (const payment of stay.payments) {
        bookingContent.append(node("p",[bookingDate.format(new Date(payment.occurred_on)),payment.received_time,
          paymentLabels[payment.payment_type] || payment.payment_type,money(payment.amount_cents)].filter(Boolean).join(" · ")));
      }
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
      bookingContent.replaceChildren(
        node("h3", [data.booking_number || "#" + data.id, state].join(" · ")),
        node("p", [data.customer, data.contact].filter(Boolean).join(" · ")),
        node("p", [data.checkin, data.checkout].map((day) => bookingDate.format(new Date(day))).join(" – ")),
        node("p", service + " · " + data.charged_nights + " " + unit),
      );
      if (!data.stay_id && data.status === "pending") bookingContent.append(bookingActions(data));
      if (data.stay_id) {
        const stay = Object.assign(node("button","ดูสรุปการเข้าพัก"),{type:"button"});
        stay.addEventListener("click",() => showStay(data.stay_id));
        bookingContent.append(stay);
      }
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
        const row = node("p", [date, payment.received_time, paymentLabels[payment.payment_type] || payment.payment_type,
          money(payment.amount_cents)].filter(Boolean).join(" · "));
        if (!data.stay_id && payment.payment_type === "deposit" && payment.payment_key) {
          row.append(depositDeleteButton(data.id, payment));
        }
        bookingContent.append(row);
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
    const summary = Object.assign(node("button","ดูสรุปการเข้าพัก"),{type:"button"});
    summary.addEventListener("click",() => showStay(stay.id));
    article.append(summary);
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
      addBooking.hidden = selected !== "bookings" && selected !== "calendar";
      calendarToolbar.hidden = selected !== "calendar";
      addCustomer.hidden = selected !== "customers";
      bookingSearch.hidden = selected !== "bookings" && selected !== "customers";
      searchLabel.textContent = selected === "customers" ? "ชื่อลูกค้าหรือชื่อสุนัข" : "เลขจอง ชื่อลูกค้า หรือชื่อสุนัข";
      bookingQuery.value = queries[selected] || "";
      for (const option of modes) option.setAttribute("aria-pressed", option === mode);
      message.textContent = "";
      load(true);
    });
  }
  bookingDialog.addEventListener("close", () => bookingRequest?.abort());
  document.getElementById("close-booking").addEventListener("click", () => bookingDialog.close());
  bookingSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    queries[selected] = bookingQuery.value;
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
      <button type="button" data-mode="customers" aria-pressed="false">ลูกค้า</button>
      <button type="button" data-mode="calendar" aria-pressed="false">ปฏิทินการจอง</button>
      <button type="button" data-mode="bookings" aria-pressed="false">การจองที่รอเช็กอิน</button>
    </div>
    <form id="booking-search" hidden>
      <label><span id="directory-search-label">เลขจอง ชื่อลูกค้า หรือชื่อสุนัข</span><input type="search" maxlength="100" id="booking-query"></label>
      <button type="submit">ค้นหา</button>
    </form>
    <p><button id="add-booking" type="button" hidden>สร้างการจอง</button><button id="add-customer" type="button" hidden>เพิ่มลูกค้า</button></p>
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
    <script nonce="${nonce}">(${main.toString()})()</script></html>`, {
    headers: {
      "Content-Type":"text/html; charset=utf-8", "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
