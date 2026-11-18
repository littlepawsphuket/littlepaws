import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {storedArchive} from './portable_archive.mjs';

export async function testCloudBackup({sqlite,staffCall,context}){
  const options={method:'POST',headers:{Origin:'https://staff.example.test','Content-Type':'application/json'},body:'{}'};
  assert.equal((await staffCall('/api/backup/snapshot',{method:'GET'},context)).status,405);
  assert.equal((await staffCall('/api/backup/snapshot',{...options,headers:{Origin:'https://foreign.example.test'}},context)).status,403);
  sqlite.exec('UPDATE app_users SET is_admin=0 WHERE id=1');
  assert.equal((await staffCall('/api/backup/snapshot',options,context)).status,403);
  sqlite.exec('UPDATE app_users SET is_admin=1 WHERE id=1');
  const response=await staffCall('/api/backup/snapshot',options,context);assert.equal(response.status,200);
  const snapshot=await response.json();
  assert.equal(snapshot.format,'little-paws-cloud-backup');
  assert.ok(snapshot.rows.app_users.length>0);
  const files={'snapshot.json':JSON.stringify(snapshot)},manifest=[];
  for(const key of [...snapshot.required_media,...snapshot.optional_media]){
    const reply=await staffCall('/api/backup/media?'+new URLSearchParams({key}),{},context);
    if(reply.status===404 && snapshot.optional_media.includes(key))continue;
    assert.equal(reply.status,200,key);
    const bytes=new Uint8Array(await reply.arrayBuffer());files['objects/'+key]=bytes;
    manifest.push({key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  files['objects.json']=JSON.stringify(manifest);
  const root=await mkdtemp(join(tmpdir(),'little-paws-backup-test-'));
  try{
    const archive=join(root,'backup.zip'),recovered=join(root,'recovered');
    await writeFile(archive,new Uint8Array(await storedArchive(files).arrayBuffer()));
    const python=process.argv[4] || 'python3';
    execFileSync(python,['-m','cloudflare.restore_backup',archive,recovered],{stdio:'pipe'});
    execFileSync(python,['-c',`import sqlite3,json,sys
from pathlib import Path
root=Path(sys.argv[1]); snapshot=json.loads((root/'snapshot.json').read_text())
db=sqlite3.connect(root/'cloud-recovery.sqlite3')
for table,rows in snapshot['rows'].items():
 assert db.execute('SELECT COUNT(*) FROM "'+table+'"').fetchone()[0]==len(rows)
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
`,recovered],{stdio:'pipe'});
    const broken={...files,'objects.json':JSON.stringify(manifest.map((item,index)=>index===0?{...item,sha256:'0'.repeat(64)}:item))};
    await writeFile(join(root,'broken.zip'),new Uint8Array(await storedArchive(broken).arrayBuffer()));
    assert.throws(()=>execFileSync(python,['-m','cloudflare.restore_backup',join(root,'broken.zip'),join(root,'must-not-restore')],{stdio:'pipe'}));
  }finally{await rm(root,{recursive:true,force:true});}
  assert.equal((await staffCall('/api/backup/media?key=../secret',{},context)).status,404);
  assert.equal((await staffCall('/api/manual/usage.html',{},context)).status,200);
  assert.match(await (await staffCall('/api/manual/backup.html',{},context)).text(),/Time Travel/);
}
