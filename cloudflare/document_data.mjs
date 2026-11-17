import {bookingDetails} from "./bookings.mjs";
import {staySummary} from "./stay_summary.mjs";
import {validDogPhotoKey} from "./timeline.mjs";
import {selectedTheme} from "./system_settings.mjs";

function base64(bytes) {
  let text = "";
  for (let start=0; start<bytes.length; start+=16384) {
    text += String.fromCharCode(...bytes.subarray(start,start+16384));
  }
  return btoa(text);
}

async function inlineAsset(media,key,type,limit) {
  if (!media) return null;
  const object = await media.get(key);
  if (!object || (object.size !== undefined && object.size > limit)) {
    if (object?.body?.cancel) await object.body.cancel();
    return null;
  }
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return bytes.length <= limit ? "data:"+type+";base64,"+base64(bytes) : null;
}

export async function documentAssets(env) {
  const theme = await selectedTheme(env.DB);
  let budget = 5 * 1024 * 1024;
  async function asset(key,type,limit) {
    if (budget < 64) return null;
    const value = await inlineAsset(env.MEDIA,key,type,Math.min(limit,Math.floor((budget-64)*3/4)));
    if (value) budget -= value.length;
    return value;
  }
  const font = await asset("brand/sukhumvit-set.woff2","font/woff2",512*1024);
  const logo = await asset("brand/little-paws-logo.png","image/png",512*1024);
  const mascot = theme === "classic" ? null : await asset("brand/mascot-"+theme+".webp","image/webp",768*1024);
  return {theme,font,logo,mascot,asset};
}

export async function documentData(env, kind, id, paymentId, format, lang) {
  const db = env.DB;
  const record = kind === "stay" ? await staySummary(db,id) : await bookingDetails(db,id);
  if (!record) return null;
  let deposit;
  if (kind === "deposit") {
    deposit = record.payments.find((payment) => payment.id === paymentId && payment.payment_type === "deposit");
    if (!deposit) return null;
  }
  const dogIds = record.dogs.map((dog) => dog.id);
  const [photos,stayExtras] = await db.batch([
    db.prepare(`SELECT dog_id,object_key FROM dog_photos WHERE dog_id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(dogIds)),
    db.prepare(`SELECT c.owner_phone,c.line_id,
      (SELECT ${lang === "en" ? "COALESCE(terms_en,terms)" : "terms"} FROM stay_consents WHERE stay_id=s.id ORDER BY id DESC LIMIT 1) AS terms,
      (SELECT json_group_array(json_object('date',t.occurred_on,'amount',t.amount))
       FROM transactions t WHERE t.stay_id=s.id AND t.kind='refund') AS refunds
      FROM stays s JOIN customers c ON c.id=s.customer_id WHERE s.id=?`).bind(kind === "stay" ? id : null),
  ]);
  const {theme,font,logo,mascot,asset} = await documentAssets(env);
  const extras = stayExtras.results[0] || {};
  const photoMap = new Map(photos.results.map((row) => [row.dog_id,row.object_key]));
  const dogs = [];
  for (const dog of record.dogs) {
    const key = photoMap.get(dog.id);
    dogs.push({...dog,image:validDogPhotoKey(key,dog.id) ? await asset(key,"image/jpeg",512*1024) : null});
  }
  const qr = kind === "stay" && record.status !== "cancelled" && record.due_cents > 0 ? await asset("payment/payment-qr.jpg","image/jpeg",512*1024) : null;
  function parse(value,fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }
  return {
    ...record, kind, format, lang, theme, dogs, logo, mascot, font, qr, deposit,
    terms:format === "pdf" ? parse(extras.terms,null) : null, refunds:parse(extras.refunds,[]),
    contact:record.contact || [extras.owner_phone,extras.line_id].filter(Boolean).join(" / "),
  };
}
