export function backupScreen({node,results,message,storedArchive,back}) {
  function render(){
    const panel=Object.assign(node('article'),{className:'card backup-workspace'}),save=Object.assign(node('button','ดาวน์โหลดข้อมูลและรูปทั้งหมด'),{type:'button'});
    const status=node('p');status.setAttribute('role','status');
    panel.append(node('h2','สำรองข้อมูล Cloudflare'),node('p','ไฟล์ ZIP รวมข้อมูล รูปน้อง กิจกรรม ลายเซ็น และ QR ชำระเงิน เก็บไฟล์ไว้ในที่ส่วนตัว เพราะมีข้อมูลลูกค้าและข้อมูลผู้ใช้'),save,status);
    const manual=node('a','คู่มือสำรองและกู้คืน');manual.href='/api/manual/backup.html';manual.target='_blank';manual.rel='noopener';panel.append(manual);
    const previous=Object.assign(node('button','กลับไปตั้งค่า'),{type:'button'});previous.onclick=back;panel.append(previous);
    save.onclick=async()=>{
      save.disabled=true;message.textContent='';const files={},manifest=[];let total=0;
      try{
        status.textContent='กำลังเตรียมสำเนาฐานข้อมูล…';
        const reply=await fetch('/api/backup/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        if(!reply.ok)throw Error(reply.status===413?'ข้อมูลมากเกินขนาดสำรองผ่านเว็บ กรุณาใช้คู่มือ Cloudflare':'เตรียมสำเนาข้อมูลไม่สำเร็จ');
        const snapshot=await reply.json();
        const keys=[...snapshot.required_media,...snapshot.optional_media];
        for(let index=0;index<keys.length;index++){
          const key=keys[index];status.textContent='กำลังสำรองไฟล์ '+(index+1)+' / '+keys.length;
          const response=await fetch('/api/backup/media?'+new URLSearchParams({key}));
          if(response.status===404 && snapshot.optional_media.includes(key))continue;
          if(!response.ok)throw Error('ไฟล์เปลี่ยนระหว่างสำรอง กรุณากดสำรองใหม่');
          const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;
          if(total>64*1024*1024)throw Error('รูปมีขนาดมากเกิน 64 MB กรุณาใช้ขั้นตอนสำรองขนาดใหญ่ในคู่มือ');
          const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
          files['objects/'+key]=bytes;manifest.push({key,bytes:bytes.length,sha256:[...digest].map(v=>v.toString(16).padStart(2,'0')).join('')});
        }
        files['snapshot.json']=JSON.stringify(snapshot,null,2);
        files['objects.json']=JSON.stringify(manifest,null,2);
        const blob=storedArchive(files),url=URL.createObjectURL(blob),link=node('a');
        link.href=url;link.download='little-paws-cloud-'+new Date().toISOString().replaceAll(':','-')+'.zip';
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        status.textContent='เตรียมไฟล์สำรองแล้ว · '+manifest.length+' ไฟล์ กรุณาตรวจไฟล์ในโฟลเดอร์ดาวน์โหลด';
      }catch(error){status.textContent=error.message || 'สำรองไม่สำเร็จ กรุณาลองใหม่';}finally{save.disabled=false;}
    };
    results.replaceChildren(panel);
  }
  return {render};
}
