import {staffReply,careNotifications,markCareCommentsRead} from "./care_interactions.mjs";
import {stayCardDogs} from "./card_dogs.mjs";
import { receiveStayPayment, stayBalance, authorizedStaff } from "./stay_payments.mjs";
import { validDay, pendingBookings, bookingCalendar, bookingDetails, receiveBookingDeposit, deleteBookingDeposit } from "./bookings.mjs";
import { listCoupons, couponDetails, saveCoupon, archiveCoupon } from "./coupon_admin.mjs";
import { addCarePhoto, removeCarePhoto } from "./care_media.mjs";
import { staffTimeline, staffCarePhoto, manageTimelineLink, writeCareEvent, timelineOrigin } from "./care_staff.mjs";
import { exportCare } from "./care_exports.mjs";
import { exportDocument } from "./document_exports.mjs";
import { dashboardFinance } from "./dashboard_finance.mjs";
import { dashboardOverview } from "./dashboard.mjs";
import { staffAsset } from "./staff_assets.mjs";
import {reportFilters,makeReport,reportChoices} from "./reports.mjs";
import {exportReport} from "./report_exports.mjs";
import { ledgerBodyLimit, ledgerChoices, ledgerList, saveLedgerEntry, deleteLedgerEntry } from "./ledger.mjs";
import { staySummary } from "./stay_summary.mjs";
import { stayHistory } from "./stay_history.mjs";
import { removeStayPayment, cancelStay, recordStayRefund } from "./stay_payments.mjs";
import { checkInBooking, checkInDirect, previewDirectStay, previewCheckInCoupon, checkInTerms } from "./check_in.mjs";
import { saveBooking, archiveBooking, bookingRates } from "./booking_writes.mjs";
import { searchCustomers, customerDetails, saveCustomer, archiveCustomer } from "./customers.mjs";
import { dogPhoto, saveDogPhoto, photoLimit } from "./dog_photos.mjs";
import { saveDog, archiveDog } from "./dogs.mjs";
import {selectedTheme,systemSettings,saveSystemSetting,writeHoliday} from "./system_settings.mjs";
import { outstandingPage } from "./staff_ui.mjs";
import {accountDetails,userDirectory,saveUser,saveProfile,changePassword,userPhoto,saveUserPhoto,recheckIn} from './staff_users.mjs';
import {editStay} from './stay_edits.mjs';
import {cloudSnapshot,backupMedia} from './cloud_backup.mjs';
import {manualPage,guideImages} from './manual.mjs';
import {uiLanguage} from './ui_locale.mjs';
import {accessEmail} from './access_identity.mjs';

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
}

async function authorizedUser(env, ctx, request) {
  // Only the trusted Workers Access context can attest to login.
  if (!env.ACCESS_AUDIENCE || ctx?.access?.aud !== env.ACCESS_AUDIENCE) {
    console.warn('staff_access_denied', {reason: !env.ACCESS_AUDIENCE ? 'audience_unconfigured' : !ctx?.access ? 'trusted_context_missing' : 'audience_mismatch'});
    return null;
  }
  const identity = await ctx.access.getIdentity();
  const email = await accessEmail(request, env, identity);
  if (!email) {
    console.warn('staff_access_denied', {reason: 'identity_email_missing'});
    return null;
  }
  const user = await env.DB.prepare(`SELECT u.id,u.display_name,u.is_admin,u.session_version,u.needs_password,a.email FROM staff_access_identities a
    JOIN app_users u ON u.id=a.user_id WHERE a.email=? AND u.active=1`)
    .bind(email).first();
  if (!user) console.warn('staff_access_denied', {reason: 'active_mapping_missing'});
  return user;
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
    const careExportMatch = /^\/api\/stays\/(\d+)\/dogs\/(\d+)\/timeline\/export\.(html|pdf|png)$/.exec(url.pathname);
    const careMediaMatch = /^\/api\/stays\/(\d+)\/dogs\/(\d+)\/timeline\/events\/(\d+)\/photos(?:\/(\d+))?$/.exec(url.pathname);
    const careNotificationRoute = url.pathname === "/api/care/notifications";
    const timelineMatch = /^\/api\/stays\/(\d+)\/dogs\/(\d+)\/timeline(?:\/photos\/(\d+))?$/.exec(url.pathname);
    const staySummaryMatch = /^\/api\/stays\/(\d+)$/.exec(url.pathname);
    const documentMatch = /^\/api\/documents\/(booking|deposit|stay)\/(\d+)(?:\/(\d+))?\.(html|pdf|png)$/.exec(url.pathname);
    const couponMatch = /^\/api\/coupons(?:\/(\d+))?$/.exec(url.pathname);
    const directCheckIn = url.pathname === "/api/stays/check-in";
    const couponPreview = url.pathname === "/api/stays/check-in/coupon";
    const directPreview = url.pathname === "/api/stays/check-in/preview";
    const checkInMatch = /^\/api\/bookings\/(\d+)\/check-in$/.exec(url.pathname);
    const bookingMatch = /^\/api\/bookings\/(\d+)$/.exec(url.pathname);
    const receiptMatch = /^\/api\/receipts\/(\d+)$/.exec(url.pathname);
    const isFile = receiptMatch || url.pathname === "/api/payment-qr.jpg";
    const settings = url.pathname === "/api/settings";
    const holidayMatch = /^\/api\/settings\/holidays(?:\/(\d+))?$/.exec(url.pathname);
    const history = url.pathname === "/api/stays/history";
    const stayChangeMatch = /^\/api\/stays\/(\d+)\/(cancel|refund|payments\/(\d+))$/.exec(url.pathname);
    const ledgerMatch = /^\/api\/transactions(?:\/(new|\d+))?$/.exec(url.pathname);
    const assetMatch = /^\/static\/([a-zA-Z0-9._-]+)$/.exec(url.pathname);
    const overview = url.pathname === "/api/dashboard";
    const reportMatch = /^\/api\/reports\/(finance|balances|boarding|coupons|customers)(?:\.(html|pdf|png|xlsx))?$/.exec(url.pathname);
    const userMatch = /^\/api\/users(?:\/(\d+))?$/.exec(url.pathname);
    const accountMatch = /^\/api\/account(?:\/(profile|password|photo))?$/.exec(url.pathname);
    const reopenMatch = /^\/api\/stays\/(\d+)\/recheck-in$/.exec(url.pathname);
    const backupRoute=['/api/backup/snapshot','/api/backup/media'].includes(url.pathname);
    const manualMatch=/^\/api\/manual\/(?:(usage|backup)\.html|images\/([a-z]+)\.webp)$/.exec(url.pathname);
    if (!careNotificationRoute && !backupRoute && !manualMatch && !userMatch && !accountMatch && !reopenMatch && !match && !stayChangeMatch && !depositMatch && !dogMatch && !customerMatch && !bookingMatch && !checkInMatch && !couponMatch && !documentMatch && !directCheckIn && !directPreview && !couponPreview && !staySummaryMatch && !timelineMatch && !careMediaMatch && !careExportMatch && !isFile && !settings && !holidayMatch && !history && !ledgerMatch && !assetMatch && !overview && !reportMatch && !["/", "/api/account", "/api/dashboard/finance", "/api/customers", "/api/bookings", "/api/bookings/rates", "/api/bookings/calendar", "/api/bookings/pending", "/api/stays/outstanding", "/api/stays/current"].includes(url.pathname)) return json({error: "not_found"}, 404);
    try {
      const user = await authorizedUser(env, ctx, request);
      if (!user) return json({error: "access_required"}, 403);
      if (user.needs_password && !accountMatch && !assetMatch && url.pathname!=='/') return json({error:'password_change_required'},403);
      if(backupRoute){
        if(!user.is_admin)return json({error:'admin_required'},403);
        if(url.pathname.endsWith('/media')){
          if(request.method!=='GET')return json({error:'method_not_allowed'},405);
          const object=await backupMedia(env,url.searchParams.get('key'));
          return object ? new Response(object.body,{headers:{...JSON_HEADERS,'Content-Type':'application/octet-stream'}})
            : json({error:'not_found'},404);
        }
        if(request.method!=='POST')return json({error:'method_not_allowed'},405);
        if(request.headers.get('Origin')!==url.origin)return json({error:'invalid_origin'},403);
        const snapshot=await cloudSnapshot(env.DB);
        const stillAdmin=await authorizedUser(env,ctx,request);
        if(!stillAdmin?.is_admin)return json({error:'admin_required'},403);
        return json(snapshot,snapshot.error ? 413 : 200);
      }
      if(manualMatch){
        if(request.method!=='GET')return json({error:'method_not_allowed'},405);
        if(manualMatch[1])return manualPage(manualMatch[1]);
        if(!guideImages.includes(manualMatch[2]))return json({error:'not_found'},404);
        const object=await env.MEDIA.get('manual/'+manualMatch[2]+'.webp');
        return object ? new Response(object.body,{headers:{...JSON_HEADERS,'Content-Type':'image/webp'}}) : json({error:'not_found'},404);
      }
      if (userMatch || accountMatch || reopenMatch) {
        if (userMatch && !user.is_admin) return json({error:'admin_required'},403);
        const id=userMatch?.[1] ? Number(userMatch[1]) : reopenMatch ? Number(reopenMatch[1]) : null;
        if (id!==null && (!Number.isSafeInteger(id) || id<1)) return json({status:'not_found'},404);
        const action=accountMatch?.[1];
        if (request.method==='GET') {
          if (reopenMatch || (action && action!=='photo')) return json({error:'method_not_allowed'},405);
          if (userMatch) return id===null ? json({users:await userDirectory(env.DB,user)}) : json({error:'method_not_allowed'},405);
          if (action==='photo') {
            const photo=await userPhoto(env,user);
            return photo ? new Response(photo.body,{headers:{...JSON_HEADERS,'Content-Type':'image/jpeg'}}) : json({error:'not_found'},404);
          }
          return json({...await accountDetails(env.DB,user.id),displayName:user.display_name,isAdmin:!!user.is_admin});
        }
        const expected=userMatch ? (id===null ? 'POST' : 'PUT') : reopenMatch ? 'POST' : action==='photo' && request.method==='DELETE' ? 'DELETE' : 'PUT';
        if (request.method!==expected || (accountMatch && !action)) return json({error:'method_not_allowed'},405);
        if (request.headers.get('Origin')!==url.origin) return json({error:'invalid_origin'},403);
        const type=request.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase();
        let result;
        if (action==='photo') {
          if (request.method!=='DELETE' && type!=='image/jpeg') return json({error:'invalid_content_type'},415);
          const bytes=request.method==='DELETE' ? null : await boundedBody(request,photoLimit);
          if (request.method!=='DELETE' && !bytes) return json({status:'invalid_size'},413);
          result={status:await saveUserPhoto(env,bytes,user)};
        } else {
          if (type!=='application/json') return json({error:'invalid_content_type'},415);
          const form=await smallJson(request,8192);
          if (!form) return json({status:'invalid'},400);
          result=userMatch ? await saveUser(env.DB,id,form,user) : {status:reopenMatch ? await recheckIn(env.DB,id,form,user)
            : action==='profile' ? await saveProfile(env.DB,form,user) : await changePassword(env.DB,form,user)};
        }
        return json(result,{saved:200,invalid:400,invalid_credentials:401,forbidden:403,not_found:404,
          conflict:409,duplicate:409,last_admin:409,rate_limited:429}[result.status] || 400);
      }
      if(staySummaryMatch && request.method==='PUT'){
        const id=Number(staySummaryMatch[1]);
        if(!Number.isSafeInteger(id)||id<1)return json({status:'not_found'},404);
        if(request.headers.get('Origin')!==url.origin)return json({error:'invalid_origin'},403);
        if(request.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return json({error:'invalid_content_type'},415);
        const form=await smallJson(request,32768);if(!form)return json({status:'invalid'},400);
        const result=await editStay(env.DB,id,form,user);
        return json(result,{saved:200,warning:409,invalid:400,not_found:404,stay_closed:409,conflict:409,
          payment_exceeds:422,coupon_invalid:400,coupon_unavailable:422,coupon_minimum:422,coupon_exceeds:422}[result.status] || 400);
      }
      if (reportMatch) {
        if (!user.is_admin) return json({error:"admin_required"},403);
        if (request.method !== "GET") return json({error:"method_not_allowed"},405);
        const filters = reportFilters(url.searchParams);
        if (!filters) return json({error:"invalid_filters"},400);
        const report = await makeReport(env.DB,reportMatch[1],filters);
        if (report.error) return json(reportMatch[2] ? {error:report.error} : {report,choices:await reportChoices(env.DB)},422);
        return reportMatch[2] ? await exportReport(env,report,reportMatch[2]) : json({report,choices:await reportChoices(env.DB)});
      }
      if (assetMatch) return staffAsset(request,assetMatch[1]);
      if (ledgerMatch) {
        const raw = ledgerMatch[1];
        const id = raw && raw !== "new" ? Number(raw) : null;
        if (id !== null && (!Number.isSafeInteger(id) || id<1)) return json({error:"not_found"},404);
        if (request.method === "GET") {
          const page = raw ? await ledgerChoices(env.DB,id) : await ledgerList(env.DB,url.searchParams);
          return page ? json(page) : json({error:raw ? "not_found" : "invalid_search"},raw ? 404 : 400);
        }
        if (!(id === null ? raw !== "new" && request.method === "POST" : ["PUT","DELETE"].includes(request.method))) {
          return json({error:"method_not_allowed"},405);
        }
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        const contentType = request.headers.get("Content-Type") || "";
        let result;
        if (contentType.split(";",1)[0].trim().toLowerCase() === "application/json") {
          const form = await smallJson(request,16384);
          if (!form) return json({status:"invalid"},400);
          result = request.method === "DELETE" ? await deleteLedgerEntry(env,id,form.revision,user)
            : await saveLedgerEntry(env,id,form,null,user);
        } else if (request.method !== "DELETE" && /^multipart\/form-data;/i.test(contentType)) {
          const bytes = await boundedBody(request,ledgerBodyLimit);
          if (!bytes) return json({status:"invalid_size"},413);
          let data, form;
          try {
            data = await new Response(bytes,{headers:{"Content-Type":contentType}}).formData();
            const rawEntry = data.get("entry");
            if (typeof rawEntry !== "string" || rawEntry.length>16384) return json({status:"invalid"},400);
            form = JSON.parse(rawEntry);
          } catch { return json({status:"invalid"},400); }
          if (!form || Array.isArray(form) || typeof form !== "object") return json({status:"invalid"},400);
          result = await saveLedgerEntry(env,id,form,data.get("receipt"),user);
        } else return json({error:"invalid_content_type"},415);
        return json(result,{created:201,saved:200,deleted:200,invalid:400,invalid_receipt:400,
          not_found:404,conflict:409,storage_unavailable:503}[result.status]);
      }
      if (stayChangeMatch) {
        const stayId = Number(stayChangeMatch[1]);
        const action = stayChangeMatch[2];
        const paymentId = stayChangeMatch[3] === undefined ? null : Number(stayChangeMatch[3]);
        if (![stayId,paymentId ?? 1].every((id) => Number.isSafeInteger(id) && id > 0)) return json({error:"not_found"},404);
        if (request.method !== (paymentId === null ? "POST" : "DELETE")) return json({error:"method_not_allowed"},405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
          return json({error:"invalid_content_type"},415);
        }
        const form = await smallJson(request,8192);
        if (!form) return json({status:"invalid"},400);
        const status = paymentId !== null ? await removeStayPayment(env.DB,stayId,paymentId,form,user)
          : action === "cancel" ? await cancelStay(env.DB,stayId,form,user)
          : await recordStayRefund(env.DB,stayId,form,user);
        return json({status},{deleted:200,cancelled:200,duplicate:200,saved:201,invalid:400,forbidden:403,
          not_found:404,conflict:409,stay_closed:409,refund_exceeded:422}[status]);
      }
      if (settings || holidayMatch) {
        if (!user.is_admin) return json({error:"admin_required"},403);
        if (settings && request.method === "GET") return json(await systemSettings(env.DB));
        const id = holidayMatch?.[1] ? Number(holidayMatch[1]) : null;
        if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return json({error:"not_found"},404);
        const methods = settings ? ["PUT"] : id === null ? ["POST"] : ["PUT","DELETE"];
        if (!methods.includes(request.method)) return json({error:"method_not_allowed"},405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
          return json({error:"invalid_content_type"},415);
        }
        const data = await smallJson(request,65536);
        if (!data) return json({status:"invalid"},400);
        const status = settings ? await saveSystemSetting(env.DB,data,user)
          : await writeHoliday(env.DB,id,data,user,request.method);
        return json({status},{saved:200,invalid:400,conflict:409}[status]);
      }
      if (isFile) return await privateFile(request, env, receiptMatch);
      if (careExportMatch) {
        if (request.method !== "GET") return json({error:"method_not_allowed"},405);
        if (request.headers.get("Sec-Fetch-Site") === "cross-site") return json({error:"invalid_origin"},403);
        const [,rawStay,rawDog,format] = careExportMatch;
        const stayId = Number(rawStay), dogId = Number(rawDog);
        if (![stayId,dogId].every((id) => Number.isSafeInteger(id) && id > 0)) return json({error:"not_found"},404);
        const day = url.searchParams.get("day") || new Intl.DateTimeFormat("en-CA",{
          timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",
        }).format(new Date());
        if (day !== "all" && !validDay(day)) return json({error:"invalid_day"},400);
        const lang = url.searchParams.get("lang") === "en" ? "en" : "th";
        return await exportCare(env,stayId,dogId,{day,lang,format});
      }
      if (documentMatch) {
        if (request.method !== "GET") return json({error:"method_not_allowed"},405);
        if (request.headers.get("Sec-Fetch-Site") === "cross-site") return json({error:"invalid_origin"},403);
        const [,kind,rawId,rawPayment,format] = documentMatch;
        const id = Number(rawId);
        const paymentId = rawPayment ? Number(rawPayment) : null;
        if (![id,paymentId ?? 1].every((value) => Number.isSafeInteger(value) && value>0) ||
            (kind === "deposit") !== (paymentId !== null)) return json({error:"not_found"},404);
        const lang = url.searchParams.get("lang") === "en" ? "en" : "th";
        return await exportDocument(env,{kind,id,paymentId,format,lang});
      }
      if (careMediaMatch) {
        const [stayId,dogId,eventId,photoId] = careMediaMatch.slice(1).map((value) => value === undefined ? null : Number(value));
        if (![stayId,dogId,eventId,photoId ?? 1].every((id) => Number.isSafeInteger(id) && id > 0)) return json({error:"not_found"},404);
        if (request.method !== (photoId === null ? "POST" : "DELETE")) return json({error:"method_not_allowed"},405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        if (!env.MEDIA) return json({error:"temporarily_unavailable"},503);
        const scope = {stayId,dogId,eventId,photoId};
        let status;
        if (photoId === null) {
          if (request.headers.get("Content-Type") !== "image/jpeg") return json({error:"invalid_content_type"},415);
          const bytes = await boundedBody(request,photoLimit);
          if (!bytes) return json({error:"invalid_size"},413);
          status = await addCarePhoto(env.DB,env.MEDIA,scope,user,bytes,
            request.headers.get("X-Event-Revision"),request.headers.get("X-Upload-Key"));
        } else {
          if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
            return json({error:"invalid_content_type"},415);
          }
          const form = await smallJson(request);
          if (!form) return json({status:"invalid"},400);
          status = await removeCarePhoto(env.DB,env.MEDIA,scope,user,form);
        }
        return json({status},{saved:200,invalid:400,conflict:409}[status]);
      }
      if(careNotificationRoute){
        if(request.method!=="GET")return json({error:"method_not_allowed"},405);
        return json(await careNotifications(env.DB,user));
      }
      if (timelineMatch) {
        const [stayId,dogId,photoId] = timelineMatch.slice(1).map((value) => value === undefined ? null : Number(value));
        if (![stayId,dogId,photoId ?? 1].every((value) => Number.isSafeInteger(value) && value > 0)) {
          return json({error:"not_found"},404);
        }
        const origin = timelineOrigin(env.TIMELINE_ORIGIN);
        if (request.method === "GET") {
          if (photoId !== null) {
            if (!env.MEDIA) return json({error:"temporarily_unavailable"},503);
            const photo = await staffCarePhoto(env.DB,env.MEDIA,stayId,dogId,photoId);
            return photo ? new Response(photo.body,{headers:{...JSON_HEADERS,"Content-Type":"image/jpeg"}})
              : json({error:"not_found"},404);
          }
          const day = url.searchParams.get("day");
          const beforeAt = url.searchParams.get("before_at");
          const beforeId = Number(url.searchParams.get("before_id"));
          if ((day !== null && !validDay(day)) ||
              (beforeAt !== null && (beforeAt.length > 60 || !Number.isFinite(Date.parse(beforeAt)) ||
                !Number.isSafeInteger(beforeId) || beforeId < 1))) return json({error:"invalid_search"},400);
          const focused=url.searchParams.has("event_id") ? Number(url.searchParams.get("event_id")) : null;
          if(focused!==null && (!Number.isSafeInteger(focused)||focused<1))return json({error:"invalid_search"},400);
          const timeline = await staffTimeline(env.DB,stayId,dogId,day,
            beforeAt === null ? null : {recordedAt:beforeAt,id:beforeId},origin,Number(url.searchParams.get("preview") === "1"),focused);
          return timeline ? json(timeline) : json({error:"not_found"},404);
        }
        if (request.method !== "POST" || photoId !== null) return json({error:"method_not_allowed"},405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
          return json({error:"invalid_content_type"},415);
        }
        const form = await smallJson(request);
        if (!form) return json({error:"invalid"},400);
        if (form.action === "create" && !origin) return json({status:"origin_missing"},503);
        const result = form.action === "read-comments" ? await markCareCommentsRead(env.DB,stayId,dogId,form,user)
          : form.action === "reply-comment" ? await staffReply(env.DB,stayId,dogId,form,user)
          : ["add-event","edit-event","remove-event"].includes(form.action)
          ? await writeCareEvent(env.DB,env.MEDIA,stayId,dogId,form,user)
          : await manageTimelineLink(env.DB,stayId,dogId,form,user);
        const payload = typeof result === "string" ? {status:result} : result;
        return json(payload,{saved:200,invalid:400,conflict:409}[payload.status]);
      }
      if (couponMatch) {
        if (!user.is_admin) return json({error:"admin_required"},403);
        const id = couponMatch[1] ? Number(couponMatch[1]) : null;
        if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return json({error:"not_found"},404);
        if (request.method === "GET") {
          if (id !== null) {
            const coupon = await couponDetails(env.DB,id);
            return coupon ? json(coupon) : json({error:"not_found"},404);
          }
          const group = url.searchParams.get("status") || "active";
          const before = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER);
          if (!["active","used","expired"].includes(group) || !Number.isSafeInteger(before) || before < 1) {
            return json({error:"invalid_search"},400);
          }
          return json(await listCoupons(env.DB,group,before));
        }
        if (!(id === null ? ["POST"] : ["PUT","DELETE"]).includes(request.method)) {
          return json({error:"method_not_allowed"},405);
        }
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        let result;
        if (request.method === "DELETE") {
          result = await archiveCoupon(env.DB,id,user);
        } else {
          if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
            return json({error:"invalid_content_type"},415);
          }
          const form = await smallJson(request);
          if (!form) return json({error:"invalid"},400);
          result = await saveCoupon(env.DB,id,form,user);
        }
        return json(result,{created:201,saved:200,removed:200,invalid:400,conflict:409,not_found:404}[result.status]);
      }
      if (checkInMatch || directCheckIn || directPreview || couponPreview) {
        const id = checkInMatch ? Number(checkInMatch[1]) : null;
        if (checkInMatch && (!Number.isSafeInteger(id) || id < 1)) return json({error:"not_found"},404);
        if (request.method === "GET" && !directPreview && !couponPreview) return json(checkInTerms(url.searchParams.get("lang")));
        if (request.method !== "POST") return json({error:"method_not_allowed"},405);
        if (request.headers.get("Origin") !== url.origin) return json({error:"invalid_origin"},403);
        if (request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
          return json({error:"invalid_content_type"},415);
        }
        const form = await smallJson(request, 65536);
        if (!form) return json({error:"invalid"},400);
        const result = couponPreview ? await previewCheckInCoupon(env.DB,form,user) : directPreview ? await previewDirectStay(env.DB,form,user)
          : directCheckIn ? await checkInDirect(env.DB,form,user) : await checkInBooking(env.DB,id,form,user);
        return json(result, {ready:200,created:201,saved:200,invalid:400,consent_required:422,not_found:404,conflict:409,warning:409,coupon_invalid:400,
          coupon_unavailable:409,coupon_minimum:422,coupon_exceeds:422}[result.status]);
      }
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
        return json(result, {created:201,saved:200,removed:200,invalid:400,not_found:404,conflict:409,warning:409}[result.status]);
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
        if (url.pathname === "/") return outstandingPage(Boolean(user.is_admin),Boolean(env.BROWSER),await selectedTheme(env.DB),user.display_name,uiLanguage(url));
        if (url.pathname === "/api/account") {
          return json({id: user.id, displayName: user.display_name, isAdmin: !!user.is_admin});
        }
        if (url.pathname === "/api/dashboard/finance") {
          const period = await dashboardFinance(env.DB,url.searchParams.get("from"),url.searchParams.get("to"));
          return period ? json(period) : json({error:"invalid_range"},400);
        }
        if (overview) {
          const period = await dashboardOverview(env.DB,url.searchParams.get("from"),url.searchParams.get("to"));
          return period ? json(period) : json({error:"invalid_range"},400);
        }
        if (history) {
          const page = await stayHistory(env.DB,url.searchParams);
          return page ? json(page) : json({error:"invalid_search"},400);
        }
        if (staySummaryMatch) {
          const id = Number(staySummaryMatch[1]);
          if (!Number.isSafeInteger(id) || id < 1) return json({error:"not_found"},404);
          const summary = await staySummary(env.DB,id);
          return summary ? json(summary) : json({error:"not_found"},404);
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
        if (url.pathname === "/api/bookings/calendar") {
          const calendar = await bookingCalendar(env.DB,url.searchParams.get("start"),url.searchParams.get("end"));
          return calendar ? json(calendar) : json({error:"invalid_range"},400);
        }
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
        const {results} = await env.DB.prepare(`SELECT s.id,s.stay_number,s.status,s.checkin,s.checkout,${stayCardDogs} AS dog_photos,
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
