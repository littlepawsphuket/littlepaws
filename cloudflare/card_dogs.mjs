// Metadata only; images remain behind the existing staff photo authorization.
const fields = `json_object('id',d.id,'name',d.name,'customer_id',d.customer_id,
  'has_photo',CASE WHEN d.archived=0 AND EXISTS(SELECT 1 FROM dog_photos p WHERE p.dog_id=d.id) THEN 1 ELSE 0 END)`;
export const stayCardDogs = `(SELECT json_group_array(${fields}) FROM stay_dogs sd
  JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=s.id)`;
export const bookingCardDogs = `(SELECT json_group_array(${fields}) FROM appointment_dogs ad
  JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id)`;
export const customerCardDogs = `(SELECT json_group_array(${fields}) FROM dogs d
  WHERE d.customer_id=c.id AND d.archived=0)`;
