export function settingsScreen({node,results,message,themeLabels,thaiDate,reload,isActive,openLedger,applyTheme,openCoupons,openReports,openUsers,openBackup}) {
  const services = {
    overnight:["ฝากค้างคืน","บาท/คืน"],daycare:["ฝากระหว่างวัน","บาท/วัน"],monthly:["ฝากรายเดือน","บาท/เดือน"],
  };
  const sizes = {small:"S · เล็ก",medium:"M · กลาง",large:"L · ใหญ่"};
  const sections = {rates:"ราคา",holidays:"วันหยุดร้าน",capacity:"ความจุและอายุลิงก์",care:"ประเภทกิจกรรม",templates:"ข้อความช่วยบันทึก",theme:"ธีม"};
  let section = "rates";
  let data;

  const button = (text) => Object.assign(node("button",text),{type:"button"});
  const field = (label, input) => {
    const element = node("label",label);
    element.append(input);
    return element;
  };
  const submit = (label) => Object.assign(node("button",label),{type:"submit"});
  const number = (value, max, step = 1, required = true) =>
    Object.assign(node("input"),{type:"number",value:value ?? "",min:0,max,step,required});
  const grid = (className) => Object.assign(node("div"),{className});

  async function save(control,path,method,body) {
    control.disabled = true;
    message.textContent = "กำลังบันทึก…";
    try {
      const response = await fetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if (!isActive()) return;
      if (response.ok) {
        message.textContent = "บันทึกแล้ว";
        await reload();
      } else {
        message.textContent = response.status === 409 ? "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดการตั้งค่าล่าสุด"
          : response.status === 403 ? "บัญชีนี้ไม่มีสิทธิ์แก้ไขการตั้งค่า"
          : response.status === 400 ? "กรุณาตรวจข้อมูลที่กรอก" : "บันทึกไม่สำเร็จ กรุณาลองใหม่";
      }
    } catch {
      if (isActive()) message.textContent = "ยังยืนยันผลการบันทึกไม่ได้ กรุณาโหลดการตั้งค่าล่าสุด";
    } finally { control.disabled = false; }
  }

  function saveForm(form,write) {
    form.addEventListener("submit",(event) => {
      event.preventDefault();
      if (!event.submitter?.disabled) write(event.submitter || form.querySelector('button[type="submit"]'));
    });
  }

  const writeSetting = (control,body) =>
    save(control,"/api/settings","PUT",{...body,section,revisions:data.revisions});

  function rateForm(panel) {
    panel.append(node("p","ราคาที่ตั้งไว้ใช้เติมในรายการใหม่ รายการที่บันทึกแล้วใช้ราคาเดิม"));
    const form = node("form");
    const groups = grid("settings-rate-grid");
    const inputs = {};
    for (const [service,[label,unit]] of Object.entries(services)) {
      const group = Object.assign(node("section"),{className:"settings-rate"});
      group.append(node("h3",label),node("p",unit));
      inputs[service] = {};
      for (const [size,sizeLabel] of Object.entries(sizes)) {
        const input = number(data.rates[service][size],999999.99,.01,service !== "monthly");
        inputs[service][size] = input;
        group.append(field(sizeLabel,input));
      }
      groups.append(group);
    }
    form.append(groups,node("p","ปล่อยราคารายเดือนว่างไว้เมื่อต้องการระบุราคาเป็นรายกรณี"),submit("บันทึกราคา"));
    saveForm(form,(control) => {
      const ratesCents = Object.fromEntries(Object.entries(inputs).map(([service,row]) =>
        [service,Object.fromEntries(Object.entries(row).map(([size,input]) =>
          [size,input.value === "" ? null : Math.round(Number(input.value)*100)]))]));
      writeSetting(control,{ratesCents});
    });
    panel.append(form);
  }

  function capacityForm(panel) {
    const form = node("form");
    const capacity = number(data.capacity,10000);
    const hours = number(data.careLinkHours,Number.MAX_SAFE_INTEGER);
    form.append(field("จำนวนสุนัขสูงสุดต่อวัน",capacity),field("อายุลิงก์หลังเช็กเอาต์ (ชั่วโมง)",hours),submit("บันทึก"));
    saveForm(form,(control) => writeSetting(control,{capacity:Number(capacity.value),careLinkHours:Number(hours.value)}));
    panel.append(node("p","ใส่ 0 ในช่องจำนวนสุนัขเพื่อปิดการเตือนความจุ หรือใส่ 0 ในช่องอายุลิงก์เพื่อให้หมดอายุทันทีหลังเช็กเอาต์"),form);
  }

  function themeForm(panel) {
    const form = node("form");
    const select = node("select");
    for (const [value,label] of Object.entries(themeLabels)) {
      select.append(Object.assign(node("option",label),{value}));
    }
    select.value = data.theme;
    const original=field("ธีมของระบบ",select);original.hidden=true;
    const options=grid("theme-options");options.setAttribute("role","group");options.setAttribute("aria-label","ธีมของระบบ");
    for(const [value,label] of Object.entries(themeLabels)){
      const choice=button(label);choice.dataset.theme=value;choice.setAttribute("aria-pressed",String(value===select.value));
      const swatch=node("span");swatch.setAttribute("aria-hidden","true");choice.prepend(swatch);
      choice.onclick=()=>{select.value=value;for(const item of options.children)item.setAttribute("aria-pressed",String(item===choice));};options.append(choice);
    }
    form.append(original,options,submit("ใช้ธีมนี้"));
    saveForm(form,(control) => writeSetting(control,{theme:select.value}));
    panel.append(form);
  }

  function careForm(panel) {
    const form = node("form");
    const name = Object.assign(node("input"),{required:true,maxLength:60});
    form.append(field("ชื่อกิจกรรม",name),submit("เพิ่มกิจกรรม"));
    saveForm(form,(control) => writeSetting(control,{action:"add",name:name.value}));
    panel.append(node("p","กิจกรรมเริ่มต้น · " + data.standardActivities.join(" · ")),form);
    for (const label of data.activities) {
      const row = grid("settings-list-row");
      const remove = button("นำออก");
      remove.setAttribute("aria-label","นำ " + label + " ออกจากรายการเลือก");
      remove.onclick = () => {
        if (confirm("นำกิจกรรมนี้ออกจากรายการเลือก?")) writeSetting(remove,{action:"remove",name:label});
      };
      row.append(node("strong",label),remove);
      panel.append(row);
    }
  }

  function templateForm(panel) {
    panel.append(node("p","เลือกหมวดแล้วเพิ่มหรือแก้ไขข้อความได้ ข้อความเหล่านี้เป็นเพียงตัวช่วย กรุณาตรวจให้ตรงกับการดูแลจริงก่อนบันทึกกิจกรรม"));
    const form=node("form");
    const category=node("select");
    const labels={...Object.fromEntries(["food","medicine","walk","play","rest","custom"].map((key,index)=>[key,data.standardActivities[index]])),
      ...Object.fromEntries(data.activities.map(label=>["activity:"+label,label]))};
    for(const [key,label] of Object.entries(labels))category.append(new Option(label,key));
    const drafts=structuredClone(data.templates);
    const dirty=new Set();
    const list=grid("template-settings-list");
    function renderRows(){
      list.replaceChildren();
      const items=drafts[category.value] || [];
      items.forEach((text,index)=>{
        const row=grid("template-settings-row");
        const input=Object.assign(node("textarea"),{rows:3,maxLength:500,required:true,value:text});
        input.setAttribute("aria-label","ข้อความ "+(index+1));
        input.oninput=()=>{items[index]=input.value;dirty.add(category.value);};
        const remove=button("นำออก");remove.onclick=()=>{items.splice(index,1);dirty.add(category.value);renderRows();};
        row.append(input,remove);list.append(row);
      });
    }
    category.onchange=renderRows;
    const add=button("เพิ่มข้อความ");add.onclick=()=>{const items=drafts[category.value] ||= [];if(items.length<30){items.push("");dirty.add(category.value);renderRows();list.lastElementChild?.querySelector("textarea")?.focus();}};
    const save=submit("บันทึกข้อความช่วยบันทึก");
    form.append(field("หมวดกิจกรรม",category),list,add,save);
    saveForm(form,control=>writeSetting(control,{templates:Object.fromEntries(Object.entries(drafts).filter(([key])=>dirty.has(key) || (!dirty.size && key===category.value)).map(([key,items])=>[key,items.map(text=>text.trim()).filter(Boolean)]))}));
    renderRows();panel.append(form);
  }

  function holidayForm(panel, previous = null) {
    const part = grid("settings-holidays");
    const form = node("form");
    const holidayName = Object.assign(node("input"),{required:true,maxLength:100,value:previous?.name ?? ""});
    const start = Object.assign(node("input"),{type:"date",required:true,value:previous?.starts_on ?? ""});
    const end = Object.assign(node("input"),{type:"date",required:true,value:previous?.ends_on ?? ""});
    start.onchange = () => {
      end.min = start.value;
      if (start.value && (!end.value || end.value < start.value)) end.value = start.value;
    };
    end.min = start.value;
    form.append(field("ชื่อวันหยุด",holidayName),field("ตั้งแต่",start),field("ถึง",end),
      submit(previous ? "บันทึกการแก้ไข" : "เพิ่มวันหยุด"));
    if (previous) {
      const cancel = button("ยกเลิกการแก้ไข");
      cancel.onclick = () => holidayForm(panel);
      form.append(cancel);
    }
    const base = "/api/settings/holidays";
    saveForm(form,(control) => save(control,previous ? base+"/"+previous.id : base,previous ? "PUT" : "POST",
      {name:holidayName.value,starts_on:start.value,ends_on:end.value,previous}));
    part.append(form);
    if (!data.holidays.length) part.append(node("p","ยังไม่มีวันหยุดร้าน"));
    for (const holiday of data.holidays) {
      const row = grid("settings-list-row");
      const info = node("div");
      const date = (value) => thaiDate.format(new Date(value+"T00:00:00Z"));
      info.append(node("strong",holiday.name),node("p",date(holiday.starts_on) + " – " + date(holiday.ends_on)));
      const edit = button("แก้ไข");
      const remove = button("ยกเลิกวันหยุด");
      edit.onclick = () => { holidayForm(panel,holiday); panel.querySelector("input")?.focus(); };
      remove.onclick = () => {
        if (confirm("ยกเลิกวันหยุดนี้?")) save(remove,base+"/"+holiday.id,"DELETE",{previous:holiday});
      };
      const actions = grid("settings-menu");
      actions.append(edit,remove);
      row.append(info,actions);
      part.append(row);
    }
    const existing = panel.querySelector(".settings-holidays");
    if (existing) existing.replaceWith(part);
    else panel.append(part);
  }

  function render(value) {
    data = value;
    applyTheme(value.theme);
    const view = Object.assign(node("article"),{className:"card settings-workspace"});
    const menu = grid("settings-menu");
    menu.setAttribute("role","group");
    menu.setAttribute("aria-label","หมวดตั้งค่า");
    for (const [id,label] of Object.entries(sections)) {
      const tab = button(label);
      tab.setAttribute("aria-pressed",String(id === section));
      tab.dataset.section = id;
      tab.onclick = () => {
        section = id;
        message.textContent = "";
        render(data);
        results.querySelector('[data-section="'+id+'"]')?.focus();
      };
      menu.append(tab);
    }
    const tools=grid("settings-tools");
    const ledger = button("รายรับ–รายจ่าย");
    ledger.onclick = openLedger;
    tools.append(ledger);
    const coupons = button("คูปอง");
    coupons.onclick = openCoupons;
    const reports = button("รายงาน");
    reports.onclick = openReports;
    tools.append(reports);
    tools.append(coupons);
    const users=button('ผู้ใช้งาน');users.onclick=openUsers;tools.append(users);
    const backup=button('สำรองข้อมูล');backup.onclick=openBackup;tools.append(backup);
    const guide=Object.assign(node('a','คู่มือการใช้งาน'),{href:'/api/manual/usage.html',target:'_blank',rel:'noopener'});tools.append(guide);
    const refresh = button("โหลดการตั้งค่าล่าสุด");
    refresh.onclick = () => { message.textContent = ""; reload(); };
    const panel = Object.assign(node("section"),{className:"settings-panel"});
    panel.dataset.section=section;
    panel.append(node("h2",sections[section]));
    const forms = {rates:rateForm,holidays:holidayForm,capacity:capacityForm,care:careForm,templates:templateForm,theme:themeForm};
    forms[section](panel);
    const paths=["M4 5h16v14H4zM4 10h16M8 14h3","M4 19V9m8 10V5m8 14V2","M4 4h16v6a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4zM12 7v2m0 6v2","M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87","M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-7h8v7","M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3zM13 7a3 3 0 0 1 3-3h5v15h-5a4 4 0 0 0-3 2"];
    [...tools.children].forEach((tool,index)=>{
      const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");
      for(const [key,value] of Object.entries({viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"1.7","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"}))icon.setAttribute(key,value);
      const path=document.createElementNS(icon.namespaceURI,"path");path.setAttribute("d",paths[index]);icon.append(path);
      tool.prepend(icon);tool.classList.add("settings-tool");
    });
    view.append(menu,panel,refresh,node("h2","เครื่องมือจัดการร้าน"),tools);
    results.replaceChildren(view);
  }
  return {render};
}
