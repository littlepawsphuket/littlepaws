import {authorizedStaff} from './stay_payments.mjs';
import {validJpeg} from './dog_photos.mjs';
export const videoLimit=50_000_000;
export const videoSeconds=30;
const revisionPattern=/^[a-f0-9-]{36}$/;
export const validVideoKey=key=>typeof key==='string' && /^care\/videos\/[a-f0-9-]{36}\.(?:mp4|mov)$/.test(key);
export const validPosterKey=key=>typeof key==='string' && /^care\/videos\/[a-f0-9-]{36}\.jpg$/.test(key);
const activeEvent=`FROM care_events e JOIN stays s ON s.id=e.stay_id
 JOIN stay_dogs sd ON sd.stay_id=e.stay_id AND sd.dog_id=e.dog_id
 WHERE e.id=? AND e.stay_id=? AND e.dog_id=? AND e.cloud_revision IS ?
 AND s.status='checked_in' AND s.cancelled_at IS NULL AND ${authorizedStaff}`;
const authArgs=(scope,revision,actor)=>[scope.eventId,scope.stayId,scope.dogId,revision,actor.id,actor.email];
const four=(bytes,offset)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
function box(bytes,offset,end){
 if(offset+8>end)throw Error('invalid_video');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let size=d.getUint32(offset),header=8;
 if(size===1){if(offset+16>end)throw Error('invalid_video');size=Number(d.getBigUint64(offset+8));header=16;}
 if(size===0)size=end-offset;
 if(!Number.isSafeInteger(size)||size<header||offset+size>end)throw Error('invalid_video');
 return {type:four(bytes,offset+4),start:offset+header,end:offset+size,size};
}
// Parse container metadata only. Never decode or buffer the video payload in a Worker.
export function parseMovieMetadata(bytes){
 let duration=null,codec=null,videoTracks=0,boxes=0;
 function walk(start,end,depth,container){
  if(depth>8)throw Error('invalid_video');let handler=null,localCodec=null;
  for(let at=start;at<end;){if(++boxes>5000)throw Error('invalid_video');const b=box(bytes,at,end);at=b.end;
   const data=new DataView(bytes.buffer,bytes.byteOffset+b.start,b.end-b.start);
   if(b.type==='mvhd'){
    const version=bytes[b.start];if(version!==0&&version!==1)throw Error('invalid_video');
    const scaleOffset=version===1?20:12,durationOffset=version===1?24:16;
    if(data.byteLength<durationOffset+(version===1?8:4))throw Error('invalid_video');
    const scale=data.getUint32(scaleOffset),ticks=version===1?Number(data.getBigUint64(durationOffset)):data.getUint32(durationOffset);
    if(!scale||!Number.isSafeInteger(ticks)||ticks<=0)throw Error('invalid_video');duration=Math.ceil(ticks*1000/scale);
   }
   // QuickTime also has a data-reference hdlr (alis) inside minf; it is not the media handler.
   if(b.type==='hdlr'&&container==='mdia'){if(data.byteLength<12)throw Error('invalid_video');handler=four(bytes,b.start+8);}
   if(b.type==='stsd'){
    if(data.byteLength<8||data.getUint32(4)!==1)throw Error('invalid_video');const sample=box(bytes,b.start+8,b.end);localCodec=sample.type;
   }
   if(['moov','trak','mdia','minf','stbl'].includes(b.type)){
    const child=walk(b.start,b.end,depth+1,b.type);if(child.handler)handler=child.handler;if(child.codec)localCodec=child.codec;
   }
  }
  if(handler==='vide'&&depth===2){videoTracks++;codec=localCodec;}
  return {handler,codec:localCodec};
 }
 walk(0,bytes.length,0);
 if(videoTracks!==1||!['avc1','avc3','hvc1','hev1'].includes(codec)||!Number.isSafeInteger(duration)||duration<1)throw Error('invalid_video');
 if(duration>videoSeconds*1000)throw Error('too_long');
 return {duration_ms:duration,codec};
}
export async function inspectStoredVideo(media,key,size){
 async function read(offset,length){const object=await media.get(key,{range:{offset,length}});if(!object)throw Error('invalid_video');
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==length)throw Error('invalid_video');return bytes;}
 let position=0,moov=null,mime=null,count=0,hasData=false;
 while(position<size){
  if(++count>24||position+8>size)throw Error('invalid_video');const header=await read(position,Math.min(16,size-position));
  const view=new DataView(header.buffer,header.byteOffset,header.length);let length=view.getUint32(0),head=8;const type=four(header,4);
  if(length===1){if(header.length<16)throw Error('invalid_video');length=Number(view.getBigUint64(8));head=16;}
  if(length===0)length=size-position;
  if(!Number.isSafeInteger(length)||length<head||position+length>size)throw Error('invalid_video');
  if(type==='ftyp'){
   if(position!==0||length<16||length>1024)throw Error('invalid_video');const data=await read(position,length);
   const brand=four(data,head);mime=brand==='qt  '?'video/quicktime':'video/mp4';
   const known=['qt  ','isom','iso2','iso4','iso5','iso6','mp41','mp42','avc1','M4V ','MSNV','heic','hvc1'];
   if(!known.includes(brand))throw Error('invalid_video');
  }
  if(type==='moov'){if(moov||length>512*1024)throw Error('invalid_video');moov=await read(position,length);}
  if(type==='mdat'&&length>head)hasData=true;
  position+=length;
 }
 if(!mime||!moov||!hasData)throw Error('invalid_video');return {...parseMovieMetadata(moov),mime};
}
export async function eventVideos(db,ids){
 if(!ids.length)return [];
 try{return (await db.prepare(`SELECT id,event_id,object_key,poster_key,byte_size,duration_ms,mime,codec FROM care_videos
  WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(JSON.stringify(ids)).all()).results;}
 catch(error){if(/no such table.*care_videos/i.test(String(error)))return [];throw error;}
}
async function clean(media,key){try{await media.delete(key);}catch{}}
export async function addCareVideo(db,media,scope,actor,request){
 const revision=request.headers.get('X-Event-Revision'),key=request.headers.get('X-Upload-Key');
 const size=Number(request.headers.get('X-Video-Size'));
 if(!Number.isSafeInteger(size)||size<1||size>videoLimit)return {status:'invalid_size'};
 if(!revisionPattern.test(revision||'')||!/^[a-f0-9]{32}$/.test(key||''))return {status:'invalid'};
 if(!request.body)return {status:'invalid_video'};
 const args=authArgs(scope,revision,actor),submission=actor.id+':'+scope.stayId+':'+scope.dogId+':'+scope.eventId+':'+key;
 const known=()=>db.prepare(`SELECT v.id FROM care_videos v WHERE v.cloud_upload_key=? AND v.event_id IN(SELECT e.id ${activeEvent})`).bind(submission,...args).first();
 const previous=await known();if(previous)return {status:'saved',videoId:previous.id};
 const allowed=await db.prepare(`SELECT e.id ${activeEvent} AND (SELECT count(*) FROM care_videos WHERE event_id=e.id)<2`).bind(...args).first();
 if(!allowed)return {status:'conflict'};
 const objectKey='care/videos/'+crypto.randomUUID()+'.mp4';
 // FixedLengthStream enforces the declared size, and R2 consumes it with bounded memory.
 const fixed=new FixedLengthStream(size);const piping=request.body.pipeTo(fixed.writable);
 const storing=media.put(objectKey,fixed.readable,{httpMetadata:{contentType:'application/octet-stream'}});
 try{await Promise.all([piping,storing]);}catch(error){await clean(media,objectKey);return {status:/length|byte|overflow|underflow/i.test(String(error))?'invalid_size':'upload_failed'};}
 let info;try{info=await inspectStoredVideo(media,objectKey,size);}catch(error){await clean(media,objectKey);return {status:error.message==='too_long'?'too_long':'invalid_video'};}
 // Database failure may be ambiguous; retain the object unless absence is known.
 let result;
 try{result=await db.batch([
  db.prepare(`INSERT INTO care_videos(event_id,object_key,byte_size,duration_ms,mime,codec,cloud_upload_key)
   SELECT e.id,?,?,?,?,?,? ${activeEvent} AND (SELECT count(*) FROM care_videos WHERE event_id=e.id)<2
   ON CONFLICT(cloud_upload_key) DO NOTHING`).bind(objectKey,size,info.duration_ms,info.mime,info.codec,submission,...args),
  db.prepare(`SELECT id FROM care_videos WHERE cloud_upload_key=?`).bind(submission)
 ]);}catch(error){throw error;}
 const row=result[1].results[0];if(result[0].meta.changes===1)return {status:'saved',videoId:row.id};
 await clean(media,objectKey);return row?{status:'saved',videoId:row.id}:{status:'conflict'};
}
export async function saveVideoPoster(db,media,scope,actor,bytes,revision){
 if(!validJpeg(bytes)||!revisionPattern.test(revision||''))return 'invalid';
 const args=authArgs(scope,revision,actor);
 const row=await db.prepare(`SELECT v.poster_key FROM care_videos v WHERE v.id=? AND v.event_id IN(SELECT e.id ${activeEvent})`).bind(scope.videoId,...args).first();
 if(!row)return 'conflict';const key='care/videos/'+crypto.randomUUID()+'.jpg';await media.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 const result=await db.prepare(`UPDATE care_videos SET poster_key=? WHERE id=? AND poster_key IS ? AND event_id IN(SELECT e.id ${activeEvent})`).bind(key,scope.videoId,row.poster_key,...args).run();
 if(result.meta.changes!==1){await clean(media,key);return 'conflict';}if(validPosterKey(row.poster_key))await clean(media,row.poster_key);return 'saved';
}
export async function removeCareVideo(db,media,scope,actor,form){
 if(!validVideoKey(form.key)||!revisionPattern.test(form.revision||''))return 'invalid';
 const args=authArgs(scope,form.revision,actor);
 const [rows,removed]=await db.batch([
  db.prepare(`SELECT object_key,poster_key FROM care_videos WHERE id=? AND object_key=? AND event_id IN(SELECT e.id ${activeEvent})`).bind(scope.videoId,form.key,...args),
  db.prepare(`DELETE FROM care_videos WHERE id=? AND object_key=? AND event_id IN(SELECT e.id ${activeEvent})`).bind(scope.videoId,form.key,...args)
 ]);
 if(removed.meta.changes!==1)return 'conflict';for(const row of rows.results){await clean(media,row.object_key);if(validPosterKey(row.poster_key))await clean(media,row.poster_key);}return 'saved';
}
export function videoRange(header,size){
 if(!header)return null;const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2]))return false;
 let start,end;if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return false;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;
 end=Math.min(end,size-1);return {offset:start,length:end-start+1};
}
export async function videoResponse(media,row,request,poster=false){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
 if(poster){if(!validPosterKey(row?.poster_key))return new Response(null,{status:404,headers});const object=await media.get(row.poster_key);return new Response(request.method==='HEAD'?null:object?.body??null,{status:object?200:404,headers:{...headers,'Content-Type':'image/jpeg'}});}
 if(!validVideoKey(row?.object_key))return new Response(null,{status:404,headers});
 const range=videoRange(request.headers.get('Range'),row.byte_size);headers['Accept-Ranges']='bytes';headers['Content-Type']=row.mime;
 headers['Content-Disposition']='inline; filename="activity-video.'+(row.mime==='video/quicktime'?'mov':'mp4')+'"';
 if(range===false)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+row.byte_size}});
 const length=range?range.length:row.byte_size;headers['Content-Length']=String(length);
 if(range)headers['Content-Range']=`bytes ${range.offset}-${range.offset+range.length-1}/${row.byte_size}`;
 if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
 const object=await media.get(row.object_key,range?{range}:undefined);
 return object?new Response(object.body,{status:range?206:200,headers}):new Response(null,{status:404});
}
export async function staffVideo(db,scope){return db.prepare(`SELECT v.* FROM care_videos v JOIN care_events e ON e.id=v.event_id
 JOIN stay_dogs sd ON sd.stay_id=e.stay_id AND sd.dog_id=e.dog_id
 WHERE v.id=? AND e.stay_id=? AND e.dog_id=?`).bind(scope.videoId,scope.stayId,scope.dogId).first();}
export const videoCss=`.care-video-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:.65rem;margin-top:.65rem}
.care-video-tile{min-width:0;background:var(--tint,#eef6f3);border:1px solid var(--line,#c9ded2);border-radius:1rem;padding:.55rem}
.care-video-tile video{display:block;width:100%;max-height:34rem;border-radius:.8rem;background:#152721;object-fit:contain}
.care-video-tile p{margin:.3rem 0;font-size:.85rem}.care-video-tile a{overflow-wrap:anywhere}`;
