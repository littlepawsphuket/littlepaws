import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {documents,care,booking} from './test_customer_image_fixtures.mjs';
import {documentHtml} from './document_layout.mjs';
import {renderExport} from './document_exports.mjs';
import {customerImageViewport} from './customer_image_styles.mjs';
// Original PDF markup captured before the image-only change.
const originalPdfHashes={"booking-th":"ddfd9d6b50e98e81644ef28802ee06104a2c3e74cc922166358fdf42b3c40876","stay-th":"af7fe18eb48a7e9ce12dafe8c59b8ef2817e910967ea8837adae0d4ab4716d3b","deposit-th":"ffa80502268f225b9cc5f1ce108864af08c77332070b0c22c29f1c2ea23e3343","booking-en":"a861bf9484491b6e69719c1f6a7f6ec39438bbb28d1b8cb00a6b88af7e9d8481","stay-en":"11d59ae1881c21648019c85db75a86135a08698291eb5f1d16adb1836598784d","deposit-en":"d49449d79b694f5377063e99dc04b2509526b8361ad951a603859800789dfbe2","care-th":"51692de640309498840ba1e9468525b3b5f9b5045935007097679c2c8d81acab","care-en":"cd8c4e54b6532e2beedc62e858cbe3f2e4e813de0db359a741f75c9e8370ecde"};
const pdf={...documents('pdf'),'care-th':care('pdf'),'care-en':care('pdf','en')};
for(const [name,html] of Object.entries(pdf))assert.equal(createHash('sha256').update(html).digest('hex'),originalPdfHashes[name],name+' PDF changed');
const images={...documents('png'),'care-th':care('png'),'care-en':care('png','en')};
for(const name of Object.keys(pdf)){assert.notEqual(images[name],pdf[name]);assert.match(images[name],/Rosie/);}
const originalQr='data:image/png;base64,cXItZml4dHVyZQ==';
const imageWithQr=documentHtml({...booking,kind:'stay',format:'png',due_cents:240000,qr:originalQr});
assert.ok(imageWithQr.includes('src="'+originalQr+'"'));
const calls=[];const env={BROWSER:{quickAction:async(action,options)=>{calls.push({action,options});return new Response('fixture',{headers:{'Content-Type':action==='pdf'?'application/pdf':'image/png'}});}}};
await renderExport(env,{html:pdf['booking-th'],format:'pdf',lang:'th',filename:'fixture.pdf',imageViewport:customerImageViewport});
assert.deepEqual(calls.at(-1),{action:'pdf',options:{html:pdf['booking-th'],pdfOptions:{format:'a4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false}}});
await renderExport(env,{html:images['booking-th'],format:'png',lang:'th',filename:'fixture.png',imageViewport:customerImageViewport});
assert.equal(calls.at(-1).action,'screenshot');assert.deepEqual(calls.at(-1).options.viewport,{width:540,height:1,deviceScaleFactor:2});assert.equal(calls.at(-1).options.screenshotOptions.fullPage,true);
await renderExport(env,{html:'staff report',format:'png',lang:'en',filename:'report.png'});
assert.deepEqual(calls.at(-1).options.viewport,{width:780,height:1000,deviceScaleFactor:1.5});
console.log('Customer images passed: 8 unchanged PDF fixtures, image-only layouts, natural-height phone viewport, unchanged report renderer.');
