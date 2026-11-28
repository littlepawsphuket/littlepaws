// Copies only deployable source into a fresh directory, replacing embedded brand
// bytes with private-R2 reads. Does not upload, migrate, or read credentials/data.
import {mkdir,readdir,copyFile,writeFile,lstat,symlink} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const output=process.argv[2];if(!output||!isAbsolute(output))throw Error('Provide a new absolute output directory.');
const source=dirname(fileURLToPath(import.meta.url)),root=resolve(output),target=join(root,'cloudflare');if(root===source||source.startsWith(root+'/'))throw Error('Use a separate build directory');
try{await lstat(root);throw Error('Output already exists; choose a new empty build directory');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(target,{recursive:true});
async function copy(dir,dest){await mkdir(dest,{recursive:true});for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isDirectory()){if(entry.name==='stay_pass'||dir!==source&&!['dev','prototype_assets'].includes(entry.name))await copy(join(dir,entry.name),join(dest,entry.name));}else if((entry.name.endsWith('.mjs')&&!entry.name.startsWith('test_'))||dir===source&&['ui_english.json','package.json','wrangler.staff.production.toml','wrangler.timeline.production.toml'].includes(entry.name))await copyFile(join(dir,entry.name),join(dest,entry.name));}}
await copy(source,target);await copyFile(join(source,'ui_assets_r2_only.mjs'),join(target,'ui_assets.mjs'));
// Dependencies are installed locally by the existing application, never bundled
// from arbitrary personal folders. This link is only for the local build step.
await symlink(join(source,'node_modules'),join(target,'node_modules'),'dir');
await mkdir(join(root,'app'),{recursive:true});await symlink(resolve(source,'../app/static'),join(root,'app','static'),'dir');
for(const name of ['wrangler.staff.production.toml','wrangler.timeline.production.toml']){
 const path=join(target,name),{readFile}=await import('node:fs/promises');let text=await readFile(path,'utf8');text+='\n[define]\nLITTLE_PAWS_EMBED_UI_ASSETS = "false"\n';await writeFile(path,text);
}
console.log('Prepared private-R2 deployment source only; original repository assets unchanged. No remote action.');
