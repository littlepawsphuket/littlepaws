// Browser-only preparation. The original video is not transcoded; the server validates its real duration/codec.
export async function prepareActivityVideo(file,key){
 const en=document.documentElement.lang==='en';
 if(!file.size||file.size>50_000_000)throw Error(en?'Each video must be 50 MB or smaller.':'วิดีโอแต่ละคลิปต้องไม่เกิน 50 MB');
 if(!/\.(mp4|mov|m4v)$/i.test(file.name)&&!['video/mp4','video/quicktime'].includes(file.type))throw Error(en?'Choose an MP4 or MOV video.':'กรุณาเลือกวิดีโอ MP4 หรือ MOV');
 const video=document.createElement('video'),url=URL.createObjectURL(file);video.preload='auto';video.muted=true;video.playsInline=true;
 let duration;
 try{
  duration=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(en?'Could not read this video. Try exporting it as MP4 (H.264).':'อ่านวิดีโอไม่ได้ กรุณาลองส่งออกเป็น MP4 (H.264)')),15000);
   video.onloadedmetadata=()=>{clearTimeout(timer);resolve(video.duration);};video.onerror=()=>{clearTimeout(timer);reject(Error(en?'This device cannot read this video. Try MP4 (H.264).':'อุปกรณ์นี้อ่านวิดีโอไม่ได้ กรุณาลองใช้ MP4 (H.264)'));};video.src=url;
  });
  if(!Number.isFinite(duration)||duration<=0||duration>30)throw Error(en?'Each video must be no longer than 30 seconds.':'วิดีโอแต่ละคลิปต้องยาวไม่เกิน 30 วินาที');
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const context=canvas.getContext('2d');
  context.fillStyle='#e6f1eb';context.fillRect(0,0,960,540);context.fillStyle='#155747';context.beginPath();context.moveTo(425,175);context.lineTo(425,365);context.lineTo(590,270);context.fill();
  context.font='28px system-ui';context.textAlign='center';context.fillText('Little Paws · '+Math.ceil(duration)+'s',480,440);
  await new Promise(resolve=>{let finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);
    if(video.readyState>=2&&video.videoWidth){const ratio=Math.min(960/video.videoWidth,540/video.videoHeight);const w=video.videoWidth*ratio,h=video.videoHeight*ratio;context.drawImage(video,(960-w)/2,(540-h)/2,w,h);}resolve();};
   const timer=setTimeout(finish,1800);video.onseeked=finish;video.onloadeddata=()=>{if(video.currentTime>=.05)finish();};
   try{video.currentTime=Math.min(.1,duration/2);if(video.readyState>=2&&video.currentTime===0)finish();}catch{finish();}
  });
  const poster=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!poster)throw Error(en?'Could not prepare the video cover.':'เตรียมภาพปกวิดีโอไม่สำเร็จ');
  return {file,poster,key,duration};
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
export function uploadActivityFile(url,blob,headers,onProgress){
 return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',url);xhr.responseType='json';xhr.timeout=10*60*1000;
  for(const [name,value] of Object.entries(headers))xhr.setRequestHeader(name,value);
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.floor(event.loaded/event.total*100));};
  xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve(xhr.response);else reject(Object.assign(Error('upload_failed'),{status:xhr.response?.status || (xhr.status===413?'invalid_size':'upload_failed')}));};
  xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(Error('upload_failed'));xhr.send(blob);
 });
}
