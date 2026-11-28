import assert from 'node:assert/strict';
import {uiAssetKey} from './ui_asset_storage.mjs';
import {staffAsset} from './staff_assets.mjs';
import {uiAssets} from './ui_assets.mjs';
import {uiAssetManifest} from './ui_asset_manifest.mjs';
const name='little-paws-logo.png',bytes=Buffer.from(uiAssets[name][1],'base64'),request=new Request('https://staff.example/static/'+name);
let reads=0;
const media={async get(key){assert.equal(this,media);assert.equal(key,uiAssetKey(name));reads++;return {size:bytes.length,body:bytes,customMetadata:{ui_asset_sha256:uiAssetManifest[name][3]}};},async head(key){assert.equal(this,media);assert.equal(key,uiAssetKey(name));reads++;return {size:bytes.length,customMetadata:{ui_asset_sha256:uiAssetManifest[name][3]}};}};
const embedded=staffAsset(request,name);assert.equal(embedded.status,200);assert.deepEqual(new Uint8Array(await embedded.arrayBuffer()),new Uint8Array(bytes));
globalThis.LITTLE_PAWS_EMBED_UI_ASSETS=false;
try{
 let result=await staffAsset(request,name,{MEDIA:media});assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, max-age=3600');assert.deepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array(bytes));
 result=await staffAsset(new Request(request,{method:'HEAD'}),name,{MEDIA:media});assert.equal(result.status,200);assert.equal((await result.arrayBuffer()).byteLength,0);
 result=await staffAsset(new Request(request,{headers:{'If-None-Match':'"'+uiAssetManifest[name][0]+'"'}}),name,{MEDIA:media});assert.equal(result.status,304);
 assert.equal((await staffAsset(new Request(request,{method:'POST'}),name,{MEDIA:media})).status,405);
 assert.equal((await staffAsset(request,'constructor',{MEDIA:media})).status,404);
 assert.equal((await staffAsset(request,'__proto__',{MEDIA:media})).status,404);
 assert.equal((await staffAsset(request,'../customer-data',{MEDIA:media})).status,404);
 assert.equal((await staffAsset(request,name,{})).status,503);
 assert.equal((await staffAsset(request,name,{MEDIA:{async get(){return {size:bytes.length,body:new ReadableStream({start(c){c.close();}}),customMetadata:{ui_asset_sha256:'wrong'}};}}})).status,503);
 const plain={async get(){return {size:bytes.length,body:new Blob([bytes]).stream()};}};assert.equal((await staffAsset(request,name,{MEDIA:plain})).status,200);
 assert.equal((await staffAsset(new Request(request,{headers:{'If-None-Match':'"'+uiAssetManifest[name][0]+'"'}}),name,{MEDIA:plain})).status,304);
 const corrupt=Buffer.from(bytes);corrupt[0]^=1;assert.equal((await staffAsset(request,name,{MEDIA:{async get(){return {size:bytes.length,body:corrupt,customMetadata:{ui_asset_sha256:uiAssetManifest[name][3]}};}}})).status,503);
 assert.equal(reads,3);
}finally{delete globalThis.LITTLE_PAWS_EMBED_UI_ASSETS;}
console.log('UI asset storage passed: byte-identical legacy and private-R2 mode, actual SHA256 verification with or without upload metadata, preserved cache/ETag/HEAD, method binding, unknown/prototype/path and missing/corrupt-object safeguards. No remote services used.');
