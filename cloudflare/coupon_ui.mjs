export function couponScreen({node,key,baht,results,message,reload,isActive,thaiDate}) {
  const toolbar = document.getElementById("coupon-toolbar");
  const group = document.getElementById("coupon-group");
  const dialog = document.getElementById("coupon-dialog");
  const content = document.getElementById("coupon-content");
  const status = document.getElementById("coupon-status");
  const add = document.getElementById("coupon-add");
  const percent = new Intl.NumberFormat("th-TH",{style:"percent",maximumFractionDigits:2});
  let defaultExpiry = "";
  let dialogRequest = 0;
  let imageUrl;
  let createAttempt;

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
  }
  dialog.addEventListener("close",() => { dialogRequest++; clearImage(); });
  document.getElementById("coupon-close").onclick = () => dialog.close();
  const statusTabs=Object.assign(node("div"),{className:"coupon-status-tabs"});
  statusTabs.setAttribute("role","group");statusTabs.setAttribute("aria-label","สถานะคูปอง");
  for(const option of group.options){
    const tab=Object.assign(node("button",option.text),{type:"button"});tab.dataset.status=option.value;
    tab.setAttribute("aria-pressed",String(option.value===group.value));
    tab.onclick=()=>{group.value=option.value;for(const item of statusTabs.children)item.setAttribute("aria-pressed",String(item===tab));reload();};statusTabs.append(tab);
  }
  group.parentElement.hidden=true;toolbar.prepend(statusTabs);
  group.addEventListener("change",() => reload());
  add.onclick = () => edit();

  const title = (coupon) => "ส่วนลด " + (coupon.kind === "percent" ? percent.format(coupon.value / 10000) : baht.format(coupon.value / 100));
  const remaining = (coupon) => Math.max(0,coupon.max_uses-coupon.used);
  const conditions = (coupon) => [
    ...(coupon.minimum_cents > 0 ? ["เมื่อมีค่าบริการตั้งแต่ " + baht.format(coupon.minimum_cents/100) + " ขึ้นไป"] : []),
    "ใช้ได้ " + coupon.max_uses + " ครั้ง" + (coupon.used ? " · เหลือ " + remaining(coupon) + " ครั้ง" : ""),
    "ใช้ได้ถึง " + thaiDate.format(new Date(coupon.expires_on)),
  ];

  function makeImage(coupon) {
    const canvas = Object.assign(node("canvas"),{width:840,height:780});
    const ctx = canvas.getContext("2d");
    const background = ctx.createLinearGradient(0,0,840,780);
    background.addColorStop(0,"#103a32"); background.addColorStop(1,"#225945");
    ctx.fillStyle = background;
    ctx.fillRect(0,0,840,780);
    ctx.fillStyle = "#fff9ee";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(40,40,760,700,34);
      ctx.fill();
    } else ctx.fillRect(40,40,760,700);
    const font = '"Sukhumvit Set", "Noto Sans Thai", Thonburi, system-ui';
    function line(value,y,size,color="#173e32",weight=600) {
      ctx.font = weight + " " + size + "px " + font;
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      ctx.fillText(value,420,y,710);
    }
    line("Little Paws Homestay Phuket",109,28);
    line(title(coupon),194,64);
    const qrSize = coupon.qr.length;
    const moduleSize = 7;
    const outer = (qrSize + 8) * moduleSize;
    const qrX = Math.floor((840-outer)/2);
    const qrY = 221;
    ctx.fillStyle = "#fff";
    ctx.fillRect(qrX,qrY,outer,outer);
    ctx.fillStyle = "#121212";
    for (let y=0; y<qrSize; y++) {
      for (let x=0; x<qrSize; x++) {
        if (coupon.qr[y][x] === "1") ctx.fillRect(qrX+(x+4)*moduleSize,qrY+(y+4)*moduleSize,moduleSize,moduleSize);
      }
    }
    line(coupon.code,476,50);
    const lines = conditions(coupon);
    lines.forEach((value,index) => line(value,544+index*40,27,"#305347",500));
    line("Little Paws, Big Love.",700,24,"#875238");
    return new Promise((resolve) => canvas.toBlob(resolve,"image/png"));
  }

  async function preview(id) {
    const request = ++dialogRequest;
    clearImage();
    if (!dialog.open) dialog.showModal();
    status.textContent = "";
    content.replaceChildren(node("p","กำลังโหลดคูปอง…"));
    try {
      const response = await fetch("/api/coupons/"+id);
      if (!response.ok) throw Error();
      const coupon = await response.json();
      if (request !== dialogRequest) return;
      const heading = node("h3",title(coupon));
      const code = node("strong",coupon.code);
      code.className = "coupon-code";
      content.replaceChildren(heading,code,...conditions(coupon).map((line) => node("p",line)));
      const editButton = Object.assign(node("button","แก้ไข"),{type:"button"});
      editButton.onclick = () => edit(coupon);
      const remove = Object.assign(node("button","นำคูปองออก"),{type:"button",className:"delete-deposit"});
      remove.onclick = async () => {
        if (!confirm("นำคูปอง " + coupon.code + " ออกจากรายการหรือไม่?")) return;
        remove.disabled = true;
        try {
          const response = await fetch("/api/coupons/"+coupon.id,{method:"DELETE"});
          if (!response.ok) throw Error();
          if (request === dialogRequest) dialog.close();
          if (isActive()) await reload();
        } catch { if (request === dialogRequest) status.textContent = "นำคูปองออกไม่ได้ กรุณาลองใหม่"; }
        finally { remove.disabled = false; }
      };
      content.append(editButton,remove);
      const png = await makeImage(coupon);
      if (request !== dialogRequest) return;
      if (!png) {
        status.textContent = "สร้างรูปคูปองไม่ได้";
        return;
      }
      imageUrl = URL.createObjectURL(png);
      const img = Object.assign(node("img"),{src:imageUrl,alt:"คูปอง " + coupon.code,className:"coupon-preview"});
      const filename = "little-paws-coupon-"+coupon.code+".png";
      const download = Object.assign(node("a","ดาวน์โหลดรูป PNG"),{href:imageUrl,download:filename});
      const actions = node("div");
      actions.className = "photo-actions";
      actions.append(download);
      const file = new File([png],filename,{type:"image/png"});
      if (navigator.canShare?.({files:[file]})) {
        const share = Object.assign(node("button","แชร์รูป"),{type:"button"});
        share.onclick = async () => {
          try { await navigator.share({files:[file]}); }
          catch (error) { if (error.name !== "AbortError") status.textContent = "แชร์รูปไม่ได้ ลองดาวน์โหลดหรือแตะค้างที่รูป"; }
        };
        actions.append(share);
      }
      content.append(img,actions,node("p","บนมือถือ แตะค้างที่รูปเพื่อบันทึกหรือแชร์"));
    } catch {
      if (request === dialogRequest) status.textContent = "เปิดตัวอย่างคูปองไม่ได้ กรุณาลองใหม่";
    }
  }

  function edit(coupon) {
    const request = ++dialogRequest;
    clearImage();
    if (!dialog.open) dialog.showModal();
    status.textContent = "";
    const form = Object.assign(node("form"),{className:"coupon-form"});
    function field(label,input) {
      const wrapper = node("label",label);
      wrapper.append(input);
      form.append(wrapper);
      return input;
    }
    const attempt = coupon ? null : createAttempt;
    const kind = node("select");
    kind.append(new Option("เปอร์เซ็นต์","percent"),new Option("จำนวนบาท","fixed"));
    kind.value = coupon?.kind ?? attempt?.kind ?? "percent";
    field("ประเภทส่วนลด",kind);
    const value = field("ส่วนลด",Object.assign(node("input"),{type:"number",step:"0.01",min:"0.01",required:true,
      value:(coupon?.value ?? attempt?.value ?? "") === "" ? "" : (coupon?.value ?? attempt.value)/100}));
    const minimum = field("ค่าบริการขั้นต่ำ (บาท)",Object.assign(node("input"),{type:"number",step:"0.01",min:"0",
      value:(coupon?.minimum_cents ?? attempt?.minimumCents ?? 0)/100}));
    const expires = field("หมดอายุ",Object.assign(node("input"),{type:"date",value:coupon?.expires_on ?? attempt?.expiresOn ?? defaultExpiry,required:true}));
    const uses = field("จำนวนครั้งที่ใช้ได้",Object.assign(node("input"),{type:"number",min:Math.max(1,coupon?.used ?? 0),
      max:999999,value:coupon?.max_uses ?? attempt?.maxUses ?? 1,step:"1",required:true}));
    const submit = node("button","บันทึกคูปอง");
    form.append(submit);
    function updateMax() { value.max = kind.value === "percent" ? "100" : "999999999"; }
    kind.onchange = updateMax;
    updateMax();
    content.replaceChildren(node("h3",coupon ? "แก้ไขคูปอง " + coupon.code : "สร้างคูปอง"),form);
    if (attempt) status.textContent = "ส่งข้อมูลเดิมอีกครั้งเพื่อยืนยันผล";
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fields = {kind:kind.value,value:Math.round(Number(value.value)*100),minimumCents:Math.round(Number(minimum.value)*100),
        expiresOn:expires.value,maxUses:Number(uses.value)};
      if (!coupon && createAttempt && Object.keys(fields).some((field) => createAttempt[field] !== fields[field])) {
        status.textContent = "กรุณาส่งข้อมูลเดิมเพื่อยืนยันผลครั้งก่อน";
        return;
      }
      const body = coupon ? fields : createAttempt || {...fields,key:key()};
      if (!coupon) createAttempt = body;
      submit.disabled = true;
      try {
        const response = await fetch("/api/coupons"+(coupon ? "/"+coupon.id : ""),{
          method:coupon ? "PUT" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) {
          if (!coupon && response.status < 500) createAttempt = null;
          if (request === dialogRequest) status.textContent = "บันทึกไม่ได้ กรุณาตรวจส่วนลด วันหมดอายุ และจำนวนครั้งที่ใช้ไปแล้ว";
          return;
        }
        if (!coupon) createAttempt = null;
        if (request === dialogRequest && dialog.open) await preview(result.id);
        if (isActive()) await reload();
      } catch {
        if (request === dialogRequest) status.textContent = "ยังยืนยันผลไม่ได้ กรุณาส่งข้อมูลเดิมอีกครั้ง";
      } finally { submit.disabled = false; }
    };
  }

  return {
    visible(value) { toolbar.hidden = !value; },
    query(before) { return new URLSearchParams({status:group.value,before:before || Number.MAX_SAFE_INTEGER}); },
    render(data) {
      defaultExpiry = data.defaultExpiry;
      add.disabled = false;
      for (const coupon of data.coupons) {
        const card = Object.assign(node("article"),{className:"card coupon-list-card"});
        const open = Object.assign(node("button","ดูคูปอง"),{type:"button"});
        open.onclick = () => preview(coupon.id);
        card.append(node("h2",title(coupon)),Object.assign(node("p","รหัส "+coupon.code),{className:"coupon-list-code"}),
          ...conditions(coupon).map((line) => node("p",line)),open);
        results.append(card);
      }
      if (!results.childElementCount) message.textContent = "ไม่มีคูปองในสถานะนี้";
    },
  };
}
