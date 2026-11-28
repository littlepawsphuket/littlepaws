import assert from 'node:assert/strict';
import {booking} from '../test_customer_image_fixtures.mjs';
import {documentHtml} from '../document_layout.mjs';
const pass={pass_number:'LP-SP-TEST01',credit_units:60,settlement:{base_units:64,late_units:1,total_units:65,covered_units:60,cash_units:5,cash_cents:62500,rows:[{dog_id:1,name:'<script>Demo dog</script>',covered_units:60,cash_cents:62500}]}};
for(const lang of ['th','en'])for(const format of ['pdf','png'])for(const kind of ['booking','stay','deposit']){
 const payment={id:1,occurred_on:'2027-03-01',received_time:'14:01',payment_type:'deposit',amount_cents:10000};
 const doc={...booking,lang,format,kind,total_cents:62500,balance_cents:52500,due_cents:32500,refunds:[],payments:[payment],deposit:kind==='deposit'?payment:null,stay_pass:pass,
  pricing:{version:1,service:'overnight',base_days:16,rows:[]},consent:{customer_name:'Demo family',signed_at:'2027-03-01T14:00:00+07:00',signature:JSON.stringify([[[10,10],[70,70]]])}};
 const html=documentHtml(doc);assert.ok(html.includes('LP-SP-TEST01'));assert.ok(html.includes('625.00'));assert.ok(html.includes('&lt;script&gt;Demo dog&lt;/script&gt;'));assert.ok(!html.includes('<script>Demo dog'));
 assert.ok(!html.includes('NaN'));assert.ok(!html.includes('undefined'));assert.ok(!html.includes('class="boarding-price-breakdown"'));
 assert.ok(html.includes(lang==='en'?'Credits used':'ใช้โควตา'));assert.ok(html.includes(lang==='en'?'Late pickup allowance':'โควตารับกลับล่าช้า'));
 if(kind==='stay')assert.ok(html.includes('<svg'));
}
console.log('Pass documents passed: TH/EN PDF and image markup, booking/stay/deposit separation of credits and cash, late-credit details, signature and escaping.');

for(const lang of ['th','en'])for(const format of ['pdf','png']){
 const passData={...pass,checkout_reconciliation:{original_agreement:{checkout_at:'2027-03-17T09:00:00Z',quantity100:1600},actual_checkout_at:'2027-03-03T06:00:00Z',restored_units:52,extra_covered_units:0,refund_review_cents:30000}};
 const html=documentHtml({...booking,lang,format,kind:'stay',pricing:{version:1,service:'overnight',rows:[],stay_pass:passData},total_cents:0,due_cents:0,payments:[],refunds:[]});assert.ok(html.includes('stay-pass-checkout-summary'));assert.ok(html.includes(lang==='en'?'Credits restored':'คืนโควตา'));assert.ok(html.includes('300.00'));assert.ok(html.includes(lang==='en'?'does not confirm a refund':'ไม่ใช่หลักฐานว่าได้คืนเงินแล้ว'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('undefined'));
}
console.log('Checkout customer documents passed: TH/EN PDF and image show original/actual pickup, restored and additional credits, and explicit overpayment review without claiming a paid refund.');

for(const lang of ['th','en'])for(const format of ['pdf','png']){const html=documentHtml({...booking,lang,format,kind:'stay',pricing:{version:1,service:'overnight',rows:[],stay_pass:{...pass,cancellation_cash_fees_cents:20000}},total_cents:82500,due_cents:52500,payments:[],refunds:[]});assert(html.includes(lang==='en'?'Cancellation fees carried from the booking':'ค่าบริการยกเลิกที่รวมมาจากการจอง'));assert(html.includes('200.00'));assert(html.includes('825.00'));assert(!html.includes('NaN'));}
console.log('Carried cancellation fee documents passed: separate fixed fee visible in TH/EN PDF and PNG alongside the combined bill.');
