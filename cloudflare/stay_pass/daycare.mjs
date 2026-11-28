import {fail,stamp} from './rules.mjs';
// Confirmed by the owner: up to and including 12 hours = half a day;
// more than 12 hours = one day. Longer visits require an overnight review.
// Crossing midnight alone does not change the actual elapsed duration.
export function daycareTiming(checkinAt,checkoutAt){
 const start=stamp(checkinAt),end=stamp(checkoutAt),elapsed=Date.parse(end)-Date.parse(start);
 if(elapsed<0)fail('invalid_pass_booking');if(elapsed>24*3600000)fail('daycare_overnight_review_required');
 const units=elapsed<=12*3600000?2:4;
 return {rule_version:'daycare-12h-20261128',checkin_at:start,checkout_at:end,elapsed_minutes:elapsed/60000,units_per_dog:units,daycare_hours:12,full_day:units===4};
}
