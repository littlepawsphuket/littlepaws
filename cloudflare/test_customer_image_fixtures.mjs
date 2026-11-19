import {documentHtml} from './document_layout.mjs';
import {careDocumentHtml} from './care_exports.mjs';
export const booking={lang:'th',kind:'booking',format:'png',theme:'christmas',logo:null,mascot:null,font:null,
 booking_number:'DEMO01',customer:'ลูกค้าตัวอย่าง',contact:'081-000-0000 / example',checkin:'2026-11-25',checkout:'2026-11-29',charged_nights:4,
 service_type:'overnight',status:'pending',total_cents:240000,balance_cents:240000,discount_cents:0,payments:[],refunds:[],
 dogs:[{id:1,name:'Rosie',nightly_rate_cents:60000,image:null}],note:'',terms:{title:'เงื่อนไข',sections:[{heading:'การดูแล',items:['ข้อมูลตัวอย่าง']}]}};
export function documents(format,render=documentHtml){const docs={};for(const lang of ['th','en'])for(const kind of ['booking','stay','deposit']){
 const payment={id:1,payment_type:'deposit',occurred_on:'2026-11-20',received_time:'10:30',amount_cents:100000};
 const doc={...booking,lang,kind,format,...(kind==='booking'?{}:{payments:[payment],balance_cents:140000,due_cents:140000}),
 ...(kind==='stay'?{stay_number:'ABC123',status:'checked_in',consent:{customer_name:'Example customer',signed_at:'2026-11-25T10:00:00+07:00',signature:'[[[10,10],[100,50]]]'},intake:{}}:{}),...(kind==='deposit'?{deposit:payment}:{})};
 docs[kind+'-'+lang]=render(doc);
 }return docs;}
export function care(format,lang='th',render=careDocumentHtml){return render({format,lang,theme:'christmas',logo:null,font:null,mascot:null,profileImage:null,
 dog:{name:'Rosie',owner:'ลูกค้าตัวอย่าง',size:'small',profile:'{}',checkin:'2026-11-25',checkout:'2026-11-29'},day:'all',events:[{kind:'food',activity_label:'ทานอาหาร',recorded_at:'2026-11-26T09:00:00+07:00',note:'ทานอาหารได้ดี ร่าเริงและพักผ่อนสบายครับ',photos:[]}]});}
