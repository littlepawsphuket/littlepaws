import {storedUiAssetBytes} from './ui_asset_storage.mjs';
import {uiAssets} from './ui_assets.mjs';
const palettes={
  classic:['#155747','#f2f7f3','#e7f2e9','#c8ded4'],christmas:['#185040','#f4f8f5','#e5f1e9','#bed8ca'],
  valentine:['#85274f','#fff5f8','#f8e3eb','#eac3d3'],halloween:['#653767','#fbf5fa','#f1e6f8','#d9c4d9'],
  songkran:['#0e5969','#f2fbfb','#dff6f6','#badce2'],buddhist:['#76511f','#fffaf1','#fbefd9','#e4d1a6'],
  japan:['#873750','#fcf6fa','#f8edf0','#e3bdce'],
};
export function customerTheme(raw){let theme;try{theme=JSON.parse(raw);}catch{}return Object.hasOwn(palettes,theme)?theme:'classic';}
export function customerThemeCss(theme){const [accent,page,wash,line]=palettes[theme] || palettes.classic;
return `:root{--brand-teal:${accent};--accent:${accent};--season-card:${wash};--season-border:${line}}
body{background:linear-gradient(140deg,${wash},${page} 60%);color:#253b34}header,article{border-color:${line};box-shadow:0 4px 18px #273e3410}
a,.section-label,h2{color:${accent}}nav a[aria-current]{background:${accent}}time{background:${wash}}
.customer-banner{position:relative;isolation:isolate;overflow:hidden;border-radius:20px;min-height:170px;background:${wash};margin-bottom:14px;border:1px solid ${line}}
.customer-landscape{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}
.customer-mascot{position:absolute;bottom:8px;right:10px;width:clamp(110px,26vw,210px);max-height:150px;object-fit:contain}
.customer-brand{display:flex;align-items:center;gap:10px;padding:16px;width:60%;font-size:16px;color:#fff;text-shadow:0 1px 3px #000,0 0 14px #000b}
.customer-brand img{width:55px;height:55px;object-fit:contain;flex:none}.customer-brand strong{line-height:1.4}
.customer-banner[data-theme=classic] .customer-brand{color:${accent};text-shadow:none}.customer-banner[data-theme=classic]{min-height:130px}
@media(max-width:480px){main{padding:12px}.customer-banner{min-height:145px}.customer-brand{padding:12px;font-size:14px}.customer-brand img{width:44px;height:44px}.customer-mascot{width:135px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;
}
export function customerThemeBanner(theme,route){
 const asset=name=>route+'/theme/'+name;
 return `<section class="customer-banner" data-theme="${theme}" aria-label="Little Paws Homestay Phuket">
 ${theme==='classic'?'':`<img class="customer-landscape" src="${asset('theme-'+theme+'.webp')}" alt="" fetchpriority="high">`}
 <div class="customer-brand"><img src="${asset('little-paws-logo.png')}" alt=""><strong>Little Paws<br>Homestay Phuket</strong></div>
 <img class="customer-mascot" src="${asset(theme==='classic'?'balen-gucci-relax.webp':'mascot-'+theme+'.webp')}" alt=""></section>`;
}
export function customerThemeAsset(name,env){
 if(!/^(?:theme-(?:christmas|valentine|halloween|songkran|buddhist|japan)\.webp|mascot-(?:christmas|valentine|halloween|songkran|buddhist|japan)\.webp|balen-gucci-relax\.webp|little-paws-logo\.png)$/.test(name))return null;
 if(typeof LITTLE_PAWS_EMBED_UI_ASSETS!=='undefined'&&!LITTLE_PAWS_EMBED_UI_ASSETS)return storedUiAssetBytes(name,env);
 const asset=uiAssets[name];return asset ? {bytes:Uint8Array.from(atob(asset[1]),c=>c.charCodeAt(0)),type:name.endsWith('.png')?'image/png':'image/webp'} : null;
}
