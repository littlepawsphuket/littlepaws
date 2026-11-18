export function ledgerScreen({translateLabel,node,results,message,reload,isActive,today,dateLabel,baht,key,openStay,openBooking,labels,categories}) {
  const toolbar = document.getElementById("ledger-toolbar");
  const dialog = document.getElementById("ledger-editor");
  const content = document.getElementById("ledger-content");
  const title = document.getElementById("ledger-title");
  const close = document.getElementById("ledger-close");
  const filters = document.getElementById("ledger-filters");
  const start = document.getElementById("ledger-start");
  const end = document.getElementById("ledger-end");
  const kind = document.getElementById("ledger-kind");
  const buttons = (text,type = "button") => Object.assign(node("button",text),{type});
  const methods = {transfer:"โอน",cash:"เงินสด",qr:"QR",card:"บัตร",other:"อื่น ๆ"};
  const base = "/api/transactions";
  const [year,month] = today().split("-").map(Number);
  const monthStart = today().slice(0,7)+"-01";
  const monthEnd = new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  start.value = monthStart;
  end.value = monthEnd;
  let applied = {start:monthStart,end:monthEnd,kind:"all"};
  let editorGeneration = 0;

  function visible(active) { toolbar.hidden = !active; }
  function query(before) {
    const params = new URLSearchParams(applied);
    if (before) params.set("before",before);
    return params;
  }
  function reset() {
    start.value = monthStart;
    end.value = monthEnd;
    kind.value = "all";
  }
  function apply() {
    end.setCustomValidity(end.value < start.value ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น" : "");
    if (!filters.reportValidity()) return;
    applied = {start:start.value,end:end.value,kind:kind.value};
    message.textContent = "";
    reload();
  }
  filters.addEventListener("input",() => end.setCustomValidity(""));
  filters.addEventListener("submit",(event) => {event.preventDefault(); apply();});
  document.getElementById("ledger-reset").onclick = () => {reset(); apply();};
  close.onclick = () => dialog.close();
  document.getElementById("ledger-add").onclick = () => edit();
  dialog.addEventListener("close",() => editorGeneration++);

  function source(row) {
    if (row.deposit_booking_id) return () => openBooking(row.deposit_booking_id);
    return row.stay_id ? () => openStay(row.stay_id) : null;
  }

  function render(data) {
    let table = results.querySelector("table");
    if (!table && data.transactions.length === 0) {
      results.replaceChildren(node("p","ไม่พบรายการตามตัวกรอง"));
      return;
    }
    if (!table) {
      const sheet = Object.assign(node("div"),{className:"ledger-sheet"});
      table = node("table");
      const columns = node("tr");
      for (const label of ["วันที่","ประเภทและหมวดหมู่","รายละเอียด","จำนวนเงิน","จัดการ"]) {
        columns.append(Object.assign(node("th",label),{scope:"col"}));
      }
      const header = node("thead");
      header.append(columns);
      table.append(header,node("tbody"));
      sheet.append(table);
      results.replaceChildren(sheet);
    }
    const rows = table.tBodies[0];
    for (const entry of data.transactions) {
      const row = node("tr");
      const category = node("td");
      category.append(node("strong",labels[entry.kind] || entry.kind),node("p",translateLabel(entry.category)));
      const description = node("td",entry.description);
      if (entry.customer || entry.merchant) description.append(node("p",[entry.customer,entry.merchant].filter(Boolean).join(" · ")));
      if (entry.has_receipt) description.append(Object.assign(node("a","เปิดใบเสร็จ / สลิป"),{
        href:"/api/receipts/"+entry.id,target:"_blank",rel:"noopener",
      }));
      const actions = node("td");
      const open = source(entry);
      const action = buttons(entry.managed ? "ดูรายการต้นทาง" : "แก้ไข");
      action.disabled = Boolean(entry.managed && !open);
      action.onclick = entry.managed ? open : () => edit(entry.id);
      actions.append(action);
      row.append(node("td",dateLabel(entry.occurred_on)),category,description,node("td",baht.format(entry.amount_cents/100)),actions);
      rows.append(row);
    }
  }

  async function edit(id = null) {
    const generation = ++editorGeneration;
    title.textContent = id === null ? "เพิ่มรายการ" : "แก้ไขรายการ";
    content.replaceChildren(node("p","กำลังโหลด…"));
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(base+"/"+(id ?? "new"));
      if (!response.ok) throw Error();
      const data = await response.json();
      if (generation !== editorGeneration || !dialog.open) return;
      if (data.transaction?.managed) {
        content.replaceChildren(node("p","รายการนี้จัดการได้จากหน้าต้นทาง"));
        return;
      }
      drawEditor(id,data);
    } catch {
      if (generation === editorGeneration) content.replaceChildren(node("p","เปิดแบบฟอร์มไม่ได้ กรุณาลองใหม่"));
    }
  }

  function drawEditor(id,{transaction:row,customers,stays}) {
    const form = node("form");
    const fields = Object.assign(node("fieldset"),{className:"ledger-fields"});
    const controls = {};
    function field(name,label,control) {
      controls[name] = control;
      const wrapper = node("label",label);
      wrapper.append(control);
      fields.append(wrapper);
    }
    function choices(name,label,values,selected) {
      const select = node("select");
      for (const [value,text] of values) select.append(Object.assign(node("option",text),{value}));
      select.value = selected;
      field(name,label,select);
    }
    function text(name,label,value,maxLength,required = false) {
      field(name,label,Object.assign(node("input"),{type:"text",value:value ?? "",maxLength,required}));
    }
    choices("kind","ประเภท",Object.entries(labels),row?.kind || (applied.kind === "all" ? "income" : applied.kind));
    field("occurredOn","วันที่รับ/จ่ายจริง",Object.assign(node("input"),{type:"date",value:row?.occurred_on || today(),required:true}));
    const categoryOptions = [...new Set(row?.category ? [row.category,...categories] : categories)];
    choices("category","หมวดหมู่",categoryOptions.map((label) => [label,translateLabel(label)]),row?.category || categoryOptions[0]);
    field("amountCents","จำนวนเงิน (บาท)",Object.assign(node("input"),{type:"number",min:0,max:"999999999",step:".01",
      required:true,value:row ? (row.amount_cents/100).toFixed(2) : ""}));
    text("description","รายละเอียด",row?.description,800,true);
    text("merchant","ร้านค้า / ผู้รับเงิน",row?.merchant,200);
    choices("customerId","ลูกค้า (ถ้ามี)",[["","—"],...customers.map((item) => [item.id,item.name])],row?.customer_id ?? "");
    choices("stayId","เชื่อมการเข้าพัก (ถ้ามี)",[["","—"],...stays.map((item) =>
      [item.id,[item.stay_number || "#"+item.id,item.customer,dateLabel(item.checkin)].join(" · ")])],row?.stay_id ?? "");
    const method = row ? row.payment_method || "" : "transfer";
    const methodOptions = Object.hasOwn(methods,method) ? Object.entries(methods) : [[method,method || "—"],...Object.entries(methods)];
    choices("paymentMethod","ช่องทางชำระ",methodOptions,method);
    field("receipt","ใบเสร็จ / สลิป",Object.assign(node("input"),{type:"file",accept:".jpg,.jpeg,.png,.webp,.pdf"}));
    text("reference","เลขอ้างอิง",row?.reference,200);
    text("note","หมายเหตุ",row?.note,1000);
    if (row?.has_receipt) fields.append(Object.assign(node("a","เปิดไฟล์แนบเดิม"),{
      href:"/api/receipts/"+id,target:"_blank",rel:"noopener",
    }));
    const submit = buttons(row ? "บันทึกการแก้ไข" : "บันทึกรายการ","submit");
    const status = node("p");
    status.setAttribute("role","status");
    form.append(fields,submit,status);
    let busy = false;
    const requestKey = key();
    const generation = editorGeneration;
    const route = id === null ? base : base+"/"+id;

    async function save(method,body,header,success) {
      busy = true;
      fields.disabled = true;
      submit.disabled = true;
      remove.disabled = true;
      status.textContent = "กำลังบันทึก…";
      try {
        const response = await fetch(route,{method,body,headers:header});
        if (generation !== editorGeneration) return;
        if (response.ok) {
          dialog.close();
          if (isActive()) { message.textContent = success; await reload(); }
          return;
        }
        const result = await response.json();
        status.textContent = {conflict:"ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายการใหม่",invalid_receipt:"ไฟล์ใบเสร็จไม่ตรงกับประเภทที่รองรับ",
          invalid_size:"ไฟล์แนบใหญ่เกินขนาด",storage_unavailable:"เปิดที่เก็บไฟล์ไม่ได้ กรุณาลองใหม่",
          invalid:"กรุณาตรวจข้อมูลที่กรอก",not_found:"ไม่พบรายการนี้"}[result.status] || "บันทึกไม่สำเร็จ กรุณาลองใหม่";
      } catch {
        if (generation === editorGeneration) status.textContent = "ยังยืนยันผลไม่ได้ กรุณาส่งรายการเดิมอีกครั้ง";
      } finally {
        busy = false;
        fields.disabled = false;
        submit.disabled = false;
        remove.disabled = false;
      }
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      if (busy) return;
      const body = Object.fromEntries(Object.entries(controls).filter(([name]) => name !== "receipt")
        .map(([name,input]) => [name,input.value]));
      body.amountCents = Math.round(controls.amountCents.valueAsNumber*100);
      for (const name of ["customerId","stayId"]) body[name] = body[name] ? Number(body[name]) : null;
      body.key = requestKey;
      body.revision = row?.revision ?? null;
      const file = controls.receipt.files[0];
      if (file?.size >= 8*1024*1024) { status.textContent = "ไฟล์แนบต้องมีขนาดต่ำกว่า 8 MB"; return; }
      const method = row ? "PUT" : "POST";
      if (file) {
        const parts = new FormData();
        parts.set("entry",JSON.stringify(body));
        parts.set("receipt",file);
        save(method,parts,{},"บันทึกรายการแล้ว");
      } else save(method,JSON.stringify(body),{"Content-Type":"application/json"},"บันทึกรายการแล้ว");
    };

    const remove = buttons("ลบรายการ");
    remove.className = "delete-deposit";
    remove.hidden = !row;
    remove.onclick = () => {
      if (!busy && confirm("ยืนยันลบรายการรายรับ–รายจ่ายนี้หรือไม่?")) {
        save("DELETE",JSON.stringify({revision:row.revision}),{"Content-Type":"application/json"},"ลบรายการแล้ว");
      }
    };
    form.append(remove);
    content.replaceChildren(form);
  }

  document.getElementById("ledger-export").onclick = async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try {
      message.textContent = "กำลังเตรียม CSV…";
      const columns = ["id","occurred_on","kind","category","description","amount","customer_id","stay_id","merchant","payment_method","reference","note"];
      function csv(value) {
        let text = String(value ?? "");
        if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"','""') + '"';
      }
      const lines = [columns.join(",")];
      let before = null;
      do {
        const parameters = new URLSearchParams({start:"0001-01-01",end:"9999-12-31",export:"1"});
        if (before) parameters.set("before",before);
        const response = await fetch(base+"?"+parameters);
        if (!response.ok) throw Error();
        const page = await response.json();
        for (const entry of page.transactions) {
          lines.push(columns.map((name) => csv(name === "amount" ? (entry.amount_cents/100).toFixed(2) : entry[name])).join(","));
        }
        before = page.nextBefore;
      } while (before && isActive());
      if (!isActive()) return;
      const url = URL.createObjectURL(new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
      const download = Object.assign(node("a"),{href:url,download:"little-paws-transactions.csv"});
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url),30000);
      message.textContent = "";
    } catch {
      if (isActive()) message.textContent = "ส่งออก CSV ไม่สำเร็จ กรุณาลองใหม่";
    } finally { control.disabled = false; }
  };
  return {render,query,visible,open:edit};
}
