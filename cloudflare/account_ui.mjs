export function accountScreen({node,resizedPhoto}) {
  const dialog=Object.assign(node('dialog'),{id:'account-dialog',className:'account-workspace'});
  dialog.setAttribute('aria-label','บัญชีผู้ใช้งาน');
  const heading=node('h2','บัญชีผู้ใช้งาน');
  const close=Object.assign(node('button','ปิด'),{type:'button'});
  const status=node('p'); status.setAttribute('role','status');
  const content=node('div');
  dialog.append(heading,close,status,content);document.body.append(dialog);
  let forced=false;
  close.onclick=()=>{if(!forced)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(forced)event.preventDefault();});
  const button=(text,action)=>{const b=Object.assign(node('button',text),{type:'button'});b.onclick=action;return b;};
  const field=(form,label,type,value='')=>{
    const caption=node('label',label),input=node('input');input.type=type;input.value=value;
    if(type==='password'){input.minLength=8;input.maxLength=128;input.autocomplete='new-password';}
    caption.append(input);form.append(caption);return input;
  };
  async function send(path,method,body) {
    status.textContent='กำลังบันทึก…';
    const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw Error(({invalid_credentials:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',rate_limited:'ลองหลายครั้ง กรุณารอ 1 นาที',
      duplicate:'ชื่อผู้ใช้หรืออีเมลนี้มีในระบบแล้ว',last_admin:'ไม่สามารถปิดบัญชีหรือลดสิทธิ์ของตนเอง',
      conflict:'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดข้อมูลล่าสุด',invalid:'กรุณาตรวจข้อมูลและรหัสผ่านให้ครบถ้วน'})[data.status] || 'บันทึกไม่สำเร็จ');
    status.textContent='บันทึกแล้ว';return data;
  }
  function submit(form,label,action) {
    const save=Object.assign(node('button',label),{type:'submit'});form.append(save);
    form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;
      try{await action();}catch(error){status.textContent=error.message || 'ยังยืนยันผลไม่ได้ กรุณาตรวจข้อมูลล่าสุด';}
      finally{save.disabled=false;}};
  }
  function open(title){document.querySelector('.account-menu').open=false;heading.textContent=title;status.textContent='';content.replaceChildren();if(!dialog.open)dialog.showModal();}
  async function profile() {
    try {
      const response=await fetch('/api/account');if(!response.ok)throw Error('เปิดบัญชีไม่ได้');
      const account=await response.json();
      open('ข้อมูลผู้ใช้');forced=!!account.needs_password;close.disabled=forced;
      if(forced)status.textContent='กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน';
      if(!forced){
        const form=node('form'),name=field(form,'ชื่อที่แสดง','text',account.displayName);name.required=true;name.maxLength=80;
        content.append(node('p',account.username+' · '+account.email),form);
        submit(form,'บันทึกข้อมูลผู้ใช้',async()=>{await send('/api/account/profile','PUT',{displayName:name.value});
          document.getElementById('account-name').textContent=name.value.trim();});
        const photo=node('div');photo.className='photo-actions';
        const upload=field(photo,'เปลี่ยนรูปผู้ใช้','file');upload.accept='image/*';
        upload.onchange=async()=>{if(!upload.files?.[0])return;upload.disabled=true;
          try{const blob=await resizedPhoto(upload.files[0]);const result=await fetch('/api/account/photo',{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:blob});
            if(!result.ok)throw Error('บันทึกรูปไม่สำเร็จ');await refreshAvatar();status.textContent='บันทึกรูปแล้ว';}
          catch(error){status.textContent=error.message;}finally{upload.disabled=false;}};
        if(account.has_photo)photo.append(button('ลบรูปผู้ใช้',async()=>{try{
          const result=await fetch('/api/account/photo',{method:'DELETE'});if(!result.ok)throw Error('ลบรูปไม่สำเร็จ');location.reload();
        }catch(error){status.textContent=error.message;}}));
        content.append(photo);
      }
      const passwords=node('form');
      const current=field(passwords,'รหัสผ่านปัจจุบัน','password');current.autocomplete='current-password';current.minLength=0;
      const password=field(passwords,'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)','password');
      const confirmation=field(passwords,'ยืนยันรหัสผ่านใหม่','password');
      for(const input of [current,password,confirmation])input.required=true;
      content.append(node('h3','เปลี่ยนรหัสผ่าน'),passwords);
      submit(passwords,'เปลี่ยนรหัสผ่าน',async()=>{await send('/api/account/password','PUT',{
        currentPassword:current.value,password:password.value,confirmation:confirmation.value});
        current.value=password.value=confirmation.value='';location.reload();});
    } catch(error){status.textContent=error.message;}
  }
  async function directory(){
    open('จัดการผู้ใช้งาน');forced=false;close.disabled=false;
    try{
      const response=await fetch('/api/users');if(!response.ok)throw Error('ไม่มีสิทธิ์จัดการผู้ใช้งาน');
      const {users}=await response.json();content.append(button('+ เพิ่มผู้ใช้',()=>editor(null)));
      content.append(node('p','ใช้อีเมลที่ได้รับอนุญาตใน Cloudflare Access เท่านั้น การเพิ่มในหน้านี้ไม่ข้ามนโยบาย Access'));
      for(const user of users){const row=Object.assign(node('article'),{className:'card account-user-card'});row.append(node('h3',user.display_name),
        node('p',[user.username,user.email,user.is_admin?'ผู้ดูแลระบบ':'เจ้าหน้าที่',user.active?'ใช้งาน':'ปิดใช้งาน'].filter(Boolean).join(' · ')),
        button('แก้ไข',()=>editor(user)),button('ตั้งรหัสผ่านใหม่',()=>reset(user)));content.append(row);}
    }catch(error){status.textContent=error.message;}
  }
  function editor(user){
    open(user?'แก้ไขผู้ใช้':'เพิ่มผู้ใช้');
    const form=node('form');
    const username=field(form,'ชื่อผู้ใช้','text',user?.username ?? '');username.pattern='[A-Za-z0-9_.-]{3,32}';username.required=true;
    const displayName=field(form,'ชื่อที่แสดง','text',user?.display_name ?? '');displayName.required=true;displayName.maxLength=80;
    const email=field(form,'อีเมลที่ใช้เข้าสู่ระบบ Cloudflare Access','email',user?.email ?? '');email.required=true;
    const admin=field(form,'ผู้ดูแลระบบ','checkbox');admin.checked=!!user?.is_admin;
    const active=field(form,'เปิดใช้งาน','checkbox');active.checked=user ? !!user.active : true;
    const password=user ? null : field(form,'รหัสผ่านชั่วคราว','password');
    const confirmation=user ? null : field(form,'ยืนยันรหัสผ่านชั่วคราว','password');
    if(password){password.required=true;confirmation.required=true;}
    submit(form,'บันทึกผู้ใช้',async()=>{await send('/api/users'+(user?'/'+user.id:''),user?'PUT':'POST',{
      username:username.value,displayName:displayName.value,email:email.value,isAdmin:admin.checked,active:active.checked,
      version:user?.session_version,password:password?.value,confirmation:confirmation?.value});await directory();});
    form.append(button('กลับรายชื่อ',directory));content.append(form);
  }
  function reset(user){
    open('ตั้งรหัสผ่านใหม่ · '+user.display_name);const form=node('form');
    const password=field(form,'รหัสผ่านชั่วคราว','password'),confirmation=field(form,'ยืนยันรหัสผ่านชั่วคราว','password');
    password.required=confirmation.required=true;
    content.append(node('p','ผู้ใช้ต้องเปลี่ยนรหัสผ่านก่อนกลับมาใช้งาน'),form);
    submit(form,'ตั้งรหัสผ่านใหม่',async()=>{await send('/api/users/'+user.id,'PUT',{
      action:'reset',version:user.session_version,password:password.value,confirmation:confirmation.value});
      password.value=confirmation.value='';location.reload();});form.append(button('กลับรายชื่อ',directory));
  }
  async function refreshAvatar(){
    const response=await fetch('/api/account');if(!response.ok)return;
    const account=await response.json();
    if(account.has_photo){const image=node('img');image.src='/api/account/photo?v='+Date.now();image.alt='รูปผู้ใช้';
      image.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';
      document.querySelector('.account-avatar').replaceChildren(image);}
    if(account.needs_password)await profile();
  }
  document.getElementById('open-account').onclick=profile;
  const users=document.getElementById('open-users');if(users)users.onclick=directory;
  refreshAvatar().catch(()=>{});
  return {profile,directory};
}
