const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function discussionMarkup(comments,eventId,route,lang) {
  const en=lang==='en';
  const date=value=>new Intl.DateTimeFormat(en?'en-GB':'th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));
  const row=comment=>`<div class="care-comment${comment.deleted_at?' is-deleted':''}" data-id="${comment.id}" data-author="${comment.author_kind}"><div class="care-comment-header"><strong>${comment.author_kind==='guardian'?(en?'Parents':'ผู้ปกครอง'):en?'Little Paws team':'ทีม Little Paws'}</strong><time>${escape(date(comment.created_at))}${comment.updated_at?(en?' · Edited':' · แก้ไขแล้ว'):''}</time></div><p class="care-comment-body">${escape(comment.deleted_at?(en?'Comment deleted':'ลบความคิดเห็นแล้ว'):comment.body)}</p>${comment.deleted_at?'':`<div class="care-comment-actions"><button type="button" data-comment-action="like-comment" aria-pressed="${Boolean(comment.liked)}">♡ ${en?'Like':'ถูกใจ'} · ${Number(comment.like_count)||0}</button>${comment.can_edit?`<button type="button" data-comment-action="edit-comment">${en?'Edit':'แก้ไข'}</button><button type="button" data-comment-action="delete-comment">${en?'Delete':'ลบ'}</button>`:''}</div>`}</div>`;
  const entries=comments.filter(c=>!c.parent_id).map(parent=>row(parent)+comments.filter(reply=>reply.parent_id===parent.id).map(row).join('')).join('');
  return `<section class="care-discussion" data-event="${eventId}" data-endpoint="${route}/interactions"><h4>${en?'Comments':'ความคิดเห็น'} · ${comments.filter(c=>!c.parent_id).length}</h4>
    <div class="care-comments">${entries||`<p>${en?'Be the first to leave a message 🩷':'ส่งข้อความถึงน้องและทีมดูแลได้เลยครับ 🩷'}</p>`}</div>
    <form class="care-comment-form"><label>${en?'Your comment · Parents':'เขียนความคิดเห็น · ผู้ปกครอง'}<textarea name="comment" maxlength="500" rows="2" required placeholder="${en?'Send a little love to your pet…':'ฝากข้อความถึงน้องหรือทีมดูแล…'}"></textarea></label><button type="submit">${en?'Send comment':'ส่งความคิดเห็น'}</button></form>
    <button type="button" class="care-comment-refresh care-heart">${en?'Refresh comments':'อัปเดตความคิดเห็น'}</button><p class="care-interaction-status" role="status"></p></section>`;
}

export function guardianInteractions() {
  const en=document.documentElement.lang==='en';
  const author=kind=>kind==='guardian'?(en?'Parents':'ผู้ปกครอง'):en?'Little Paws team':'ทีม Little Paws';
  const node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
  const dates=new Intl.DateTimeFormat(en?'en-GB':'th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'});
  function render(section,comments) {
    const list=section.querySelector('.care-comments');list.replaceChildren();
    section.querySelector('h4').textContent=(en?'Comments':'ความคิดเห็น')+' · '+comments.filter(c=>!c.parent_id).length;
    function row(comment){const box=node('div');box.className='care-comment'+(comment.deleted_at?' is-deleted':'');box.dataset.author=comment.author_kind;box.dataset.id=comment.id;
      const heading=node('div');heading.className='care-comment-header';heading.append(node('strong',author(comment.author_kind)),node('time',dates.format(new Date(comment.created_at))+(comment.updated_at?(en?' · Edited':' · แก้ไขแล้ว'):'')));
      const body=node('p',comment.deleted_at?(en?'Comment deleted':'ลบความคิดเห็นแล้ว'):comment.body);body.className='care-comment-body';box.append(heading,body);
      if(!comment.deleted_at){const actions=node('div');actions.className='care-comment-actions';
        const like=node('button','♡ '+(en?'Like':'ถูกใจ')+' · '+(Number(comment.like_count)||0));like.type='button';like.dataset.commentAction='like-comment';like.setAttribute('aria-pressed',String(Boolean(comment.liked)));actions.append(like);
        if(comment.can_edit)for(const [action,label] of [['edit-comment',en?'Edit':'แก้ไข'],['delete-comment',en?'Delete':'ลบ']]){const button=node('button',label);button.type='button';button.dataset.commentAction=action;actions.append(button);}
        box.append(actions);
      }return box;}
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
    section.addEventListener('click',async event=>{
      const control=event.target.closest('[data-comment-action]');if(!control || control.disabled)return;
      const box=control.closest('.care-comment'),action=control.dataset.commentAction;
      const body=box.querySelector('.care-comment-body').textContent;
      const mutation={action,eventId:Number(section.dataset.event),commentId:Number(box.dataset.id),expectedBody:body};
      async function save(data){control.disabled=true;status.textContent=en?'Saving…':'กำลังบันทึก…';
        try{const result=await send(section.dataset.endpoint,data);render(section,result.comments);status.textContent=en?'Saved':'บันทึกแล้ว';return true;}
        catch(error){status.textContent=error.message;return false;}finally{control.disabled=false;}}
      if(action==='like-comment')return save({...mutation,liked:control.getAttribute('aria-pressed')!=='true'});
      if(action==='delete-comment'){if(confirm(en?'Delete this comment? Replies will remain.':'ลบความคิดเห็นนี้หรือไม่? ข้อความตอบกลับยังคงอยู่'))await save(mutation);return;}
      if(box.querySelector('.care-comment-editor'))return;
      const editor=node('form');editor.className='care-comment-editor';
      const field=node('textarea');field.value=body;field.maxLength=500;field.required=true;field.rows=3;field.setAttribute('aria-label',en?'Edit comment':'แก้ไขความคิดเห็น');
      const submit=node('button',en?'Save':'บันทึก'),cancel=node('button',en?'Cancel':'ยกเลิก');submit.type='submit';cancel.type='button';
      cancel.onclick=()=>editor.remove();editor.append(field,submit,cancel);box.append(editor);field.focus();
      editor.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;field.disabled=true;
        if(!await save({...mutation,body:field.value.trim()})){submit.disabled=false;field.disabled=false;}};
    });
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
