import {adminGuard,actorArgs} from './repository.mjs';
import {fail,thaiDay} from './rules.mjs';

async function authorize(db,actor){
 if(!Number.isSafeInteger(actor?.id)||typeof actor.email!=='string')fail('forbidden');
 if(!await db.prepare(`SELECT 1 AS allowed WHERE ${adminGuard}`).bind(...actorArgs(actor)).first())fail('forbidden');
}
const fields=`p.id,p.pass_number,p.customer_id,c.name AS customer,p.size,p.purchase_at,p.expires_at,p.status,p.revision,p.snapshot,
 (SELECT COALESCE(SUM(remaining_units),0) FROM stay_pass_credit_lots WHERE pass_id=p.id) AS remaining_units,
 (SELECT COALESCE(SUM(reserved_units),0) FROM stay_pass_credit_lots WHERE pass_id=p.id) AS reserved_units,
 (SELECT COALESCE(SUM(refund_held_units),0) FROM stay_pass_credit_lots WHERE pass_id=p.id) AS refund_held_units,
 (SELECT COALESCE(SUM(remaining_units-reserved_units-refund_held_units),0) FROM stay_pass_credit_lots WHERE pass_id=p.id AND expires_at>?) AS valid_available_units,
 (SELECT COALESCE(SUM(remaining_units),0) FROM stay_pass_credit_lots WHERE pass_id=p.id AND expires_at<=?) AS expiration_pending_units,
 (SELECT json_group_array(json_object('id',d.id,'name',d.name,'photo_consent',pp.photo_consent)) FROM stay_pass_pets pp JOIN dogs d ON d.id=pp.dog_id WHERE pp.pass_id=p.id) AS pets`;
const statuses=new Set(['pending_payment','active','fully_used','expired','cancelled','refund_pending','refunded']);
function present(row,at){
 const snapshot=JSON.parse(row.snapshot),pets=JSON.parse(row.pets);
 const status=['active','fully_used'].includes(row.status)?row.expires_at<=at?'expired':row.remaining_units===0?'fully_used':'active':row.status;
 const {valid_available_units,...rest}=row;
 return {...rest,status,stored_status:row.status,snapshot,pets,last_valid_day:thaiDay(new Date(Date.parse(row.expires_at)-1).toISOString()),available_units:status==='active'?valid_available_units:0,
  expiring_soon:status==='active'&&Date.parse(row.expires_at)-Date.parse(at)<=30*86400000};
}
export async function passList(db,input={},actor,now=new Date()){
 await authorize(db,actor);
 const search=typeof input.search==='string'?input.search.trim():'';
 const offset=input.offset??0,status=input.status||'';
 if(search.length>100||!Number.isSafeInteger(offset)||offset<0||offset>10000||(status&&!statuses.has(status)))fail('invalid_search');
 const at=now.toISOString(),pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
 const computed=`CASE WHEN p.status IN('active','fully_used') THEN CASE WHEN p.expires_at<=? THEN 'expired' WHEN NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots l WHERE l.pass_id=p.id AND l.remaining_units>0) THEN 'fully_used' ELSE 'active' END ELSE p.status END`;
 const {results}=await db.prepare(`SELECT ${fields} FROM stay_passes p JOIN customers c ON c.id=p.customer_id
  WHERE ${adminGuard} AND (?='' OR (${computed})=?)
  AND (p.pass_number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM stay_pass_pets pp JOIN dogs d ON d.id=pp.dog_id WHERE pp.pass_id=p.id AND d.name LIKE ? ESCAPE '\\'))
  ORDER BY p.purchase_at DESC,p.id DESC LIMIT 26 OFFSET ?`).bind(at,at,...actorArgs(actor),status,at,status,pattern,pattern,pattern,offset).all();
 return {status:'ready',passes:results.slice(0,25).map(row=>present(row,at)),next_offset:results.length>25?offset+25:null,as_of:at};
}
export async function passDetail(db,id,actor,now=new Date()){
 await authorize(db,actor);
 if(typeof id!=='string'||id.length>100||!id)fail('invalid_request');
 const at=now.toISOString();
 // D1 batch provides one consistent read for the displayed balance and history.
 const [record,history,lots,payments,policy,allocations]=await db.batch([
  db.prepare(`SELECT ${fields} FROM stay_passes p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND ${adminGuard}`).bind(at,at,id,...actorArgs(actor)),
  db.prepare(`SELECT t.*,o.reason,o.actor_id,original.kind AS reversed_kind,EXISTS(SELECT 1 FROM stay_pass_operations co WHERE co.id=t.operation_id AND co.kind='checkout_reconciliation' AND co.result IS NOT NULL) AS checkout_adjustment FROM stay_pass_credit_transactions t
   JOIN stay_pass_operations o ON o.id=t.operation_id LEFT JOIN stay_pass_credit_transactions original ON original.id=t.reversal_of
   WHERE t.pass_id=? AND ${adminGuard} ORDER BY t.recorded_at,t.rowid`).bind(id,...actorArgs(actor)),
  db.prepare(`SELECT id,source_kind,source_lot_id,issued_units,origin_value_cents,remaining_units,reserved_units,refund_held_units,expires_at FROM stay_pass_credit_lots WHERE pass_id=? AND ${adminGuard} ORDER BY created_at,id`).bind(id,...actorArgs(actor)),
  db.prepare(`SELECT purpose,amount_cents,created_at FROM stay_pass_payment_links WHERE pass_id=? AND ${adminGuard} ORDER BY created_at,id`).bind(id,...actorArgs(actor)),
  db.prepare(`SELECT v.version,v.content_th,v.content_en,a.accepted_at,a.channel FROM stay_passes p JOIN stay_pass_policy_versions v ON v.id=p.policy_version_id
   LEFT JOIN stay_pass_policy_acceptances a ON a.pass_id=p.id WHERE p.id=? AND ${adminGuard}`).bind(id,...actorArgs(actor)),
  db.prepare(`SELECT a.booking_id,a.dog_id,d.name AS dog_name,a.reserved_units,a.consumed_units,b.booking_number,b.status AS booking_status,b.checkin,b.checkout,b.stay_id,(SELECT status FROM stays WHERE id=b.stay_id) AS stay_status,
   EXISTS(SELECT 1 FROM appointment_dogs WHERE appointment_id=b.id AND dog_id=a.dog_id) AS registered_in_booking FROM (
    SELECT booking_id,dog_id,reserved_units,consumed_units FROM stay_pass_booking_allocations WHERE pass_id=?
    UNION ALL SELECT b.id,ad.dog_id,0,0 FROM stay_pass_booking_links l JOIN appointments b ON b.id=l.booking_id JOIN appointment_dogs ad ON ad.appointment_id=b.id WHERE l.pass_id=? AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_allocations x WHERE x.pass_id=l.pass_id AND x.booking_id=b.id AND x.dog_id=ad.dog_id)
   ) a JOIN appointments b ON b.id=a.booking_id JOIN dogs d ON d.id=a.dog_id WHERE ${adminGuard}
   ORDER BY b.checkin,b.id,d.id`).bind(id,id,...actorArgs(actor))
 ]);
 if(!record.results.length)return {status:'not_found'};
 const pass=present(record.results[0],at),totals={used_units:0,cancellation_units:0,no_show_units:0,expired_units:0,refunded_units:0,restored_units:0,carry_units:0,purchased_units:0,transferred_units:0};
 const categories={stay_consumption:'used_units',daycare_consumption:'used_units',cancellation_deduction:'cancellation_units',no_show_deduction:'no_show_units',expiration:'expired_units',refund:'refunded_units',renewal_transfer_out:'transferred_units'};
 for(const row of history.results){const kind=row.kind==='reversal'?row.reversed_kind:row.kind;
  if(categories[kind])totals[categories[kind]]-=row.delta_units;
  if(kind==='credit_restoration'){totals.restored_units+=row.delta_units;if(row.checkout_adjustment)totals.used_units-=row.delta_units;}
 }
 for(const lot of lots.results){if(lot.source_kind==='purchase')totals.purchased_units+=lot.issued_units;if(lot.source_kind==='carry_forward')totals.carry_units+=lot.issued_units;}
 const ledger=history.results.reduce((sum,row)=>sum+row.delta_units,0),held=history.results.reduce((sum,row)=>sum+row.delta_reserved,0),refundHeld=history.results.reduce((sum,row)=>sum+row.delta_refund_held,0);
 const consistent=ledger===pass.remaining_units&&held===pass.reserved_units&&refundHeld===pass.refund_held_units;
 return {status:'ready',pass,totals,lots:lots.results,payments:payments.results,policy:policy.results[0]||null,bookings:allocations.results,
  history:history.results.slice(-100).reverse(),history_truncated:history.results.length>100,ledger_consistent:consistent,as_of:at};
}
