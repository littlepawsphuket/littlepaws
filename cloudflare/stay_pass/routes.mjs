import {approvePolicy} from './policy_approval.mjs';
import {initialPolicy} from './policy_content.mjs';
import {saleDrafts,saveSaleDraft,quoteDraftPayment,cancelSaleDraft,recordDraftPayment} from './sale_drafts.mjs';
import {quotePetRegistration,confirmPetRegistration,petRegistrationHistory} from './pet_registration.mjs';
import {availabilitySettings,saveAvailability} from './availability.mjs';
import {quoteTransfer,confirmTransfer,transferHistory} from './transfers.mjs';
import {templateSettings,templatePreview,saveTemplate} from './template_settings.mjs';
import {imageAssets} from './image_assets.mjs';
import {imageHtml,imagePageSpecs} from './image_layout.mjs';
import {passDashboard,passReport,reportCsv,reportDisplay} from './reporting.mjs';
import {lifecycleReview,confirmLifecycle,processExpirations} from './lifecycle.mjs';
import {stayCashReview,recordStayCash} from './stay_cash.mjs';
import {bookingCashReview,recordBookingCash} from './booking_cash.mjs';
import {quotePassExtension,confirmPassExtension} from './extensions.mjs';
import {quoteCancellation,confirmCancellation,cancellationHistory} from './cancellations.mjs';
import {quotePassCheckout,confirmPassCheckout,checkoutHistory} from './checkout.mjs';
import {prepareImage,templateImageSnapshot,previewImage,generateImage,imageHistory,imageRecord,storedImageFile} from './images.mjs';
import {quoteRenewal,recordRenewal,renewalHistory} from './renewals.mjs';
import {quoteRefund,requestRefund,actOnRefund,refundList} from './refunds.mjs';
import {passList,passDetail} from './read_models.mjs';
import {quotePassCheckin} from './checkin.mjs';
import {quotePassBooking,convertPassBooking,passBookingOptions,passOptionsForBooking} from './booking.mjs';
import {quoteSale,salesCustomers,salesPets,recordPaidSale} from './sales.mjs';
import {catalog,savePlan,savePrice,savePolicyDraft} from './repository.mjs';
import {pricePreview} from './pricing.mjs';
import {releaseGates} from './rules.mjs';
import {stayPassPage} from './page.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
export const isStayPassRoute=path=>path==='/stay-pass'||path==='/api/stay-pass'||path.startsWith('/api/stay-pass/');
export const previewEnabled=env=>env.STAY_PASS_PREVIEW==='1'&&['development','staging'].includes(env.STAY_PASS_ENVIRONMENT);
export const productionEnabled=env=>env.STAY_PASS_ENVIRONMENT==='production'&&env.STAY_PASS_ENABLED==='1'&&env.STAY_PASS_RELEASE==='v1.9';
export const stayPassEnabled=env=>previewEnabled(env)||productionEnabled(env);
export const salesWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_SALES_WRITES==='1';
export const renewalWritesEnabled=env=>salesWritesEnabled(env)&&env.STAY_PASS_RENEWAL_WRITES==='1';
export const cancellationWritesEnabled=env=>bookingWritesEnabled(env)&&env.STAY_PASS_CANCELLATION_WRITES==='1';
export const petWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_PET_WRITES==='1';
export const transferWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_TRANSFER_WRITES==='1';
export const templateWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_TEMPLATE_WRITES==='1';
export const lifecycleWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_LIFECYCLE_WRITES==='1';
export const stayCashWritesEnabled=env=>bookingWritesEnabled(env)&&env.STAY_PASS_STAY_CASH_WRITES==='1';
export const bookingCashWritesEnabled=env=>bookingWritesEnabled(env)&&env.STAY_PASS_BOOKING_CASH_WRITES==='1';
export const extensionWritesEnabled=env=>bookingWritesEnabled(env)&&env.STAY_PASS_EXTENSION_WRITES==='1';
export const checkoutWritesEnabled=env=>bookingWritesEnabled(env)&&env.STAY_PASS_CHECKOUT_WRITES==='1';
export const imageWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_IMAGE_WRITES==='1';
export const refundWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_REFUND_WRITES==='1';
export const bookingWritesEnabled=env=>stayPassEnabled(env)&&env.STAY_PASS_BOOKING_WRITES==='1';
async function body(request){
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return null;
 const reader=request.body?.getReader();if(!reader)return null;let total=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>98304){await reader.cancel();return null;}chunks.push(value);}const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{return null;}finally{reader.releaseLock();}
}
export async function stayPassRoute(request,env,actor,{theme='classic',lang='th'}={}){
 if(!stayPassEnabled(env))return json({error:'not_found'},404);
 if(!actor?.is_admin)return json({error:'admin_required'},403);
 const url=new URL(request.url),path=url.pathname;
 try{
  if(request.method==='GET'){
   if(path==='/api/stay-pass/templates/render'){
    let config;try{config=JSON.parse(url.searchParams.get('config')||'null');}catch{return json({status:'invalid_template'},400);}
    const preview=await templatePreview(env.DB,{config},actor),prepared=await prepareImage(env.DB,{passId:url.searchParams.get('pass'),kind:'usage',language:url.searchParams.get('language')||'th'},actor),width=Number(url.searchParams.get('width')||390),page=Number(url.searchParams.get('page')||0);
    if(![320,375,390,430,768,1080].includes(width)||!Number.isSafeInteger(page)||page<0||page>=128)return json({status:'invalid_template'},400);
    const draft=await templateImageSnapshot(env.DB,prepared.snapshot,preview.config);return new Response(imageHtml(draft,await imageAssets(env,draft),page,{previewWidth:width}),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
   }
   if(path==='/api/stay-pass/drafts')return json(await saleDrafts(env.DB,url.searchParams.get('plan'),actor));
   if(path==='/api/stay-pass/pets/history')return json(await petRegistrationHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/transfers')return json(await transferHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/availability')return json(await availabilitySettings(env.DB,url.searchParams.get('plan'),actor));
   if(path==='/api/stay-pass/policy-default')return json({status:'ready',policy:initialPolicy});
   if(path==='/api/stay-pass/templates')return json(await templateSettings(env.DB,actor));
   if(path==='/api/stay-pass/dashboard')return json(await passDashboard(env.DB,actor,new Date(),Object.fromEntries(url.searchParams)));
   if(['/api/stay-pass/reports','/api/stay-pass/reports.csv'].includes(path)){const report=await passReport(env.DB,Object.fromEntries(url.searchParams),actor),display=reportDisplay(report,url.searchParams.get('language')||'th');if(path.endsWith('.csv'))return new Response(reportCsv({...report,rows:reportDisplay(report,url.searchParams.get('language')||'th',{csv:true}).rows}),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=stay-pass-'+report.type+'.csv','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});return json({...report,display});}
   if(path==='/api/stay-pass/lifecycle')return json(await lifecycleReview(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/stay-cash')return json(await stayCashReview(env.DB,Number(url.searchParams.get('stay')),actor));
   if(path==='/api/stay-pass/booking-cash')return json(await bookingCashReview(env.DB,Number(url.searchParams.get('booking')),actor));
   if(path==='/api/stay-pass/cancellations')return json(await cancellationHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/checkout-history')return json(await checkoutHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/images')return json(await imageHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/images/preview'){const width=Number(url.searchParams.get('width')||390);if(![320,375,390,430,768,1080].includes(width))return json({status:'invalid_image_request'},400);return await previewImage(env,{passId:url.searchParams.get('pass'),kind:url.searchParams.get('kind'),language:url.searchParams.get('language')},url.searchParams.get('quote'),Number(url.searchParams.get('page')||0),width,actor);}
   const imageFile=/^\/api\/stay-pass\/images\/([a-f0-9-]{36})\/(\d+)\.(html|png|jpg)$/.exec(path);if(imageFile)return await storedImageFile(env,imageFile[1],Number(imageFile[2]),imageFile[3],actor,{download:url.searchParams.get('download')==='1'});
   const imageInfo=/^\/api\/stay-pass\/images\/([a-f0-9-]{36})$/.exec(path);if(imageInfo)return json(await imageRecord(env.DB,imageInfo[1],actor));
   if(path==='/api/stay-pass/renewals')return json(await renewalHistory(env.DB,url.searchParams.get('pass'),actor));
   if(path==='/api/stay-pass/refunds')return json(await refundList(env.DB,{passId:url.searchParams.get('pass')||'',status:url.searchParams.get('status')||'',offset:Number(url.searchParams.get('offset')||0)},actor));
   if(path==='/api/stay-pass/passes')return json(await passList(env.DB,{search:url.searchParams.get('search')||'',status:url.searchParams.get('status')||'',offset:Number(url.searchParams.get('offset')||0)},actor));
   const passMatch=/^\/api\/stay-pass\/passes\/([^/]+)$/.exec(path);if(passMatch){const result=await passDetail(env.DB,decodeURIComponent(passMatch[1]),actor);return json(result,result.status==='not_found'?404:200);}
   if(path==='/api/stay-pass/status')return json({stage:productionEnabled(env)?'production':'development',release_gates:{...releaseGates,sales:salesWritesEnabled(env),booking:bookingWritesEnabled(env),refund:refundWritesEnabled(env),renewal:renewalWritesEnabled(env),imageGenerator:imageWritesEnabled(env)},development_booking_writes:bookingWritesEnabled(env)});
   if(path==='/api/stay-pass/sales/customers')return json({customers:await salesCustomers(env.DB,actor)});
   if(path==='/api/stay-pass/sales/pets')return json({pets:await salesPets(env.DB,Number(url.searchParams.get('customer')),actor)});
   if(path==='/api/stay-pass/booking-search')return json(await passBookingOptions(env.DB,{search:url.searchParams.get('search')||''},actor));
   if(path==='/api/stay-pass/booking-options')return json(await passOptionsForBooking(env.DB,Number(url.searchParams.get('booking')),actor));
   if(path==='/api/stay-pass/booking-quote')return json(await quotePassBooking(env.DB,{passId:url.searchParams.get('pass'),bookingId:Number(url.searchParams.get('booking'))},actor));
   if(path==='/api/stay-pass/catalog')return json({...await catalog(env.DB),runtime:productionEnabled(env)?'production':'preview'});
   if(path==='/stay-pass')return stayPassPage({catalog:{...await catalog(env.DB),runtime:productionEnabled(env)?'production':'preview'},production:productionEnabled(env),theme,lang,displayName:actor.display_name,bookingWrites:bookingWritesEnabled(env),salesWrites:salesWritesEnabled(env),refundWrites:refundWritesEnabled(env),renewalWrites:renewalWritesEnabled(env),imageWrites:imageWritesEnabled(env),checkoutWrites:checkoutWritesEnabled(env),cancellationWrites:cancellationWritesEnabled(env),bookingCashWrites:bookingCashWritesEnabled(env),stayCashWrites:stayCashWritesEnabled(env),lifecycleWrites:lifecycleWritesEnabled(env),templateWrites:templateWritesEnabled(env),transferWrites:transferWritesEnabled(env),petWrites:petWritesEnabled(env)});
   return json({error:'not_found'},404);
  }
  if(['/api/stay-pass/drafts/save','/api/stay-pass/drafts/cancel','/api/stay-pass/drafts/record'].includes(path)&&!salesWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/pets/confirm'&&!petWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/transfers/confirm'&&!transferWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/templates/save'&&!templateWritesEnabled(env))return json({error:'not_found'},404);
  if(['/api/stay-pass/lifecycle/confirm','/api/stay-pass/lifecycle/process-expiry'].includes(path)&&!lifecycleWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/stay-cash/record'&&!stayCashWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/booking-cash/record'&&!bookingCashWritesEnabled(env))return json({error:'not_found'},404);
  if(['/api/stay-pass/extension-quote','/api/stay-pass/extension-confirm'].includes(path)&&!extensionWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/cancellation-confirm'&&!cancellationWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/checkout-confirm'&&!checkoutWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/images/generate'&&!imageWritesEnabled(env))return json({error:'not_found'},404);
  if(['/api/stay-pass/renewals/quote','/api/stay-pass/renewals/record'].includes(path)&&!renewalWritesEnabled(env))return json({error:'not_found'},404);
  if(['/api/stay-pass/refunds/quote','/api/stay-pass/refunds/request','/api/stay-pass/refunds/action'].includes(path)&&!refundWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/sales/record'&&!salesWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/booking-convert'&&!bookingWritesEnabled(env))return json({error:'not_found'},404);
  if(!['/api/stay-pass/policies/approve','/api/stay-pass/drafts/quote','/api/stay-pass/drafts/save','/api/stay-pass/drafts/cancel','/api/stay-pass/drafts/record','/api/stay-pass/pets/quote','/api/stay-pass/pets/confirm','/api/stay-pass/availability/save','/api/stay-pass/transfers/quote','/api/stay-pass/transfers/confirm','/api/stay-pass/templates/preview','/api/stay-pass/templates/save','/api/stay-pass/lifecycle/confirm','/api/stay-pass/lifecycle/process-expiry','/api/stay-pass/stay-cash/record','/api/stay-pass/booking-cash/record','/api/stay-pass/extension-quote','/api/stay-pass/extension-confirm','/api/stay-pass/cancellation-quote','/api/stay-pass/cancellation-confirm','/api/stay-pass/checkout-confirm','/api/stay-pass/checkout-quote','/api/stay-pass/images/prepare','/api/stay-pass/images/generate','/api/stay-pass/renewals/quote','/api/stay-pass/renewals/record','/api/stay-pass/refunds/quote','/api/stay-pass/refunds/request','/api/stay-pass/refunds/action','/api/stay-pass/sales/record','/api/stay-pass/booking-convert','/api/stay-pass/checkin-quote','/api/stay-pass/booking-quote','/api/stay-pass/sales/quote','/api/stay-pass/plans','/api/stay-pass/prices','/api/stay-pass/policies','/api/stay-pass/preview'].includes(path))return json({error:'not_found'},404);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(request.headers.get('Origin')!==url.origin)return json({error:'invalid_origin'},403);
  const input=await body(request);if(!input)return json({status:'invalid_request'},400);
  let result;
  if(path==='/api/stay-pass/sales/record'&&!salesWritesEnabled(env))return json({error:'not_found'},404);
  if(path==='/api/stay-pass/policies/approve')result=await approvePolicy(env.DB,input,actor);
  else if(path==='/api/stay-pass/availability/save')result=await saveAvailability(env.DB,input,actor);
  else if(path==='/api/stay-pass/drafts/save')result=await saveSaleDraft(env.DB,input,actor);
  else if(path==='/api/stay-pass/drafts/quote')result=await quoteDraftPayment(env.DB,input.draftId,actor);
  else if(path==='/api/stay-pass/drafts/cancel')result=await cancelSaleDraft(env.DB,input,actor);
  else if(path==='/api/stay-pass/drafts/record')result=await recordDraftPayment(env.DB,input,actor);
  else if(path==='/api/stay-pass/pets/quote')result=await quotePetRegistration(env.DB,input,actor);
  else if(path==='/api/stay-pass/pets/confirm')result=await confirmPetRegistration(env.DB,input,actor);
  else if(path==='/api/stay-pass/transfers/quote')result=await quoteTransfer(env.DB,input,actor);
  else if(path==='/api/stay-pass/transfers/confirm')result=await confirmTransfer(env.DB,input,actor);
  else if(path==='/api/stay-pass/templates/save')result=await saveTemplate(env.DB,input,actor);
  else if(path==='/api/stay-pass/templates/preview'){const preview=await templatePreview(env.DB,input,actor),width=Number(input.width||390),page=Number(input.page||0);const prepared=await prepareImage(env.DB,{passId:input.passId,kind:'usage',language:input.language||'th'},actor),draft=await templateImageSnapshot(env.DB,prepared.snapshot,preview.config);if(![320,375,390,430,768,1080].includes(width)||!Number.isSafeInteger(page)||page<0||page>=128)return json({status:'invalid_template'},400);result={...preview,pages:imagePageSpecs(draft).map((p,i)=>({index:i,type:p.type})),url:'/api/stay-pass/templates/render?'+new URLSearchParams({config:JSON.stringify(preview.config),pass:input.passId,language:input.language||'th',width,page})};}
  else if(path==='/api/stay-pass/lifecycle/confirm')result=await confirmLifecycle(env.DB,input,actor);
  else if(path==='/api/stay-pass/lifecycle/process-expiry')result=input.confirmed===true?await processExpirations(env.DB,actor):{status:'confirmation_required'};
  else if(path==='/api/stay-pass/stay-cash/record')result=await recordStayCash(env.DB,input,actor);
  else if(path==='/api/stay-pass/booking-cash/record')result=await recordBookingCash(env.DB,input,actor);
  else if(path==='/api/stay-pass/extension-quote')result=await quotePassExtension(env.DB,input,actor);
  else if(path==='/api/stay-pass/extension-confirm')result=await confirmPassExtension(env.DB,input,actor);
  else if(path==='/api/stay-pass/cancellation-quote')result=await quoteCancellation(env.DB,input,actor);
  else if(path==='/api/stay-pass/cancellation-confirm')result=await confirmCancellation(env.DB,input,actor);
  else if(path==='/api/stay-pass/checkout-confirm')result=await confirmPassCheckout(env.DB,input,actor);
  else if(path==='/api/stay-pass/checkout-quote')result=await quotePassCheckout(env.DB,input,actor);
  else if(path==='/api/stay-pass/images/prepare')result=await prepareImage(env.DB,input,actor);
  else if(path==='/api/stay-pass/images/generate')result=await generateImage(env,input,actor);
  else if(path==='/api/stay-pass/renewals/quote')result=await quoteRenewal(env.DB,input,actor);
  else if(path==='/api/stay-pass/renewals/record')result=await recordRenewal(env.DB,input,actor);
  else if(path==='/api/stay-pass/refunds/quote')result=await quoteRefund(env.DB,input,actor);
  else if(path==='/api/stay-pass/refunds/request')result=await requestRefund(env.DB,input,actor);
  else if(path==='/api/stay-pass/refunds/action')result=await actOnRefund(env.DB,input.refundId,input.action,input,actor);
  else if(path==='/api/stay-pass/sales/record')result=await recordPaidSale(env.DB,input,actor);
  else if(path==='/api/stay-pass/booking-convert')result=await convertPassBooking(env.DB,input,actor);
  else if(path==='/api/stay-pass/checkin-quote')result=await quotePassCheckin(env.DB,input.bookingId,actor);
  else if(path==='/api/stay-pass/booking-quote')result=await quotePassBooking(env.DB,input,actor);
  else if(path==='/api/stay-pass/sales/quote')result=await quoteSale(env.DB,input,actor);
  else if(path.endsWith('/preview')){
   const current=await catalog(env.DB);const prices=current.prices?.filter(v=>v.plan_id===input.planId&&v.effective_at<=new Date().toISOString()).sort((a,b)=>b.effective_at.localeCompare(a.effective_at))[0]?.prices||{};
   result={status:'ready',...pricePreview(input.config,prices)};
  }else if(path.endsWith('/policies'))result=await savePolicyDraft(env.DB,input,actor);
  else result=path.endsWith('/plans')?await savePlan(env.DB,input,actor):await savePrice(env.DB,input,actor);
  return json(result,result.status==='conflict'?409:200);
 }catch(error){
  if(/no such table.*stay_pass/i.test(String(error)))return json({status:'migration_required'},503);
  if(error.code)return json({status:error.code},error.code==='image_quota_limit'?429:error.code==='not_found'?404:error.code==='forbidden'?403:error.code==='idempotency_conflict'?409:400);
  if(/UNIQUE constraint failed/.test(String(error)))return json({status:'conflict'},409);
  console.error('stay_pass_preview_failed');return json({error:'temporarily_unavailable'},503);
 }
}
