import {careImageCss,customerImageViewport} from "./customer_image_styles.mjs";
import {documentAssets} from "./document_data.mjs";
import {dogIcon,escape,palette,picture} from "./document_layout.mjs";
import {privateDocumentHeaders,renderExport} from "./document_exports.mjs";
import {careActivityName,validCarePhotoKey,validDogPhotoKey} from "./timeline.mjs";

const dateFormat = (lang) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH",{
  dateStyle:"medium",timeZone:"Asia/Bangkok",
});
const dogFacts = {
  th:{small:"เล็ก",medium:"กลาง",large:"ใหญ่",female:"เพศเมีย",male:"เพศผู้"},
  en:{small:"Small",medium:"Medium",large:"Large",female:"Female",male:"Male"},
};

function exportLimit(lang) {
  const message = lang === "en" ? "This export is too large. Choose a shorter period or open the print view."
    : "ไฟล์สรุปมีขนาดใหญ่เกินไป กรุณาเลือกช่วงสั้นลงหรือเปิดแบบพิมพ์";
  return new Response(message,{status:422,headers:{...privateDocumentHeaders,"Content-Type":"text/plain; charset=utf-8"}});
}

export async function exportCare(env,stayId,dogId,{lang,day,format}) {
  const limit = format === "png" ? 40 : format === "pdf" ? 180 : 500;
  const [dogs,events] = await env.DB.batch([
    env.DB.prepare(`SELECT d.name,d.size,d.profile,p.object_key,c.name AS owner,s.checkin,s.checkout
      FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id JOIN stays s ON s.id=sd.stay_id
      JOIN customers c ON c.id=s.customer_id LEFT JOIN dog_photos p ON p.dog_id=d.id
      WHERE sd.stay_id=? AND sd.dog_id=?`).bind(stayId,dogId),
    env.DB.prepare(`SELECT e.kind,e.activity_label,e.recorded_at,e.note,
      (SELECT json_group_array(json_array(p.id,p.object_key)) FROM care_photos p WHERE p.event_id=e.id) AS photos
      FROM care_events e WHERE e.stay_id=? AND e.dog_id=? AND e.customer_visible=1
        AND (?='all' OR substr(e.recorded_at,1,10)=?)
      ORDER BY e.recorded_at DESC,e.id DESC LIMIT ?`).bind(stayId,dogId,day,day,limit+1),
  ]);
  const dog = dogs.results[0];
  if (!dog) return new Response(null,{status:404,headers:privateDocumentHeaders});
  if (events.results.length > limit) return exportLimit(lang);
  if (format !== "html" && !env.BROWSER) return new Response(null,{status:503,headers:privateDocumentHeaders});
  const {theme,logo,font,mascot,asset} = await documentAssets(env);
  const profileImage = validDogPhotoKey(dog.object_key,dogId) ? await asset(dog.object_key,"image/jpeg",512*1024) : null;
  const recorded = [];
  for (const event of events.results) {
    const photos = [];
    for (const [id,key] of JSON.parse(event.photos)) {
      if (!Number.isSafeInteger(id) || id < 1 || !validCarePhotoKey(key,id)) continue;
      const source = format === "html" ? `/api/stays/${stayId}/dogs/${dogId}/timeline/photos/${id}`
        : await asset(key,"image/jpeg",2*1024*1024);
      if (!source) return exportLimit(lang);
      photos.push(source);
    }
    recorded.push({...event,photos});
  }
  const html = careDocumentHtml({dog,profileImage,events:recorded,theme,logo,font,mascot,lang,day,format});
  return renderExport(env,{html,lang,format,imageViewport:customerImageViewport,filename:`little-paws-care-${stayId}-${dogId}-${day}-${lang}.${format}`});
}

export function careDocumentHtml({dog,profileImage,events,theme,logo,font,mascot,lang,day,format}) {
  const en = lang === "en";
  const title = en ? "Activity summary" : "สรุปกิจกรรมของน้อง";
  const slogan = en ? "Because every little paw deserves a whole lot of love."
    : "เพราะทุกอุ้งเท้าเล็ก ๆ สมควรได้รับความรักที่ยิ่งใหญ่";
  const [accent,tint] = palette[theme] || palette.classic;
  const formatter = dateFormat(lang);
  const displayDay = (date) => Number.isFinite(Date.parse(date)) ? formatter.format(new Date(date)) : "—";
  let profile = {};
  try { profile = JSON.parse(dog.profile) || {}; } catch {}
  let age;
  if (typeof profile.birth_date === "string" && Number.isFinite(Date.parse(profile.birth_date))) {
    const birth = new Date(profile.birth_date+"T00:00:00Z");
    const today = new Date(Date.now()+7*3600000);
    const last = new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)).getUTCDate();
    const months = (today.getUTCFullYear()-birth.getUTCFullYear())*12+today.getUTCMonth()-birth.getUTCMonth() -
      Number(today.getUTCDate() < Math.min(last,birth.getUTCDate()));
    if (Number.isFinite(months) && months>=0) {
      age = en ? Math.floor(months/12)+" yr "+months%12+" mo" : Math.floor(months/12)+" ปี "+months%12+" เดือน";
    }
  }
  const meta = [profile.breed,dogFacts[lang][profile.gender],dogFacts[lang][dog.size],age].filter(Boolean).join(" · ");
  const dates = day === "all" ? displayDay(dog.checkin)+" – "+displayDay(dog.checkout) : displayDay(day);
  const grouped = new Map();
  for (const event of events) {
    const date = event.recorded_at.slice(0,10);
    if (!grouped.has(date)) grouped.set(date,[]);
    grouped.get(date).push(event);
  }
  const cards = [...grouped.entries()].map(([eventDay,items]) => `<section><h2>${escape(displayDay(eventDay))}</h2>
    <div class="timeline">${items.map((item) => `<article><header><time>${escape(item.recorded_at.slice(11,16))}</time>
      <h3>${escape(careActivityName(item,lang))}</h3></header>
      ${item.note ? `<p>${escape(item.note)}</p>` : ""}
      ${item.photos.length ? `<div class="photos" data-count="${item.photos.length}">
        ${item.photos.map((photo) => picture(photo,en ? "Activity photo" : "รูปกิจกรรม")).join("")}</div>` : ""}
      </article>`).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Little Paws</title>
    <style>
    ${font ? `@font-face{font-family:LittlePawsFont;src:url('${font}') format('woff2');font-display:block}` : ""}
    :root{--accent:${accent};--tint:${tint}}*{box-sizing:border-box}
    html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#f2f5f2;color:#253831;font:17px/1.48 LittlePawsFont,"Sukhumvit Set","Noto Sans Thai",Garuda,system-ui,sans-serif}
    main{max-width:780px;margin:auto;padding:22px}
    .brand{border-radius:18px;padding:13px 17px;background:var(--accent);color:white;display:flex;align-items:center;gap:10px;font-size:15px}
    .brand .logo{width:45px;height:43px;object-fit:contain}.brand .mascot{width:100px;margin-inline-start:auto}
    .profile{margin:13px 0 18px;padding:19px 22px;background:var(--tint);border-radius:18px;display:flex;align-items:center;gap:17px;break-inside:avoid}
    .profile img,.dog-icon{width:95px;height:95px;object-fit:cover;border-radius:17px;flex:none}
    .dog-icon{display:flex;align-items:center;justify-content:center;background:#faebd5}.dog-icon svg{width:73px;height:73px}
    h1,h2,h3,p{margin:0}h1{font-size:36px;line-height:1.1;overflow-wrap:anywhere}
    .profile small{color:var(--accent);font-weight:700}.profile strong{display:block;margin:.3rem 0}.profile p{font-size:15px}
    h2{font-size:20px;color:var(--accent);margin:18px 0 8px;break-after:avoid}
    .timeline{border-inline-start:3px solid var(--tint);margin-inline-start:9px;padding-inline-start:15px}
    article{position:relative;border-radius:15px;padding:13px 16px;background:white;border:1px solid #dae5df;margin-bottom:10px;break-inside:avoid}
    article::before{content:"";position:absolute;inset-inline-start:-24px;top:22px;background:var(--accent);width:14px;height:14px;border:3px solid white;border-radius:50%}
    article header{display:flex;align-items:center;gap:10px}article h3{font-size:19px;overflow-wrap:anywhere}
    time{background:var(--tint);color:var(--accent);font-weight:bold;border-radius:30px;padding:3px 12px;white-space:nowrap}
    article p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
    .photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:9px;margin-top:9px}
    .photos[data-count="1"]{display:block}.photos img{display:block;max-width:100%;width:auto;height:auto;max-height:500px;object-fit:contain;border-radius:13px}
    .photos[data-count="1"] img{max-width:min(100%,470px)}
    footer{text-align:center;color:var(--accent);margin:22px 0 8px;font-size:13px;break-inside:avoid}
    footer strong{display:block;font-size:15px}
    @page{size:A4;margin:11mm}
    @media print{body{background:white}main{padding:0}.photos img{max-height:53mm}.photos[data-count="1"] img{max-height:104mm}}
    @media(max-width:480px){main{padding:11px}.profile{padding:13px;gap:10px}.profile img,.dog-icon{width:69px;height:69px}h1{font-size:28px}article{padding:10px}}
    ${format === "png" ? careImageCss : ""}</style></head><body><main>
    <header class="brand">${picture(logo,"Little Paws","logo")}<strong>Little Paws Homestay Phuket</strong>${picture(mascot,"","mascot")}</header>
    <section class="profile">${picture(profileImage,dog.name) || dogIcon}<div><small>${escape(title)}</small><h1>${escape(dog.name)}</h1>
    <strong>${en?"Owner":"เจ้าของ"} · ${escape(dog.owner)}</strong>${meta ? `<p>${escape(meta)}</p>` : ""}<p>${escape(dates)}</p></div></section>
    ${cards || `<p>${en?"No shared activities in this period.":"ยังไม่มีกิจกรรมที่แชร์ในช่วงนี้"}</p>`}
    <footer><strong>Little Paws, Big Love.</strong>${escape(slogan)}</footer></main></body></html>`;
}
