import {uiAssetManifest} from './ui_asset_manifest.mjs';

// Uses the existing private media binding. Authentication still runs in staff.mjs.
// The alternative build is not enabled until byte-verified assets are present.
export const uiAssetKey=name=>Object.hasOwn(uiAssetManifest,name)?'ui-assets/'+uiAssetManifest[name][3]+'/'+name:null;
export async function storedUiAsset(request,name,env){
 const entry=Object.hasOwn(uiAssetManifest,name)?uiAssetManifest[name]:null;if(!entry)return new Response(null,{status:404});
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 const [version,type,size,sha256]=entry;
 if(!env?.MEDIA)return new Response(null,{status:503});
 const object=await env.MEDIA.get(uiAssetKey(name));
 if(!object||object.size!==size||(object.customMetadata?.ui_asset_sha256&&object.customMetadata.ui_asset_sha256!==sha256)){
  await object?.body?.cancel?.();return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});
 }
 const bytes=await new Response(object.body).arrayBuffer(),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==size||actual!==sha256)return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});
 const headers={'Content-Type':type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff',ETag:'"'+version+'"'};
 if(request.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
 return new Response(request.method==='HEAD'?null:bytes,{headers});
}
export async function storedUiAssetBytes(name,env){
 const response=await storedUiAsset(new Request('https://brand-assets.invalid/static/'+encodeURIComponent(name)),name,env);
 return response.status===200?{bytes:new Uint8Array(await response.arrayBuffer()),type:response.headers.get('Content-Type')}:null;
}
