const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function discussionMarkup(comments,eventId,route,lang) {
  const en=lang==='en';
  const date=value=>new Intl.DateTimeFormat(en?'en-GB':'th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));
  const row=comment=>`<div class="care-comment" data-author="${comment.author_kind}"><div class="care-comment-header"><strong>${comment.author_kind==='guardian'?'ผู้ปกครอง':en?'Little Paws team':'ทีม Little Paws'}</strong><time>${escape(date(comment.created_at))}</time></div><p>${escape(comment.body)}</p></div>`;
  const entries=comments.filter(c=>!c.parent_id).map(parent=>row(parent)+comments.filter(reply=>reply.parent_id===parent.id).map(row).join('')).join('');
  return `<section class="care-discussion" data-event="${eventId}" data-endpoint="${route}/interactions"><h4>${en?'Comments':'ความคิดเห็น'} · ${comments.filter(c=>!c.parent_id).length}</h4>
    <div class="care-comments">${entries||`<p>${en?'Be the first to leave a message 🩷':'ส่งข้อความถึงน้องและทีมดูแลได้เลยครับ 🩷'}</p>`}</div>
    <form class="care-comment-form"><label>${en?'Your comment · ผู้ปกครอง':'เขียนความคิดเห็น · ผู้ปกครอง'}<textarea name="comment" maxlength="500" rows="2" required placeholder="${en?'Send a little love to your pet…':'ฝากข้อความถึงน้องหรือทีมดูแล…'}"></textarea></label><button type="submit">${en?'Send comment':'ส่งความคิดเห็น'}</button></form>
    <button type="button" class="care-comment-refresh care-heart">${en?'Refresh comments':'อัปเดตความคิดเห็น'}</button><p class="care-interaction-status" role="status"></p></section>`;
}

export function guardianInteractions() {
  const en=document.documentElement.lang==='en';
  const author=kind=>kind==='guardian'?'ผู้ปกครอง':en?'Little Paws team':'ทีม Little Paws';
  const node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
  const dates=new Intl.DateTimeFormat(en?'en-GB':'th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'});
  function render(section,comments) {
    const list=section.querySelector('.care-comments');list.replaceChildren();
    section.querySelector('h4').textContent=(en?'Comments':'ความคิดเห็น')+' · '+comments.filter(c=>!c.parent_id).length;
    function row(comment){const box=node('div');box.className='care-comment';box.dataset.author=comment.author_kind;
      const heading=node('div');heading.className='care-comment-header';heading.append(node('strong',author(comment.author_kind)),node('time',dates.format(new Date(comment.created_at))));
      box.append(heading,node('p',comment.body));return box;}
    for(const comment of comments.filter(c=>!c.parent_id)){list.append(row(comment));for(const reply of comments.filter(c=>c.parent_id===comment.id))list.append(row(reply));}
  }
  async function send(endpoint,body){
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error(response.status===404?(en?'This link or activity is no longer available.':'ลิงก์หรือกิจกรรมนี้ไม่พร้อมใช้งานแล้ว'):
      response.status===429?(en?'Please wait a moment before sending another comment.':'กรุณารอสักครู่ก่อนส่งความคิดเห็นอีกครั้ง'):
      (en?'Could not send. Please try again.':'ส่งไม่สำเร็จ กรุณาลองใหม่'));
    return result;
  }
  for(const button of document.querySelectorAll('.care-heart[data-photo]')){
    button.onclick=async()=>{
      if(button.disabled)return;button.disabled=true;
      const event=button.closest('article'),section=event.querySelector('.care-discussion');
      const status=section.querySelector('[role=status]');status.textContent='';
      try{const result=await send(section.dataset.endpoint,{action:'heart',eventId:Number(section.dataset.event),photoId:Number(button.dataset.photo),liked:button.getAttribute('aria-pressed')!=='true'});
        button.setAttribute('aria-pressed',String(result.liked));button.querySelector('span').textContent=result.liked?(en?'Loved · 1':'ส่งหัวใจแล้ว · 1'):(en?'Send love':'ส่งหัวใจ');
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };
  }
  for(const section of document.querySelectorAll('.care-discussion')){
    const form=section.querySelector('form'),input=form.querySelector('textarea'),button=form.querySelector('button'),status=section.querySelector('[role=status]');
    let pending=null;
    input.addEventListener('input',()=>{if(pending?.body!==input.value.trim())pending=null;});
    form.onsubmit=async event=>{
      event.preventDefault();if(button.disabled || !input.value.trim())return;
      const key=crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
      pending ||= {key,body:input.value.trim()};button.disabled=true;input.disabled=true;status.textContent=en?'Sending…':'กำลังส่ง…';
      try{const result=await send(section.dataset.endpoint,{action:'comment',eventId:Number(section.dataset.event),...pending});
        render(section,result.comments);input.value='';pending=null;status.textContent=en?'Comment sent 🩷':'ส่งความคิดเห็นแล้ว 🩷';
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;input.disabled=false;}
    };
    const refresh=section.querySelector('.care-comment-refresh');
    refresh.onclick=async()=>{refresh.disabled=true;try{
      const response=await fetch(section.dataset.endpoint+'?event='+section.dataset.event);if(!response.ok)throw Error();
      render(section,(await response.json()).comments);status.textContent=en?'Up to date':'อัปเดตแล้ว';
    }catch{status.textContent=en?'Could not refresh. Please reload this page.':'อัปเดตไม่ได้ กรุณาโหลดหน้านี้อีกครั้ง';}finally{refresh.disabled=false;}};
  }
}
