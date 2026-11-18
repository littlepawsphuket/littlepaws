import assert from 'node:assert/strict';
import {scryptSync,pbkdf2Sync} from 'node:crypto';
import {verifyPassword,hashPassword,recheckIn} from './staff_users.mjs';

export async function testStaffUsers({sqlite,env,staffCall,context}) {
  const original=sqlite.prepare('SELECT * FROM app_users WHERE id=1').get();
  const fixturePassword='Synthetic-password-42';
  for(const method of ['scrypt:32768:8:1','pbkdf2:sha256:600000']){
    const salt='synthetic-only-salt';
    const digest=method.startsWith('scrypt') ? scryptSync(fixturePassword,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})
      : pbkdf2Sync(fixturePassword,salt,600000,32,'sha256');
    assert.equal(await verifyPassword(method+'$'+salt+'$'+digest.toString('hex'),fixturePassword),true);
  }
  const hashed=await hashPassword(fixturePassword);
  assert.equal(await verifyPassword(hashed,fixturePassword),true);
  assert.equal(await verifyPassword(hashed,'wrong'),false);
  assert.equal(await verifyPassword('scrypt:999999999:8:1$salt$'+'0'.repeat(128),fixturePassword),false);
  sqlite.prepare('UPDATE app_users SET password_hash=?,needs_password=0 WHERE id=1').run(hashed);
  const mutation=(method,body)=>({method,headers:{Origin:'https://staff.example.test','Content-Type':'application/json'},body:JSON.stringify(body)});
  const account=await (await staffCall('/api/account',{},context)).json();
  assert.ok(!JSON.stringify(account).includes('password_hash'));
  const alice={username:'fixture.alice',displayName:'Fixture Alice',email:'alice@example.test',
    isAdmin:false,active:true,password:'Temporary-password-42',confirmation:'Temporary-password-42'};
  assert.equal((await staffCall('/api/users',{...mutation('POST',alice),headers:{'Content-Type':'application/json'}},context)).status,403);
  const created=await (await staffCall('/api/users',mutation('POST',alice),context)).json();
  assert.equal(created.status,'saved');
  const aliceContext={access:{...context.access,getIdentity:async()=>({email:alice.email})}};
  assert.equal((await staffCall('/api/dashboard',{},aliceContext)).status,403); // Must change temporary password.
  assert.equal((await staffCall('/api/account/password',mutation('PUT',{
    currentPassword:alice.password,password:'New-alice-password-43',confirmation:'New-alice-password-43'}),aliceContext)).status,200);
  assert.equal((await staffCall('/api/users',{},aliceContext)).status,403);
  const users=await (await staffCall('/api/users',{},context)).json();
  assert.ok(!JSON.stringify(users).includes('password_hash'));
  const updatedAlice=users.users.find(user=>user.id===created.id);
  assert.equal((await staffCall('/api/users/'+created.id,mutation('PUT',{...alice,active:false,version:updatedAlice.session_version}),context)).status,200);
  assert.equal((await staffCall('/api/account',{},aliceContext)).status,403);
  assert.equal((await staffCall('/api/users/'+created.id,mutation('PUT',{...alice,version:updatedAlice.session_version}),context)).status,409);
  assert.equal((await staffCall('/api/users/1',mutation('PUT',{...alice,username:original.username,email:'admin@example.test',
    isAdmin:false,version:account.session_version}),context)).status,409);
  const actor={id:1,email:'admin@example.test',session_version:original.session_version,is_admin:1};
  sqlite.exec("INSERT INTO system_settings(key,value) VALUES('care_link_hours','48') ON CONFLICT(key) DO UPDATE SET value='48'");
  sqlite.exec(`INSERT INTO stays(id,customer_id,checkin,checkout,status,actual_checkout_at)
    VALUES(9001,1,'2026-01-01','2026-01-03','completed','2026-01-03T00:00:00Z'),
          (9002,1,'2026-01-01','2026-01-03','completed','2026-01-03T00:00:00Z');
    INSERT INTO stay_dogs(stay_id,dog_id) VALUES(9001,1),(9002,1);
    INSERT INTO care_share_links(stay_id,dog_id,token) VALUES(9001,1,'${'r'.repeat(43)}'),(9002,1,'${'s'.repeat(43)}');
    DELETE FROM staff_credential_attempts;`);
  const before=sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  assert.equal(await recheckIn(env.DB,9001,{username:original.username,password:'wrong'},actor,new Date('2026-01-04T00:00:00Z')),'invalid_credentials');
  assert.equal(sqlite.prepare('SELECT status FROM stays WHERE id=9001').get().status,'completed');
  assert.equal(await recheckIn(env.DB,9001,{username:original.username,password:fixturePassword},actor,new Date('2026-01-04T00:00:00Z')),'saved');
  assert.equal(sqlite.prepare('SELECT status,actual_checkout_at FROM stays WHERE id=9001').get().actual_checkout_at,null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM care_share_links WHERE stay_id=9001').get().n,1);
  assert.equal(await recheckIn(env.DB,9002,{username:original.username,password:fixturePassword},actor,new Date('2026-01-10T00:00:00Z')),'saved');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM care_share_links WHERE stay_id=9002').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,before);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_security_events WHERE action='recheck_in'").get().n,2);
  for(let n=0;n<5;n++)assert.equal(await recheckIn(env.DB,9001,{username:original.username,password:'wrong'},actor,new Date('2026-01-11T00:00:00Z')),'invalid_credentials');
  assert.equal(await recheckIn(env.DB,9001,{username:original.username,password:fixturePassword},actor,new Date('2026-01-11T00:00:00Z')),'rate_limited');
  sqlite.prepare('UPDATE app_users SET password_hash=? WHERE id=1').run(original.password_hash);
}
