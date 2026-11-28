// Build tooling only: exports the exact existing public presentation bytes.
import {uiAssets} from './ui_assets.mjs';
import {uiAssetManifest} from './ui_asset_manifest.mjs';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const out=process.argv[2];if(!out||out==='--help')throw Error('Use --check or an explicit output directory; this command never uploads.');
const metadata={};let bytesTotal=0;
if(out!=='--check')await mkdir(resolve(out),{recursive:true});
if(Object.keys(uiAssets).sort().join()!==Object.keys(uiAssetManifest).sort().join())throw Error('Asset manifest names differ');
for(const [name,[version,encoded]] of Object.entries(uiAssets)){
 if(!/^[a-z0-9][a-z0-9.-]+$/.test(name))throw Error('Invalid asset name');
 const bytes=Buffer.from(encoded,'base64'),hash=createHash('sha256').update(bytes).digest('hex'),entry=uiAssetManifest[name];
 if(entry[0]!==version||entry[2]!==bytes.length||entry[3]!==hash)throw Error('Manifest mismatch: '+name);
 metadata['ui-assets/'+hash+'/'+name]={content_type:entry[1],bytes:bytes.length,sha256:hash,custom_metadata:{ui_asset_sha256:hash}};bytesTotal+=bytes.length;
 if(out!=='--check'){await mkdir(join(resolve(out),'ui-assets',hash),{recursive:true});await writeFile(join(resolve(out),'ui-assets',hash,name),bytes);}
}
if(out!=='--check')await writeFile(join(resolve(out),'upload-manifest.json'),JSON.stringify(metadata,null,2)+'\n');
console.log('Verified '+Object.keys(metadata).length+' original UI assets ('+bytesTotal+' bytes). '+(out==='--check'?'No files changed.':'Exported locally; nothing uploaded.'));
