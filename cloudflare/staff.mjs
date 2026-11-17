import { receiveStayPayment, stayBalance, authorizedStaff } from "./stay_payments.mjs";
import { pendingBookings, bookingDetails } from "./bookings.mjs";
import { outstandingPage } from "./staff_ui.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
}

async function authorizedUser(env, ctx) {
  // Only the trusted Workers Access context can attest to login.
  if (!env.ACCESS_AUDIENCE || ctx?.access?.aud !== env.ACCESS_AUDIENCE) return null;
  const identity = await ctx.access.getIdentity();
  if (typeof identity?.email !== "string" || !identity.email) return null;
  return env.DB.prepare(`SELECT u.id,u.display_name,u.is_admin,a.email FROM staff_access_identities a
    JOIN app_users u ON u.id=a.user_id WHERE a.email=? AND u.active=1`)
    .bind(identity.email.trim().toLowerCase()).first();
}

async function smallJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const buffer = new Uint8Array(2048);
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (size + value.byteLength > buffer.length) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
    const data = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(buffer.subarray(0, size)));
    return data && !Array.isArray(data) && typeof data === "object" ? data : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function checkout(db, stayId, user) {
  if (!Number.isSafeInteger(stayId) || stayId < 1) return json({status: "invalid"}, 400);
  const [change, lookup] = await db.batch([
    db.prepare(`UPDATE stays SET status='completed',actual_checkout_at=?
      WHERE id=? AND status='checked_in' AND cancelled_at IS NULL AND ${authorizedStaff}`)
      .bind(new Date().toISOString(), stayId, user.id, user.email),
    db.prepare(`SELECT status,cancelled_at,(${authorizedStaff}) AS authorized FROM stays WHERE id=?`)
      .bind(user.id,user.email,stayId),
  ]);
  const stay = lookup.results[0];
  if (!stay) return json({status: "not_found"}, 404);
  if (!stay.authorized) return json({status: "forbidden"}, 403);
  if (change.meta.changes === 1 || (stay.status === "completed" && !stay.cancelled_at)) {
    return json({status: "completed"});
  }
  return json({status: "not_checked_in"}, 409);
}

async function privateFile(request, env, receiptMatch) {
  if (!["GET", "HEAD"].includes(request.method)) return json({error: "method_not_allowed"}, 405);
  const headers = new Headers(JSON_HEADERS);
  let key = "payment/payment-qr.jpg";
  headers.set("Content-Type", "image/jpeg");
  if (receiptMatch) {
    const id = Number(receiptMatch[1]);
    if (!Number.isSafeInteger(id) || id < 1) return json({error: "not_found"}, 404);
    const row = await env.DB.prepare("SELECT receipt FROM transactions WHERE id=?").bind(id).first();
    const name = row?.receipt;
    if (!name || name === "." || name === ".." || /[/\\\u0000-\u001f\u007f]/.test(name)) {
      return json({error: "not_found"}, 404);
    }
    key = `receipts/${name}`;
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="receipt-${id}"`);
    const extension = /\.(pdf|png|jpe?g|webp)$/i.exec(name)?.[0];
    if (extension) headers.set("Content-Disposition", `attachment; filename="receipt-${id}${extension}"`);
  }
  if (!env.MEDIA) return json({error: "temporarily_unavailable"}, 503);
  const head = request.method === "HEAD";
  const object = head ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if (!object) return json({error: "not_found"}, 404);
  return new Response(head ? null : object.body, {headers});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = /^\/api\/stays\/(\d+)\/(payments|check-out)$/.exec(url.pathname);
    const bookingMatch = /^\/api\/bookings\/(\d+)$/.exec(url.pathname);
    const receiptMatch = /^\/api\/receipts\/(\d+)$/.exec(url.pathname);
    const isFile = receiptMatch || url.pathname === "/api/payment-qr.jpg";
    if (!match && !bookingMatch && !isFile && !["/", "/api/account", "/api/bookings/pending", "/api/stays/outstanding", "/api/stays/current"].includes(url.pathname)) return json({error: "not_found"}, 404);
    try {
      const user = await authorizedUser(env, ctx);
      if (!user) return json({error: "access_required"}, 403);
      if (isFile) return await privateFile(request, env, receiptMatch);
      if (!match) {
        if (request.method !== "GET") return json({error: "method_not_allowed"}, 405);
        if (url.pathname === "/") return outstandingPage();
        if (url.pathname === "/api/account") {
          return json({id: user.id, displayName: user.display_name, isAdmin: !!user.is_admin});
        }
        if (bookingMatch) {
          const id = Number(bookingMatch[1]);
          if (!Number.isSafeInteger(id) || id < 1) return json({error: "not_found"}, 404);
          const details = await bookingDetails(env.DB, id);
          return details ? json(details) : json({error: "not_found"}, 404);
        }
        if (url.pathname === "/api/bookings/pending") {
          const after = Number(url.searchParams.get("after") || 0);
          const search = (url.searchParams.get("q") || "").trim().toLowerCase();
          if (!Number.isSafeInteger(after) || after < 0 || search.length > 100) {
            return json({error: "invalid_search"}, 400);
          }
          return json(await pendingBookings(env.DB, after, search));
        }
        const cursor = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(cursor) || cursor < 1) return json({error: "invalid_cursor"}, 400);
        const current = url.pathname === "/api/stays/current";
        const predicate = current
          ? "s.status='checked_in' AND COALESCE(substr(s.actual_checkin_at,1,10),s.checkin)<=date('now','+7 hours')"
          : `s.payment_tracking=1 AND s.status!='cancelled' AND ${stayBalance}>0`;
        const {results} = await env.DB.prepare(`SELECT s.id,s.stay_number,s.status,s.checkin,s.checkout,
            c.name AS customer,
            (SELECT group_concat(d.name, ', ') FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id
              WHERE sd.stay_id=s.id) AS dogs,
            CASE WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE 0 END AS due_cents
          FROM stays s JOIN customers c ON c.id=s.customer_id
          WHERE s.id<? AND s.cancelled_at IS NULL AND ${predicate}
          ORDER BY s.id DESC LIMIT 26`).bind(cursor).all();
        const stays = results.slice(0, 25);
        return json({stays, nextBefore: results.length > stays.length ? stays.at(-1).id : null});
      }
      if (request.method !== "POST") return json({error: "method_not_allowed"}, 405);
      if (request.headers.get("Origin") !== url.origin) return json({error: "invalid_origin"}, 403);
      if (match[2] === "check-out") return checkout(env.DB, Number(match[1]), user);
      if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return json({error: "invalid_content_type"}, 415);
      }
      const payment = await smallJson(request);
      if (!payment) return json({error: "invalid"}, 400);
      const status = await receiveStayPayment(env.DB, Number(match[1]), payment, user);
      return json({status}, {saved: 201, duplicate: 200, invalid: 400, forbidden: 403,
        not_found: 404, balance_exceeded: 409}[status]);
    } catch {
      return json({error: "temporarily_unavailable"}, 503);
    }
  },
};
