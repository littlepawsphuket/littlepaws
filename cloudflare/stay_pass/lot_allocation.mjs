import {fail} from './rules.mjs';
// Owner-approved ordering: carried credits first, then purchased credits.
// Expired lots and lots ending before checkout never provide booking coverage.
export function allocatableLots(lots,nowAt,checkoutAt){
 return lots.filter(l=>l.expires_at>nowAt&&(!checkoutAt||l.expires_at>checkoutAt))
  .map(l=>({...l,available_units:l.remaining_units-l.reserved_units-l.refund_held_units}))
  .filter(l=>l.available_units>0)
  .sort((a,b)=>(a.source_kind==='carry_forward'?0:1)-(b.source_kind==='carry_forward'?0:1)||a.expires_at.localeCompare(b.expires_at)||a.id.localeCompare(b.id));
}
export function allocateBookingLots(lots,rows,bookingId){
 if(lots.some(l=>!['purchase','carry_forward'].includes(l.source_kind)||!Number.isSafeInteger(l.available_units)||l.available_units<0))fail('lot_source_review_required');
 const dogs=rows.filter(d=>d.covered_units>0).map(d=>({dog_id:d.dog_id,left:d.covered_units}));
 if(dogs.some(d=>!Number.isSafeInteger(d.left)||d.left<1))fail('invalid_credit_allocation');
 let cursor=0;const lines=[];
 for(const lot of lots){let left=lot.available_units;const dogUnits=[];
  while(left&&cursor<dogs.length){const dog=dogs[cursor],units=Math.min(left,dog.left);dogUnits.push({dog_id:dog.dog_id,units});left-=units;dog.left-=units;if(!dog.left)cursor++;}
  if(dogUnits.length)lines.push({lotId:lot.id,source_kind:lot.source_kind,units:dogUnits.reduce((n,d)=>n+d.units,0),bookingId,dogIds:dogUnits.map(d=>d.dog_id),dogUnits});
  if(cursor===dogs.length)break;
 }
 if(cursor!==dogs.length)fail('insufficient_credits');
 if(lines.length>30)fail('lot_source_review_required');
 return lines;
}
