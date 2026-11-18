import {englishFunctions,uiTranslations} from './ui_english_generated.mjs';
export function uiFunction(name,fn,language){return language==='en' ? englishFunctions[name] || fn.toString() : fn.toString();}
export function uiText(text,language){return language==='en' && Object.hasOwn(uiTranslations,text) ? uiTranslations[text] : text;}
export function uiValues(value,language){
  if(typeof value==='string')return uiText(value,language);
  if(Array.isArray(value))return value.map(item=>uiValues(item,language));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,uiValues(item,language)]));
  return value;
}
export function uiMarkup(html,language){
  if(language!=='en')return html;
  // The only user-supplied value in this shell is the display name. Protect it
  // explicitly; source labels and markup are translated independently of data.
  let account='';
  html=html.replace(/<strong id="account-name">[\s\S]*?<\/strong>/,match=>{account=match;return '<!--ACCOUNT_NAME-->';});
  const parts=html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i);
  html=parts.map(part=>part.startsWith('<script') ? part : part
    .replace(/>([^<>]+)</g,(match,text)=>{
      const trimmed=text.trim(),translated=uiTranslations[trimmed];
      return translated ? '>'+text.replace(trimmed,translated)+'<' : match;
    })
    .replace(/\b(aria-label|title|placeholder|alt)="([^"<>]*)"/g,(match,attribute,text)=>{
      const translated=uiTranslations[text];
      return translated ? `${attribute}="${translated.replaceAll('&','&amp;').replaceAll('"','&quot;')}"` : match;
    })).join('');
  return html.replace('<!--ACCOUNT_NAME-->',account);
}
export function uiLanguage(url){return url.searchParams.get('lang')==='en' ? 'en' : 'th';}
export const fixedUiLabels=uiTranslations;
