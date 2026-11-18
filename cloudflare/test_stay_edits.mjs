import assert from 'node:assert/strict';

export async function testStayEdits({sqlite,staffCall,context}) {
  const request=body=>({method:'PUT',headers:{Origin:'https://staff.example.test','Content-Type':'application/json'},body:JSON.stringify(body)});
  const summary=async()=>await (await staffCall('/api/stays/9001',{},context)).json();
  sqlite.exec(`UPDATE stays SET payment_tracking=1,agreed_total=1000,charged_nights=1,discount_cents=0,rounding_cents=0,
    intake='{"food_packed":"1","food":"Old item"}' WHERE id=9001;
    UPDATE stay_dogs SET nightly_rate_cents=100000 WHERE stay_id=9001;`);
  const original=await summary();
  let body={customerId:1,service:'monthly',checkin:'2026-01-01',checkout:'2026-02-12',quantity100:140,
    discountCents:0,dogs:[{id:1,rate:100000}],note:'Synthetic edit',couponCode:'',intake:{exam_eyes:'normal'},
    revision:original.cloud_revision,paymentSnapshot:original.payment_snapshot};
  async function save(form){
    let response=await staffCall('/api/stays/9001',request(form),context),data=await response.json();
    if(data.status==='warning'){
      response=await staffCall('/api/stays/9001',request({...form,warningToken:data.token}),context);data=await response.json();
    }
    return {response,data};
  }
  assert.equal((await save({...body,customerId:3})).response.status,409);
  assert.equal((await save({...body,dogs:[{id:3,rate:100000}]})).response.status,409);
  assert.equal((await save(body)).data.status,'saved');
  const edited=await summary();
  assert.equal(edited.total_cents,140000);
  assert.equal(edited.charged_nights,1.4);
  assert.equal(edited.intake.food,undefined); // Clearing packed items must remove old data.
  assert.equal(edited.intake.service_type,'monthly');
  assert.notEqual(edited.cloud_revision,original.cloud_revision);
  assert.equal((await save(body)).response.status,409);
  body={...body,revision:edited.cloud_revision,paymentSnapshot:edited.payment_snapshot};
  sqlite.exec(`INSERT INTO transactions(occurred_on,kind,category,description,amount,stay_id,payment_type,payment_key)
    VALUES('2026-01-01','income','boarding','Synthetic payment',1300,9001,'additional','${'f'.repeat(32)}')`);
  assert.equal((await save(body)).response.status,409); // A newer payment invalidates the edit preview.
  const paid=await summary();body={...body,paymentSnapshot:paid.payment_snapshot};
  assert.equal((await save({...body,dogs:[{id:1,rate:50000}]})).data.status,'payment_exceeds');
  assert.equal((await save({...body,note:'After payment'})).data.status,'saved');
  const beforeClose=await summary();
  sqlite.exec("UPDATE stays SET status='completed' WHERE id=9001");
  assert.equal((await save({...body,revision:beforeClose.cloud_revision})).data.status,'stay_closed');
  assert.equal(sqlite.prepare('SELECT amount FROM transactions WHERE stay_id=9001').get().amount,1300);
  assert.equal(sqlite.prepare('SELECT note FROM stays WHERE id=9001').get().note,'After payment');
  sqlite.exec("UPDATE stays SET status='checked_in',payment_tracking=0 WHERE id=9001; DELETE FROM transactions WHERE stay_id=9001;");
  const legacy=await summary();
  assert.equal((await save({...body,revision:legacy.cloud_revision,paymentSnapshot:legacy.payment_snapshot})).data.status,'saved');
  assert.equal(sqlite.prepare('SELECT amount,auto_stay FROM transactions WHERE stay_id=9001').get().auto_stay,1);
  assert.equal(sqlite.prepare('SELECT amount FROM transactions WHERE stay_id=9001').get().amount,1400);
}
