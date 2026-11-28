export function dashboardScreen({translateLabel,node,results,baht,dateLabel,monthLabel,today,openStay,openCustomer,openTimeline,
  checkInBooking,viewBooking,checkout,discussionView,markDiscussionRead,setMode,activityIcon,onCareChange,onRendered}) {
  const colors = {"ค่าฝากเลี้ยง":"#24796b","อาหารและขนม":"#a54a4b","อุปกรณ์":"#3b6dab",
    "ทำความสะอาด":"#43804a","ค่าน้ำไฟ":"#a86818","การตลาด":"#8255a0","ค่ารักษาพยาบาล":"#a94d7b","เอกสาร":"#546779","อื่นๆ":"#846343"};
  const button = (label,action,secondary = false) => {
    const element = Object.assign(node("button",label),{type:"button",className:secondary ? "secondary" : ""});
    element.onclick = action;
    return element;
  };
  function photo(dog) {
    const avatar = Object.assign(node("span"),{className:"dog-avatar"});
    if (dog.has_photo) avatar.append(Object.assign(node("img"),{
      src:"/api/customers/"+dog.customer_id+"/dogs/"+dog.dog_id+"/photo",alt:dog.dog,loading:"lazy",width:64,height:64,
    }));
    else {
      avatar.append(Object.assign(node("img"),{src:"/static/little-paws-icon.png",alt:"",width:64,height:64}));
      avatar.setAttribute("aria-label","สุนัข "+dog.dog);
    }
    return avatar;
  }
  function section(title,count,actionLabel,action) {
    const view = Object.assign(node("section"),{className:"card"});
    const heading = Object.assign(node("div"),{className:"heading"});
    const text = node("h2",title+" ");
    text.append(Object.assign(node("span",String(count)),{className:"count"}));
    heading.append(text,button(actionLabel,action,true));
    view.append(heading);
    return view;
  }
  function currentDogs(rows) {
    const view = section("สุนัขที่กำลังเข้าพัก",rows.length,"ดูรายการฝากเลี้ยง",() => setMode("current"));
    if (!rows.length) { view.append(Object.assign(node("p","ขณะนี้ไม่มีสุนัขที่อยู่ในสถานะเข้าพัก"),{className:"muted"})); return view; }
    const list = Object.assign(node("div"),{className:"boarding-list current-boarding"});
    for (const dog of rows) {
      const article = node("article");
      const heading = Object.assign(node("div"),{className:"boarding-dog-heading current-dog-heading"});
      const identity = Object.assign(node("div"),{className:"current-dog-identity"});
      const details = node("div");
      const owner = button(dog.owner,() => openCustomer(dog.customer_id),true);
      owner.className = "text-button";
      details.append(node("strong",dog.dog),owner,node("small",dog.contact || "ยังไม่มีช่องทางติดต่อ"));
      identity.append(photo(dog),details);
      const pickup = Object.assign(node("div"),{className:"current-dog-pickup"});
      const due = dog.checkout === today();
      pickup.append(Object.assign(node("strong",due ? "กลับบ้านวันนี้" : "เหลือ "+dog.days_left+" วัน"),{
        className:due ? "pickup-today" : "boarding-duration",
      }),node("small","วันรับกลับ "+dateLabel(dog.checkout)+(dog.pickup_time ? " · "+dog.pickup_time : "")));
      heading.append(identity,pickup);
      const care = Object.assign(node("details"),{className:"dog-care today-details"});
      const summary = node("summary","การดูแลวันนี้ · "+dog.care_count);
      if (dog.latest_care) {
        const event = dog.latest_care;
        summary.append(Object.assign(node("small","ล่าสุด "+event.time+" · "+
          (event.label || {food:"ให้อาหารแล้ว",medicine:"ให้ยาแล้ว"}[event.kind] || event.note)),{className:"care-latest"}));
      }
      const careActions = Object.assign(node("div"),{className:"actions care-dashboard-actions"});
      const identityForCare={id:dog.dog_id,name:dog.dog};
      careActions.append(button("บันทึกกิจกรรม",()=>openTimeline(dog.stay_id,identityForCare,"record")),
        button("ดูไทม์ไลน์",()=>openTimeline(dog.stay_id,identityForCare),true));
      const feed=Object.assign(node("div"),{className:"today-care-feed"});
      care.append(summary,careActions,feed);
      let careLoaded=false;
      care.addEventListener("toggle",async()=>{
        if(!care.open || careLoaded)return;
        careLoaded=true;feed.replaceChildren(node("p","กำลังโหลด…"));
        try{
          const response=await fetch("/api/stays/"+dog.stay_id+"/dogs/"+dog.dog_id+"/timeline?day="+today());
          if(!response.ok)throw Error();
          const data=await response.json();
          if(!feed.isConnected)return;
          feed.replaceChildren();
          for(const event of data.events){
            const item=Object.assign(node("article"),{className:"care-event"});
            const heading=Object.assign(node("div"),{className:"care-event-heading"});
            const copy=Object.assign(node("div"),{className:"care-event-copy"});
            const meta=Object.assign(node("div"),{className:"care-event-meta"});
            meta.append(Object.assign(node("span",event.recorded_at.slice(11,16)),{className:"care-event-clock"}),node("strong",translateLabel(event.activity_label || {food:"ให้อาหารแล้ว",medicine:"ให้ยาแล้ว",custom:"กิจกรรมอื่น"}[event.kind] || event.kind)));
            copy.append(meta);
            if(event.note)copy.append(Object.assign(node("p",event.note),{className:"care-event-note"}));
            const actions=Object.assign(node("div"),{className:"care-event-actions"});
            const edit=button("แก้ไขกิจกรรม",()=>openTimeline(dog.stay_id,identityForCare,{eventId:event.id}),true);
            const remove=button("ลบกิจกรรม",async()=>{
              if(!confirm("ลบกิจกรรมนี้หรือไม่?"))return;
              remove.disabled=true;
              try{
                const response=await fetch("/api/stays/"+dog.stay_id+"/dogs/"+dog.dog_id+"/timeline",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove-event",eventId:event.id,revision:event.revision})});
                if(!response.ok)throw Error();await onCareChange();
              }catch{const status=node("p","โหลดไทม์ไลน์ไม่ได้ กรุณาลองใหม่");status.setAttribute("role","status");item.append(status);remove.disabled=false;}
            });
            for(const [control,icon] of [[edit,"edit"],[remove,"delete"]]){control.setAttribute("aria-label",control.textContent);control.title=control.textContent;control.className=icon==="delete"?"danger":"secondary";control.replaceChildren(activityIcon(icon));}
            actions.append(edit,remove);heading.append(copy,actions);
            item.append(heading);
            const gallery=Object.assign(node("div"),{className:"care-media-gallery"});
            for(const photo of event.photos){
              const link=Object.assign(node("a"),{href:"/api/stays/"+dog.stay_id+"/dogs/"+dog.dog_id+"/timeline/photos/"+photo.id});
              link.dataset.carePhoto="";link.setAttribute("aria-haspopup","dialog");
              link.append(Object.assign(node("img"),{src:link.href,alt:"รูปกิจกรรม",loading:"lazy"}));
              const tile=Object.assign(node("div"),{className:"care-photo-tile"});tile.append(link);
              if(photo.hearted)tile.append(Object.assign(node("span","❤️ ผู้ปกครองส่งหัวใจ"),{className:"care-heart-count"}));
              gallery.append(tile);
            }
            if(event.photos.length)item.append(gallery);
            item.append(discussionView(event,dog.stay_id,dog.dog_id));feed.append(item);
          }
          if(!data.events.length)feed.append(node("p","ยังไม่มีกิจกรรมในช่วงนี้"));
          else markDiscussionRead(dog.stay_id,dog.dog_id,data.events.map(event=>event.id));
        }catch{careLoaded=false;feed.replaceChildren(node("p","โหลดไทม์ไลน์ไม่ได้ กรุณาลองใหม่"));}
      });
      const actions = Object.assign(node("div"),{className:"boarding-checkout-actions"});
      const checkOut = button("เช็กเอาต์",() => checkout(dog.stay_id,checkOut),true);
      checkOut.classList.add("stay-checkout-button");
      actions.append(button("ดูการเข้าพัก",() => openStay(dog.stay_id),true),checkOut);
      article.append(heading,care,actions);
      list.append(article);
    }
    view.append(list);
    return view;
  }
  function upcomingDogs(rows) {
    const view = section("สุนัขที่มีกำหนดเข้าพัก",rows.length,"ดูปฏิทินการจอง",() => setMode("calendar"));
    if (!rows.length) {view.append(Object.assign(node("p","ไม่มีการจองที่รอเช็กอิน"),{className:"muted"})); return view;}
    const list = Object.assign(node("div"),{className:"boarding-list"});
    for (const dog of rows) {
      const article = node("article");
      const heading = Object.assign(node("div"),{className:"upcoming-dog-heading"});
      const countdown = dog.days_until>0 ? "อีก "+dog.days_until+" วันจะเข้าพัก" :
        dog.days_until === 0 ? "เข้าพักวันนี้" : "เลยวันเข้าพัก "+(-dog.days_until)+" วัน";
      const badge = Object.assign(node("strong",countdown),{className:dog.days_until === 0 ? "pickup-today" : "boarding-duration"});
      heading.append(photo(dog),badge);
      const period = Object.assign(node("div"),{className:"boarding-period"});
      period.append(node("small",dateLabel(dog.checkin)+" ถึง "+dateLabel(dog.checkout)),
        Object.assign(node("strong",dog.charged_nights+" "+(dog.service_type === "monthly" ? "เดือน" : "วัน")),{className:"boarding-duration"}));
      const actions = Object.assign(node("div"),{className:"boarding-checkout-actions"});
      actions.append(button("ดูการจอง",() => dog.source === "booking" ? viewBooking(dog.id) : openStay(dog.id),true),
        button("เช็กอิน",() => dog.source === "booking" ? checkInBooking(dog.id) : openStay(dog.id)));
      article.append(heading,node("strong",dog.dog),node("span",dog.owner));
      if (dog.contact) article.append(node("small",dog.contact));
      article.append(period,actions);
      list.append(article);
    }
    view.append(list);
    return view;
  }
  function finance(data) {
    const view = Object.assign(node("div"),{className:"dashboard-finance"});
    const stats = Object.assign(node("div"),{className:"stats"});
    for (const [name,label] of Object.entries({income_cents:"รายรับคงเหลือหลังหักส่วนที่คืน",refund_cents:"คืนเงิน",
      expense_cents:"รายจ่าย",cash_flow_cents:"กระแสเงินสดสุทธิ"})) {
      const stat = Object.assign(node("div"),{className:"card stat"});
      stat.append(node("small",label),Object.assign(node("strong",baht.format(data.totals[name]/100)),{
        className:name === "expense_cents" || data.totals[name]<0 ? "red" : "green",
      }));
      stats.append(stat);
    }
    const serviceStats = Object.assign(node("div"),{className:"stats three"});
    for (const [name,label] of Object.entries({stays:"การเข้าพัก (ครั้ง)",dogs:"สุนัขเข้าพัก (ตัว/ครั้ง)",nights:"จำนวนวันเข้าพัก"})) {
      const stat = Object.assign(node("div"),{className:"card stat"});
      stat.append(node("small",label),node("strong",String(data.stats[name])));
      serviceStats.append(stat);
    }
    const lower = Object.assign(node("div"),{className:"two"});
    const chart = Object.assign(node("section"),{className:"card"});
    chart.append(node("h2","รายรับคงเหลือเทียบรายจ่าย · รายเดือน"));
    const bars = Object.assign(node("div"),{className:"dashboard-trend"});
    const max = Math.max(1,...data.trend.flatMap((month) => [Math.abs(month.income_cents),month.expense_cents]));
    for (const month of data.trend) {
      const column = Object.assign(node("div"),{className:"dashboard-month"});
      const pair = Object.assign(node("div"),{className:"dashboard-bars"});
      for (const [name,label,color] of [["income_cents","รายรับคงเหลือ","#23928f"],["expense_cents","รายจ่าย","#dfa05b"]]) {
        const amount = month[name];
        const bar = node("span");
        bar.className = "dashboard-bar";
        bar.style.height = Math.max(1,Math.abs(amount)/max*100)+"%";
        bar.style.backgroundColor = color;
        const text = label+" "+baht.format(amount/100);
        bar.title = text;
        bar.setAttribute("aria-label",text);
        pair.append(bar);
      }
      column.append(pair,node("small",monthLabel(month.month)));
      bars.append(column);
    }
    chart.append(bars,Object.assign(node("p","🟢 รายรับคงเหลือ · 🟠 รายจ่าย"),{className:"legend"}));
    const categories = Object.assign(node("section"),{className:"card expense-categories"});
    categories.append(node("h2","รายจ่ายตามหมวดหมู่"));
    if (!data.categories.length) categories.append(node("p","ยังไม่มีรายจ่ายในช่วงนี้"));
    for (const entry of data.categories) {
      const row = Object.assign(node("div"),{className:"category"});
      const heading = node("div");
      heading.append(node("span",translateLabel(entry.category)),node("b",baht.format(entry.cents/100)));
      const track = Object.assign(node("div"),{className:"track"});
      const fill = node("div");
      fill.style.width = (data.totals.expense_cents ? entry.cents/data.totals.expense_cents*100 : 0)+"%";
      fill.style.backgroundColor = colors[entry.category] || "#576a71";
      track.append(fill);
      row.append(heading,track);
      categories.append(row);
    }
    lower.append(chart,categories);
    const recent = Object.assign(node("section"),{className:"card"});
    recent.append(node("h2","รายการล่าสุดในช่วงนี้"));
    if (!data.recent.length) recent.append(node("p","ยังไม่มีรายการ"));
    for (const item of data.recent) {
      const row = Object.assign(node("div"),{className:"dashboard-recent"});
      row.append(node("small",dateLabel(item.occurred_on)),
        node("span",[{income:"รับเงิน",expense:"รายจ่าย",refund:"คืนเงิน"}[item.kind],item.description].join(" · ")),
        node("strong",baht.format(item.amount_cents/100)));
      recent.append(row);
    }
    view.append(stats,serviceStats,lower,recent);
    return view;
  }
  function render(data) {
    const period = document.getElementById("finance-toolbar");
    const summary = finance(data);
    results.replaceChildren(currentDogs(data.current),upcomingDogs(data.upcoming),summary);
    summary.prepend(period);
    period.hidden = false;
    onRendered?.();
  }
  return {render};
}
