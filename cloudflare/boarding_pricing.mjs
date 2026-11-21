// Pure calculation shared by Worker and browser. All times are local Bangkok time.
export function overnightPricing(form) {
  if(form.pricingVersion !== 1)return undefined;
  const {checkin,checkout,checkinTime,checkoutTime,quantity100,service,dogs}=form;
  const day=/^\d{4}-\d{2}-\d{2}$/;const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!day.test(checkin||'') || !day.test(checkout||'') || !time.test(checkinTime||'') || !time.test(checkoutTime||'') ||
    !Number.isSafeInteger(quantity100) || quantity100<0 || !Array.isArray(dogs))return null;
  const start=Date.parse(checkin+'T'+checkinTime+':00+07:00'),end=Date.parse(checkout+'T'+checkoutTime+':00+07:00');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  const elapsed=Math.round((end-start)/60000),extra=service==='overnight' ? Math.max(0,elapsed-quantity100/100*1440) : 0;
  const percent=extra<=120 ? 0 : extra<=360 ? 25 : extra<=720 ? 50 : 100;
  const rows=dogs.map(dog=>({dog_id:dog.id,rate_cents:dog.rate,
    base_cents:Math.floor(((dog.rate??0)*quantity100+50)/100),
    // Drop satang on each dog's late fee; never round it upward.
    fee_cents:Math.floor((dog.rate??0)*percent/10000)*100}));
  return {version:1,service,checkin,checkout,checkin_time:checkinTime,checkout_time:checkoutTime,base_days:quantity100/100,
    elapsed_minutes:elapsed,extra_minutes:extra,percent,fee_cents:rows.reduce((n,row)=>n+row.fee_cents,0),
    base_cents:rows.reduce((n,row)=>n+row.base_cents,0),rows};
}

export async function savedBoardingPrice(db,kind,id) {
  try {
    const row=await db.prepare(`SELECT details FROM boarding_charges WHERE ${kind==='stay'?'stay_id':'appointment_id'}=?`).bind(id).first();
    if(!row)return null;
    const data=JSON.parse(row.details);return data?.version===1 ? data : null;
  }catch(error){
    // Older local databases and migration fixtures remain readable, without inventing charges.
    if(/no such table.*boarding_charges/i.test(String(error)))return null;
    throw error;
  }
}
export function saveBookingPrice(db,revision,price) {
  return db.prepare(`INSERT INTO boarding_charges(appointment_id,details)
    SELECT id,? FROM appointments WHERE cloud_revision=?
    ON CONFLICT(appointment_id) DO UPDATE SET details=excluded.details`).bind(JSON.stringify(price),revision);
}
export function saveStayPrice(db,marker,price) {
  return db.prepare(`INSERT INTO boarding_charges(stay_id,details)
    SELECT id,? FROM stays WHERE create_key=?
    ON CONFLICT(stay_id) DO UPDATE SET details=excluded.details`).bind(JSON.stringify(price),marker);
}

// New timing fields never reprice a booking/stay that predates this policy.
export function freezeLegacyPrice(data,source) {
  if(!data?.pricing)return data;
  const total=Number(source.total),discount=Number(source.discount_cents)||0,rounding=Number(source.rounding_cents)||0;
  data.subtotal=total+discount+rounding;data.netCents=total;
  data.fields[4]=total/100;data.fields[6]=discount;data.fields[7]=rounding;
  data.pricing={...data.pricing,grandfathered:true,percent:0,fee_cents:0,base_cents:data.subtotal,
    rows:data.pricing.rows.map(row=>({...row,fee_cents:0}))};
  return data;
}
