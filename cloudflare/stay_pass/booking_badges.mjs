// Called only after the normal staff booking authorization. No financial details are exposed.
export async function addPassBadges(db,bookings){
 if(!bookings.length)return bookings;
 let rows;try{rows=(await db.prepare('SELECT l.booking_id,p.pass_number FROM stay_pass_booking_links l JOIN stay_passes p ON p.id=l.pass_id WHERE l.booking_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(bookings.map(b=>b.id))).all()).results;}
 catch(error){if(/no such table.*stay_pass/i.test(String(error)))return bookings;throw error;}
 for(const booking of bookings){const row=rows.find(r=>r.booking_id===booking.id);if(row)booking.stay_pass_badge=row.pass_number;}return bookings;
}
