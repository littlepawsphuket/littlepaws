import { receiveStayPayment, stayBalance, authorizedStaff } from "./stay_payments.mjs";
import { pendingBookings, bookingDetails, receiveBookingDeposit, deleteBookingDeposit } from "./bookings.mjs";
import { saveBooking, archiveBooking, bookingRates } from "./booking_writes.mjs";
import { searchCustomers, customerDetails, saveCustomer, archiveCustomer } from "./customers.mjs";
import { dogPhoto, saveDogPhoto, photoLimit } from "./dog_photos.mjs";
import { saveDog, archiveDog } from "./dogs.mjs";
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

async function boundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const buffer = new Uint8Array(limit);
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
    return buffer.subarray(0, size);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function smallJson(request, limit = 2048) {
  const bytes = await boundedBody(request, limit);
  if (!bytes) return null;
  try {
    const data = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes));
    return data && !Array.isArray(data) && typeof data === "object" ? data : null;
  } catch {
    return null;
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
    const depositMatch = /^\/api\/bookings\/(\d+)\/deposits(?:\/(\d+))?$/.exec(url.pathname);
    const dogMatch = /^\/api\/customers\/(\d+)\/dogs(?:\/(\d+))?$/.exec(url.pathname);
    const customerMatch = /^\/api\/customers\/(\d+)(?:\/dogs\/(\d+)\/photo)?$/.exec(url.pathname);
    const bookingMatch = /^\/api\/bookings\/(\d+)$/.exec(url.pathname);
    const receiptMatch = /^\/api\/receipts\/(\d+)$/.exec(url.pathname);
    const isFile = receiptMatch || url.pathname === "/api/payment-qr.jpg";
    if (!match && !depositMatch && !dogMatch && !customerMatch && !bookingMatch && !isFile && !["/", "/api/account", "/api/customers", "/api/bookings", "/api/bookings/rates", "/api/bookings/pending", "/api/stays/outstanding", "/api/stays/current"].includes(url.pathname)) return json({error: "not_found"}, 404);
    try {
      const user = await authorizedUser(env, ctx);
      if (!user) return json({error: "access_required"}, 403);
      if (isFile) return await privateFile(request, env, receiptMatch);
      if (request.method !== "GET" && (bookingMatch || url.pathname === "/api/bookings")) {
        const id = bookingMatch ? Number(bookingMatch[1]) : null;
        if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return json({error:"not_found"}, 404);
        if (!(id === null ? ["POST"] : ["PUT","DELETE"]).includes(request.method)) return json({error:"method_not_allowed"}, 405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"}, 403);
        let result;
        if (request.method === "DELETE") {
          result = await archiveBooking(env.DB, id, user);
        } else {
          if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
            return json({error:"invalid_content_type"}, 415);
          }
          const form = await smallJson(request, 8192);
          if (!form) return json({error:"invalid"}, 400);
          result = await saveBooking(env.DB, id, form, user);
        }
        return json(result, {created:201,saved:200,removed:200,invalid:400,not_found:404,conflict:409}[result.status]);
      }
      if (customerMatch?.[2] && request.method === "PUT") {
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"}, 403);
        if (request.headers.get("Content-Type") !== "image/jpeg") return json({error:"invalid_content_type"}, 415);
        if (!env.MEDIA) return json({error:"temporarily_unavailable"}, 503);
        const [customerId,dogId] = customerMatch.slice(1).map(Number);
        if (![customerId,dogId].every((id) => Number.isSafeInteger(id) && id > 0)) return json({error:"not_found"}, 404);
        const bytes = await boundedBody(request, photoLimit);
        if (!bytes) return json({error:"invalid_size"}, 413);
        const status = await saveDogPhoto(env.DB, env.MEDIA, customerId, dogId, bytes, user);
        return json({status}, {saved:200,invalid:400,not_found:404}[status]);
      }
      if (dogMatch) {
        const customerId = Number(dogMatch[1]);
        const dogId = dogMatch[2] ? Number(dogMatch[2]) : null;
        if (![customerId, dogId ?? 1].every((id) => Number.isSafeInteger(id) && id > 0)) return json({error:"not_found"}, 404);
        const methods = dogId === null ? ["POST"] : ["PUT", "DELETE"];
        if (!methods.includes(request.method)) return json({error:"method_not_allowed"}, 405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"}, 403);
        let status;
        if (request.method === "DELETE") {
          status = await archiveDog(env.DB, customerId, dogId, user);
        } else {
          if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
            return json({error:"invalid_content_type"}, 415);
          }
          const form = await smallJson(request, 16384);
          if (!form) return json({error:"invalid"}, 400);
          status = await saveDog(env.DB, customerId, dogId, form, user);
        }
        return json({status}, {created:201,saved:200,archived:200,invalid:400,not_found:404}[status]);
      }
      if (request.method !== "GET" && (url.pathname === "/api/customers" || (customerMatch && !customerMatch[2]))) {
        const id = customerMatch ? Number(customerMatch[1]) : null;
        if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return json({error:"not_found"}, 404);
        const methods = id === null ? ["POST"] : ["PUT", "DELETE"];
        if (!methods.includes(request.method)) return json({error:"method_not_allowed"}, 405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"}, 403);
        let result;
        if (request.method === "DELETE") {
          result = await archiveCustomer(env.DB, id, user);
        } else {
          if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
            return json({error:"invalid_content_type"}, 415);
          }
          const form = await smallJson(request, 12288);
          if (!form) return json({error:"invalid"}, 400);
          result = await saveCustomer(env.DB, id, form, user);
        }
        return json(result, {created:201,saved:200,archived:200,invalid:400,not_found:404}[result.status]);
      }
      if (!match && !depositMatch) {
        if (request.method !== "GET") return json({error: "method_not_allowed"}, 405);
        if (url.pathname === "/") return outstandingPage();
        if (url.pathname === "/api/account") {
          return json({id: user.id, displayName: user.display_name, isAdmin: !!user.is_admin});
        }
        if (customerMatch) {
          const id = Number(customerMatch[1]);
          if (!Number.isSafeInteger(id) || id < 1) return json({error: "not_found"}, 404);
          if (customerMatch[2]) {
            const dogId = Number(customerMatch[2]);
            if (!Number.isSafeInteger(dogId) || dogId < 1) return json({error: "not_found"}, 404);
            if (!env.MEDIA) return json({error: "temporarily_unavailable"}, 503);
            const photo = await dogPhoto(env.DB, env.MEDIA, id, dogId);
            return photo ? new Response(photo.body, {headers:{...JSON_HEADERS,"Content-Type":"image/jpeg"}})
              : json({error: "not_found"}, 404);
          }
          const offset = Number(url.searchParams.get("offset") || 0);
          if (!Number.isSafeInteger(offset) || offset < 0) return json({error: "invalid_cursor"}, 400);
          const details = await customerDetails(env.DB, id, offset);
          return details ? json(details) : json({error: "not_found"}, 404);
        }
        if (url.pathname === "/api/bookings") return json({error:"method_not_allowed"},405);
        if (url.pathname === "/api/bookings/rates") return json(await bookingRates(env.DB));
        if (bookingMatch) {
          const id = Number(bookingMatch[1]);
          if (!Number.isSafeInteger(id) || id < 1) return json({error: "not_found"}, 404);
          const details = await bookingDetails(env.DB, id);
          return details ? json(details) : json({error: "not_found"}, 404);
        }
        if (["/api/customers", "/api/bookings/pending"].includes(url.pathname)) {
          const after = Number(url.searchParams.get("after") || 0);
          const search = (url.searchParams.get("q") || "").trim().toLowerCase();
          if (!Number.isSafeInteger(after) || after < 0 || search.length > 100) {
            return json({error: "invalid_search"}, 400);
          }
          return json(await (url.pathname === "/api/customers" ? searchCustomers : pendingBookings)(env.DB, after, search));
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
      if (request.method !== (depositMatch?.[2] ? "DELETE" : "POST")) return json({error: "method_not_allowed"}, 405);
      if (request.headers.get("Origin") !== url.origin) return json({error: "invalid_origin"}, 403);
      if (match?.[2] === "check-out") return checkout(env.DB, Number(match[1]), user);
      if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return json({error: "invalid_content_type"}, 415);
      }
      const payment = await smallJson(request);
      if (!payment) return json({error: "invalid"}, 400);
      if (depositMatch?.[2]) {
        const status = await deleteBookingDeposit(env.DB, Number(depositMatch[1]), Number(depositMatch[2]), payment, user);
        return json({status}, {deleted:200, invalid:400, forbidden:403, not_found:404, booking_closed:409}[status]);
      }
      const status = depositMatch
        ? await receiveBookingDeposit(env.DB, Number(depositMatch[1]), payment, user)
        : await receiveStayPayment(env.DB, Number(match[1]), payment, user);
      return json({status}, {saved: 201, duplicate: 200, invalid: 400, forbidden: 403,
        not_found: 404, balance_exceeded: 409, booking_closed: 409}[status]);
    } catch {
      return json({error: "temporarily_unavailable"}, 503);
    }
  },
};
