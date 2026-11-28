// Offline packaging only. No upload, account access or paid service activation.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {imageFontManifest,imageFontKey,bytesHash} from '../image_assets.mjs';
const output=process.argv[2];if(!output||!isAbsolute(output))throw Error('Provide an explicit absolute output directory');
const root=resolve(output),manifest=[];
for(const entry of imageFontManifest){const bytes=new Uint8Array(await readFile(new URL('../prototype_assets/'+entry[1],import.meta.url)));if(await bytesHash(bytes)!==entry[2])throw Error('Original font hash mismatch');const key=imageFontKey(entry),path=join(root,key);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);manifest.push({key,sha256:entry[2],bytes:bytes.length,contentType:'font/ttf'});}
for(const name of ['notosansthai-OFL.txt','cormorantgaramond-OFL.txt','manifest.json']){await mkdir(join(root,'licenses'),{recursive:true});await writeFile(join(root,'licenses',name),await readFile(new URL('../prototype_assets/'+name,import.meta.url)));}
await writeFile(join(root,'image-font-upload-manifest.json'),JSON.stringify({private_bucket:true,uploaded:false,original_fonts_only:true,files:manifest},null,2)+'\n');
console.log('Packaged original font assets and licenses. No remote files were uploaded.');
