// Compare the full billing inputs at commit time, including deposits that do not bump booking revision.
export const passBookingState=`SELECT json_object(
 'customer',a.customer_id,'checkin',a.checkin,'checkout',a.checkout,'quantity',a.charged_nights,
 'total',ROUND(a.agreed_total*100),'service',a.service_type,'discount',a.discount_cents,
 'dogs',json((SELECT json_group_array(json_array(dog_id,nightly_rate_cents)) FROM
   (SELECT dog_id,nightly_rate_cents FROM appointment_dogs WHERE appointment_id=a.id ORDER BY dog_id))),
 'timing',(SELECT details FROM boarding_charges WHERE appointment_id=a.id),
 'payments',json((SELECT json_group_array(json_array(id,kind,amount,payment_type)) FROM
   (SELECT id,kind,amount,payment_type FROM transactions WHERE deposit_appointment_id=a.id AND payment_type!='' ORDER BY id)))
 ) AS state FROM appointments a WHERE a.id=?`;
