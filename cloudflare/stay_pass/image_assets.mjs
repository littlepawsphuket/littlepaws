import {validDogPhotoKey} from '../timeline.mjs';
import {validJpeg,photoLimit} from '../dog_photos.mjs';
import {uiAssets} from '../ui_assets.mjs';
import {storedUiAssetBytes} from '../ui_asset_storage.mjs';
import {uiAssetManifest} from '../ui_asset_manifest.mjs';
import {fail} from './rules.mjs';
export const imageFontManifest=[
 ['thai','noto-sans-thai.ttf','5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8',218652],
 ['serif','cormorant-garamond.ttf','b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0',2000000]
];
export const imageFontKey=entry=>'stay-pass-assets/'+entry[2]+'/'+entry[1];
export const bytesHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function dataUri(bytes,type){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:'+type+';base64,'+btoa(text);}
async function objectBytes(media,key,limit){const object=await media?.get(key);if(!object)fail('image_assets_unavailable');if(object.size>limit){await object.body?.cancel?.();fail('image_assets_invalid');}const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(bytes.length>limit)fail('image_assets_invalid');return bytes;}
export async function imageAssets(env,snapshot=null){
 const result={};
 for(const entry of imageFontManifest){const bytes=await objectBytes(env.MEDIA,imageFontKey(entry),entry[3]);if(await bytesHash(bytes)!==entry[2])fail('image_assets_invalid');result[entry[0]]=dataUri(bytes,'font/ttf');}
 const name='little-paws-logo.png';let bytes;
 if(typeof LITTLE_PAWS_EMBED_UI_ASSETS==='undefined'||LITTLE_PAWS_EMBED_UI_ASSETS){const value=uiAssets[name]?.[1];if(value)bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
 if(!bytes)bytes=(await storedUiAssetBytes(name,env))?.bytes;
 if(!bytes||await bytesHash(bytes)!==uiAssetManifest[name][3])fail('image_assets_unavailable');
 result.logo=dataUri(bytes,'image/png');
 if(snapshot?.template?.config?.show_pet_photos){result.petPhotos=[];let photoBytes=0;for(const pet of snapshot.pass.pets){if(!pet.photo_consent||!pet.photo_key)continue;if(!validDogPhotoKey(pet.photo_key,pet.id))fail('image_assets_invalid');const bytes=await objectBytes(env.MEDIA,pet.photo_key,photoLimit);photoBytes+=bytes.length;if(photoBytes>6*1024*1024)fail('image_photo_limit');if(!validJpeg(bytes))fail('image_assets_invalid');result.petPhotos.push({id:pet.id,uri:dataUri(bytes,'image/jpeg'),hash:await bytesHash(bytes)});}}
 return result;
}
