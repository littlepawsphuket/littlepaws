// Immutable cancellation amendments supply the remaining dogs without overwriting the purchased/held agreement.
export async function bookingAmendment(db,bookingId){
 try{return await db.prepare('SELECT remaining_snapshot,next_revision,remaining_dogs,sequence FROM stay_pass_booking_cancellations WHERE booking_id=? ORDER BY sequence DESC LIMIT 1').bind(bookingId).first();}
 catch(error){if(/no such table.*stay_pass_booking_cancellations/i.test(String(error)))return null;throw error;}
}

// Latest immutable planned extension supersedes the cancellation-adjusted agreement for an active stay.
export async function stayAgreement(db,stayId,bookingId,initialSnapshot){
 try{const row=await db.prepare('SELECT after_snapshot FROM stay_pass_stay_extensions WHERE stay_id=? ORDER BY sequence DESC LIMIT 1').bind(stayId).first();if(row)return JSON.parse(row.after_snapshot);}
 catch(error){if(!/no such table.*stay_pass_stay_extensions/i.test(String(error)))throw error;}
 const amendment=await bookingAmendment(db,bookingId);return JSON.parse(amendment?.remaining_snapshot||initialSnapshot);
}
