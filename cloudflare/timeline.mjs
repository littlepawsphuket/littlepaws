const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const thaiToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

function respond(body, status, moreHeaders = {}) {
  return new Response(body, { status, headers: { ...headers, ...moreHeaders } });
}

const missing = () => respond("Not found", 404);
export const shareExpiryHours = `CASE
  WHEN json_valid(cfg.value) AND json_type(cfg.value) = 'integer'
    THEN CAST(cfg.value AS INTEGER)
  ELSE 48 END`;
export const shareActive = `s.cancelled_at IS NULL AND (s.status='checked_in' OR
  (s.status='completed' AND julianday(s.actual_checkout_at) + (${shareExpiryHours}) / 24.0 > julianday('now')))`;
const activeLink = `FROM care_share_links l
  JOIN stays s ON s.id=l.stay_id
  JOIN stay_dogs sd ON sd.stay_id=l.stay_id AND sd.dog_id=l.dog_id
  JOIN dogs d ON d.id=l.dog_id
  LEFT JOIN system_settings cfg ON cfg.key='care_link_hours'`;
const activeCondition = `l.token=? AND ${shareActive}`;

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const labels = {
  "ให้อาหารแล้ว": "Fed", "ให้ยาแล้ว": "Medication given", "กิจกรรมอื่น": "Other activity",
  "ทานอาหาร": "Meal", "ให้ยา": "Medication", "เดินเล่น": "Walk", "เล่น": "Play", "พักผ่อน": "Rest",
};
const defaultLabels = {food: "ให้อาหารแล้ว", medicine: "ให้ยาแล้ว", custom: "กิจกรรมอื่น"};

async function timeline(env, token, url, printable = false) {
  const today = thaiToday.format(new Date());
  const day = url.searchParams.get("day") || today;
  if (day !== "all" && !datePattern.test(day)) return respond("Invalid date", 400);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "th";
  const en = lang === "en";
  const [links, days, activities] = await env.DB.batch([
    env.DB.prepare(`SELECT d.name, cfg.value AS expiry_hours ${activeLink} WHERE ${activeCondition}`).bind(token),
    env.DB.prepare(`SELECT DISTINCT substr(e.recorded_at,1,10) AS day ${activeLink}
      JOIN care_events e ON e.stay_id=l.stay_id AND e.dog_id=l.dog_id
      WHERE ${activeCondition} AND e.customer_visible=1 ORDER BY day DESC`).bind(token),
    env.DB.prepare(`SELECT e.kind,e.activity_label,e.recorded_at,e.note,
        (SELECT group_concat(p.id) FROM care_photos p WHERE p.event_id=e.id) AS photos
      ${activeLink} JOIN care_events e ON e.stay_id=l.stay_id AND e.dog_id=l.dog_id
      WHERE ${activeCondition} AND e.customer_visible=1
        AND (?='all' OR substr(e.recorded_at,1,10)=?)
      ORDER BY e.recorded_at DESC,e.id DESC`).bind(token, day, day),
  ]);
  const link = links.results[0];
  const visibleDays = days.results.map((row) => row.day);
  if (!link || (day !== "all" && day !== today && !visibleDays.includes(day))) return missing();

  const route = `/updates/${token}`;
  const dateLabel = (value) => new Intl.DateTimeFormat(en ? "en-GB" : "th-TH", {
    dateStyle: "medium", timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
  const dayLink = (value, label) => `<a href="${route}?day=${encodeURIComponent(value)}&amp;lang=${lang}"
    ${value === day ? 'aria-current="page"' : ""}>${escape(label)}</a>`;
  const availableDays = [...new Set([today, ...visibleDays])].sort().reverse();
  let lastDay = "";
  const cards = activities.results.map((event) => {
    const eventDay = event.recorded_at.slice(0, 10);
    const heading = eventDay !== lastDay ? `<h2>${escape(dateLabel(eventDay))}</h2>` : "";
    lastDay = eventDay;
    const label = event.activity_label || defaultLabels[event.kind] || defaultLabels.custom;
    const photos = (event.photos || "").split(",").filter((id) => /^\d+$/.test(id));
    const photoPath = printable ? url.origin + route : route;
    return `${heading}<article><h3><time>${escape(event.recorded_at.slice(11, 16))}</time>
      ${escape(en ? labels[label] || label : label)}</h3><p>${escape(event.note)}</p>
      <div class="photos">${photos.map((id) => `<img loading="${printable ? "eager" : "lazy"}" src="${photoPath}/photos/${id}"
      alt="${en ? "Activity photo" : "รูปกิจกรรม"}">`).join("")}</div></article>`;
  }).join("");
  const expiryHours = link.expiry_hours === null ? 48 : Number(link.expiry_hours);
  const hours = Number.isInteger(expiryHours) ? expiryHours : 48;
  const title = en ? "Activity timeline" : "ไทม์ไลน์กิจกรรม";
  const pdf = env.BROWSER && env.PUBLIC_ORIGIN === url.origin
    ? `<a href="${route}/timeline.pdf?day=${encodeURIComponent(day)}&amp;lang=${lang}">${en ? "Download PDF" : "ดาวน์โหลด PDF"}</a>` : "";
  const controls = printable ? "" : `<nav aria-label="${en ? "Choose a day" : "เลือกวัน"}">
    ${dayLink("all", en ? "All days" : "ทั้งหมด")}
    ${availableDays.map((value) => dayLink(value, value === today ? (en ? "Today" : "วันนี้") : dateLabel(value))).join("")}</nav>`;
  const viewerLinks = printable ? "" : `<div class="viewer-links">
    <a href="${route}?day=${encodeURIComponent(day)}&amp;lang=${en ? "th" : "en"}">${en ? "ไทย" : "English"}</a>${pdf}</div>`;
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Little Paws</title>
    <style>
    body{margin:0;background:#f2f7f3;color:#203c30;font:1rem/1.5 "Sukhumvit Set",system-ui,sans-serif}
    main{max-width:52rem;margin:auto;padding:1.15rem}header,article{background:#fff;border:1px solid #c9ded2;border-radius:1rem;padding:1rem}
    h1,h3{margin:.25rem 0}nav{display:flex;gap:.4rem;overflow:auto;padding:.65rem 0}
    a{color:#155747}nav a{flex:none;padding:.45rem .75rem;border-radius:2rem;background:#fff;text-decoration:none}
    a[aria-current]{color:#fff;background:#155747}article{margin-bottom:.6rem}
    time{background:#e3f2e9;padding:.2rem .5rem;border-radius:.75rem}
    article p{white-space:pre-wrap;overflow-wrap:anywhere}.photos{display:flex;gap:.5rem;flex-wrap:wrap}
    img{width:min(100%,20rem);height:auto;border-radius:.8rem}footer{padding:1rem 0}
    .viewer-links{display:flex;gap:1rem}
    @page{size:A4;margin:14mm}
    @media print{main{padding:0}article{break-inside:avoid}img{max-height:145mm;object-fit:contain}}
    </style><main><header><strong>Little Paws Homestay Phuket</strong><h1>${title} · ${escape(link.name)}</h1>
    ${viewerLinks}</header>${controls}
    ${cards || `<p>${en ? "No activities yet." : "ยังไม่มีกิจกรรม"}</p>`}
    <footer>${en ? `This link expires within ${hours} hours after check-out.` : `ลิงก์นี้จะหมดอายุภายใน ${hours} ชั่วโมงหลังเช็กเอาต์`}</footer>
    </main></html>`;
  return respond(html, 200, {"Content-Type": "text/html; charset=utf-8", "Content-Language": lang});
}

async function timelinePdf(env, token, url) {
  if (!env.BROWSER || env.PUBLIC_ORIGIN !== url.origin || url.protocol !== "https:") return missing();
  const view = await timeline(env, token, url, true);
  if (view.status !== 200) return view;
  const pdf = await env.BROWSER.quickAction("pdf", {
    html: await view.text(),
    pdfOptions: {format:"A4", printBackground:true, preferCSSPageSize:true, displayHeaderFooter:false},
  });
  if (!pdf.ok || !pdf.headers.get("Content-Type")?.toLowerCase().startsWith("application/pdf")) {
    await pdf.body?.cancel();
    return respond("PDF temporarily unavailable", 503);
  }
  const active = await env.DB.prepare(`SELECT 1 ${activeLink} WHERE ${activeCondition}`).bind(token).first();
  if (!active) {
    await pdf.body?.cancel();
    return missing();
  }
  return respond(pdf.body, 200, {
    "Content-Type":"application/pdf",
    "Content-Disposition":'attachment; filename="little-paws-timeline.pdf"',
    "Content-Language": view.headers.get("Content-Language"),
  });
}

async function photo(env, token, id) {
  const row = await env.DB.prepare(`SELECT p.object_key ${activeLink}
    JOIN care_events e ON e.stay_id=l.stay_id AND e.dog_id=l.dog_id
    JOIN care_photos p ON p.event_id=e.id
    WHERE ${activeCondition} AND e.customer_visible=1 AND p.id=?`).bind(token, id).first();
  if (!row?.object_key || !/^care\/\d+\.jpg$/.test(row.object_key)) return missing();
  const object = await env.MEDIA.get(row.object_key);
  return object ? respond(object.body, 200, {"Content-Type": "image/jpeg"}) : missing();
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return respond("Method not allowed", 405, {Allow:"GET"});
    const url = new URL(request.url);
    const path = url.pathname.split("/");
    const token = path[2];
    if (path[1] !== "updates" || !tokenPattern.test(token || "")) return missing();
    try {
      if (path.length === 3) {
        const page = await timeline(env, token, url);
        const speculative = ["Purpose","Sec-Purpose"].some((name) =>
          request.headers.get(name)?.toLowerCase().includes("prefetch"));
        if (page.ok && !speculative) {
          await env.DB.prepare(`UPDATE care_share_links SET view_count=view_count+1
            WHERE token IN (SELECT l.token ${activeLink} WHERE ${activeCondition})`).bind(token).run();
        }
        return page;
      }
      if (path.length === 4 && path[3] === "timeline.pdf") return await timelinePdf(env, token, url);
      if (path.length === 5 && path[3] === "photos" && /^\d+$/.test(path[4])) {
        const id = Number(path[4]);
        if (Number.isSafeInteger(id) && id > 0) return await photo(env, token, id);
      }
      return missing();
    } catch {
      return respond("Temporarily unavailable", 503);
    }
  },
};
