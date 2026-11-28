import {fail} from './rules.mjs';
export async function partialCashEnabled(db){return Boolean(await db.prepare('SELECT 1 FROM stay_pass_schema_versions WHERE version=15').first());}
export async function bookingCashRefunds(db,bookingId){
 let rows;try{rows=(await db.prepare(`SELECT r.id,r.direction,r.amount_cents,r.transaction_id,t.kind,t.stay_id,t.occurred_on,t.received_time FROM stay_pass_booking_cash_records r JOIN stay_pass_operations o ON o.id=r.id JOIN transactions t ON t.id=r.transaction_id WHERE r.booking_id=? AND o.result IS NOT NULL ORDER BY r.created_at,r.id`).bind(bookingId).all()).results;}
 catch(error){if(/no such table.*stay_pass_booking_cash_records/i.test(String(error)))return {refunded_cents:0,history:[]};throw error;}
 if(rows.some(r=>r.direction!=='refund'||r.kind!=='refund'||r.stay_id!==null||!Number.isSafeInteger(r.amount_cents)||r.amount_cents<1))fail('cash_source_review_required');
 return {refunded_cents:rows.reduce((n,r)=>n+r.amount_cents,0),history:rows.map(({kind,stay_id,...r})=>r)};
}
export async function stayCashRefunds(db,stayId){
 let row;try{row=await db.prepare('SELECT * FROM stay_pass_precheckin_cash WHERE stay_id=?').bind(stayId).first();}
 catch(error){if(/no such table.*stay_pass_precheckin_cash/i.test(String(error)))return 0;throw error;}
 if(!row)return 0;
 const snapshot=JSON.parse(row.snapshot),history=snapshot.history;
 if(!Array.isArray(history)||history.reduce((n,r)=>n+r.amount_cents,0)!==row.refunded_cents)fail('cash_source_review_required');
 const {results}=await db.prepare(`SELECT r.id,r.amount_cents,t.stay_id,t.kind,ROUND(t.amount*100) cents FROM stay_pass_booking_cash_records r JOIN transactions t ON t.id=r.transaction_id WHERE r.booking_id=?`).bind(row.booking_id).all();
 if(results.length!==history.length||results.some(r=>r.stay_id!==stayId||r.kind!=='refund'||r.cents!==r.amount_cents||!history.some(h=>h.id===r.id&&h.amount_cents===r.amount_cents)))fail('cash_source_review_required');
 return row.refunded_cents;
}
