import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {addCareVideo,saveVideoPoster,removeCareVideo,inspectStoredVideo,parseMovieMetadata,eventVideos,videoResponse,videoRange,videoLimit} from './care_videos.mjs';
import timeline from './timeline.mjs';
import {writeCareEvent} from './care_staff.mjs';
import {care as careFixture} from './test_customer_image_fixtures.mjs';
import {careDocumentHtml} from './care_exports.mjs';
import {cloudSnapshot,backupMedia} from './cloud_backup.mjs';
// Node substitute for the Workers-native, exact-length streaming primitive.
globalThis.FixedLengthStream ??= class extends TransformStream{constructor(size){let count=0;super({transform(chunk,controller){count+=chunk.byteLength;if(count>size)throw Error('overflow');controller.enqueue(chunk);},flush(){if(count!==size)throw Error('underflow');}});}};
const atom=(type,...payload)=>{const data=Buffer.concat(payload),header=Buffer.alloc(8);header.writeUInt32BE(data.length+8);header.write(type,4);return Buffer.concat([header,data]);};
function movie(seconds=10,codec='avc1',brand='isom'){
 const mvhd=Buffer.alloc(20);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(seconds*1000,16);
 const hdlr=Buffer.alloc(12);hdlr.write('vide',8);const stsd=Buffer.alloc(8);stsd.writeUInt32BE(1,4);
 const moov=atom('moov',atom('mvhd',mvhd),atom('trak',atom('mdia',atom('hdlr',hdlr),atom('minf',atom('stbl',atom('stsd',stsd,atom(codec,Buffer.alloc(8))))))));
 return {bytes:Buffer.concat([atom('ftyp',Buffer.from(brand+'0000')),atom('mdat',Buffer.alloc(16)),moov]),moov};
}
for(const [seconds,expected] of [[1,1000],[10,10000],[30,30000]])assert.equal(parseMovieMetadata(movie(seconds).moov).duration_ms,expected);
assert.throws(()=>parseMovieMetadata(movie(31).moov),/too_long/);assert.throws(()=>parseMovieMetadata(movie(10,'vp09').moov),/invalid_video/);
assert.throws(()=>parseMovieMetadata(Buffer.from('<html>not video</html>')),/invalid_video/);
// iPhone/QuickTime MOV includes minf/hdlr=alis for each track. Never let that
// data-reference handler replace mdia/hdlr=vide (or count the audio as video).
function quickTimeMovie(codec='avc1',seconds=29){
 const handler=type=>{const data=Buffer.alloc(12);data.write(type,8);return atom('hdlr',data);};
 const track=(type,codec)=>{const stsd=Buffer.alloc(8);stsd.writeUInt32BE(1,4);return atom('trak',atom('mdia',handler(type),atom('minf',handler('alis'),atom('stbl',atom('stsd',stsd,atom(codec,Buffer.alloc(8)))))));};
 const mvhd=Buffer.alloc(20);mvhd.writeUInt32BE(15360,12);mvhd.writeUInt32BE(seconds*15360,16);
 const moov=atom('moov',atom('mvhd',mvhd),track('vide',codec),track('soun','mp4a'));
 return Buffer.concat([atom('ftyp',Buffer.from('qt  0000')),atom('wide'),atom('mdat',Buffer.alloc(16)),moov]);
}
for(const codec of ['avc1','hvc1']){
 const bytes=quickTimeMovie(codec),media={async get(key,{range}){return {arrayBuffer:async()=>Uint8Array.from(bytes.subarray(range.offset,range.offset+range.length)).buffer};}};
 assert.deepEqual(await inspectStoredVideo(media,'local',bytes.length),{duration_ms:29000,codec,mime:'video/quicktime'});
}
{
 const bytes=quickTimeMovie('avc1',31),media={async get(key,{range}){return {arrayBuffer:async()=>Uint8Array.from(bytes.subarray(range.offset,range.offset+range.length)).buffer};}};
 await assert.rejects(()=>inspectStoredVideo(media,'local',bytes.length),/too_long/);
}

const sqlite=new DatabaseSync(':memory:');sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE app_users(id INTEGER PRIMARY KEY,active,is_admin);INSERT INTO app_users VALUES(1,1,1),(2,0,0);
 CREATE TABLE staff_access_identities(user_id,email);INSERT INTO staff_access_identities VALUES(1,'staff@example.test'),(2,'off@example.test');
 CREATE TABLE customers(id INTEGER PRIMARY KEY,name);INSERT INTO customers VALUES(1,'Owner');
 CREATE TABLE dogs(id INTEGER PRIMARY KEY,name);INSERT INTO dogs VALUES(1,'Video dog'),(2,'Other dog');
 CREATE TABLE stays(id INTEGER PRIMARY KEY,status,cancelled_at,actual_checkout_at,customer_id);INSERT INTO stays VALUES(1,'checked_in',NULL,NULL,1),(2,'completed',NULL,'2020-01-01',1);
 CREATE TABLE stay_dogs(stay_id,dog_id);INSERT INTO stay_dogs VALUES(1,1),(1,2),(2,1);
 CREATE TABLE care_events(id INTEGER PRIMARY KEY,stay_id,dog_id,customer_visible,cloud_revision,kind,activity_label,recorded_at,note);
 INSERT INTO care_events VALUES(1,1,1,1,'11111111-1111-4111-8111-111111111111','play','เล่น','2026-01-02T09:00:00+07:00','Video update'),(2,1,2,1,NULL,'play','เล่น','2026-01-02T09:00:00+07:00','Other');
 CREATE TABLE care_photos(id INTEGER PRIMARY KEY,event_id,object_key);
 CREATE TABLE care_share_links(stay_id,dog_id,token,view_count DEFAULT 0);
 CREATE TABLE system_settings(key PRIMARY KEY,value);CREATE TABLE dog_photos(dog_id,object_key);CREATE TABLE app_user_photos(object_key);CREATE TABLE transactions(receipt);
`);
sqlite.exec(await readFile(new URL('./care_videos.sql',import.meta.url),'utf8'));sqlite.exec(await readFile(new URL('./care_interactions.sql',import.meta.url),'utf8'));
for(const [stay,dog,key] of [[1,1,'a'],[1,2,'b'],[2,1,'c']])sqlite.prepare('INSERT INTO care_share_links(stay_id,dog_id,token) VALUES(?,?,?)').run(stay,dog,key.repeat(43));
const db={prepare(sql){return {bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args),all:async()=>{if(/^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql))return {results:sqlite.prepare(sql).all(...args)};const result=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:result.changes}};},run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})})};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.all());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const objects=new Map(),reads=[];
const media={async put(key,value){objects.set(key,Buffer.from(await new Response(value).arrayBuffer()));},async get(key,options){const full=objects.get(key);if(!full)return null;let bytes=full;
 if(options?.range){reads.push(options.range);bytes=full.subarray(options.range.offset,options.range.offset+options.range.length);}return {body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};},async delete(key){objects.delete(key);}};
const actor={id:1,email:'staff@example.test'},scope={stayId:1,dogId:1,eventId:1},revision='11111111-1111-4111-8111-111111111111';
const request=(bytes,key='1',size=bytes.length)=>new Request('https://staff.example.test/upload',{method:'POST',headers:{'X-Event-Revision':revision,'X-Upload-Key':key.repeat(32),'X-Video-Size':String(size)},body:bytes});
let created=await addCareVideo(db,media,scope,actor,request(movie().bytes));assert.equal(created.status,'saved');const id=created.videoId;
assert.equal((await addCareVideo(db,media,scope,actor,request(movie().bytes))).videoId,id);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM care_videos').get().n,1);
assert.equal((await addCareVideo(db,media,scope,{id:2,email:'off@example.test'},request(movie().bytes,'2'))).status,'conflict');
assert.equal((await addCareVideo(db,media,{...scope,dogId:2},actor,request(movie().bytes,'2'))).status,'conflict');
for(const [bytes,expected] of [[movie(31).bytes,'too_long'],[Buffer.from('not video'),'invalid_video'],[movie(10,'vp09').bytes,'invalid_video']])assert.equal((await addCareVideo(db,media,scope,actor,request(bytes,'2'))).status,expected);
assert.equal(objects.size,1);assert.equal((await addCareVideo(db,media,scope,actor,request(movie().bytes,'2',videoLimit+1))).status,'invalid_size');
assert.equal((await addCareVideo(db,media,scope,actor,request(movie().bytes,'2',movie().bytes.length+1))).status,'invalid_size');assert.equal(objects.size,1);
const jpeg=Uint8Array.from([255,216,255,192,0,17,8,0,4,0,4,3,1,17,0,2,17,0,3,17,0,255,217]);
assert.equal(await saveVideoPoster(db,media,{...scope,videoId:id},actor,jpeg,revision),'saved');
const row=(await eventVideos(db,[1]))[0];assert.ok(row.poster_key);assert.equal(row.duration_ms,10000);
assert.deepEqual(videoRange('bytes=1-3',10),{offset:1,length:3});assert.deepEqual(videoRange('bytes=-3',10),{offset:7,length:3});
assert.equal(videoRange('bytes=10-',10),false);assert.equal(videoRange('bytes=0-1,3-4',10),false);
const root='https://timeline.example.test/updates/';const env={DB:db,MEDIA:media};
const get=(token,suffix='',options={})=>timeline.fetch(new Request(root+token.repeat(43)+suffix,options),env);
let response=await get('a','/videos/'+id,{headers:{Range:'bytes=0-15'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,16);assert.match(response.headers.get('Content-Range'),/^bytes 0-15\//);
response=await get('a','/videos/'+id,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Length'),String(movie().bytes.length));assert.equal((await response.arrayBuffer()).byteLength,0);
assert.equal((await get('a','/videos/'+id+'/poster.jpg')).status,200);
for(const token of ['b','c','z'])assert.equal((await get(token,'/videos/'+id)).status,404);
sqlite.exec('UPDATE care_events SET customer_visible=0 WHERE id=1');assert.equal((await get('a','/videos/'+id)).status,404);sqlite.exec('UPDATE care_events SET customer_visible=1 WHERE id=1');
const html=await (await get('a','?day=all')).text();assert.ok(html.includes('preload="none"'));assert.ok(html.includes('/videos/'+id+'/poster.jpg'));
assert.match((await get('a','?day=all')).headers.get('Content-Security-Policy'),/media-src 'self'/);
assert.equal((await videoResponse(media,row,new Request('https://example.test/',{headers:{Range:'bytes=99999-'}}))).status,416);
const snapshot=await cloudSnapshot(db);assert.equal(snapshot.rows.care_videos.length,1);assert.ok(snapshot.required_media.includes(row.object_key));assert.ok(snapshot.required_media.includes(row.poster_key));assert.ok(await backupMedia(env,row.object_key));
const second=await addCareVideo(db,media,scope,actor,request(movie(5,'hvc1','qt  ').bytes,'2'));assert.equal(second.status,'saved');assert.equal((await addCareVideo(db,media,scope,actor,request(movie().bytes,'3'))).status,'conflict');
sqlite.exec("UPDATE stays SET status='completed',actual_checkout_at='2020-01-01' WHERE id=1");assert.equal((await get('a','/videos/'+id)).status,404);assert.equal(await removeCareVideo(db,media,{...scope,videoId:id},actor,{key:row.object_key,revision}),'conflict');sqlite.exec("UPDATE stays SET status='checked_in',actual_checkout_at=NULL WHERE id=1");
assert.equal(await removeCareVideo(db,media,{...scope,videoId:id},actor,{key:row.object_key,revision}),'saved');assert.ok(!objects.has(row.object_key));assert.ok(!objects.has(row.poster_key));
assert.equal(await writeCareEvent(db,media,1,1,{action:'remove-event',eventId:1,revision},actor),'saved');assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM care_videos').get().n,0);assert.equal(objects.size,0);
assert.ok(reads.every(range=>range.length<=512*1024));
for(const lang of ['th','en'])for(const format of ['pdf','png']){
 const html=careFixture(format,lang,doc=>careDocumentHtml({...doc,events:doc.events.map(event=>({...event,videos:[{poster:'data:image/jpeg;base64,fixture',duration_ms:6000,href:'https://customer.example.test/updates/'+ 'a'.repeat(43)}]}))}));
 assert.match(html,/Scan to watch video/);assert.ok(html.includes(lang==='th'?'เปิดไทม์ไลน์เพื่อดูวิดีโอ':'Open timeline to watch'));assert.ok(!html.includes('<video'));
}
console.log('Care videos passed: real container metadata, duration/size/codec validation, bounded streaming, per-event limits, idempotency, scoped playback/posters/ranges/HEAD, expired/private isolation, deletion and backup.');
