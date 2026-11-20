// Match the Mac care forms and timeline using the same theme variables and spacing.
export const careParityCss = `
.staff-app #booking-detail.care-workspace,.staff-app #booking-detail.checkin-workspace{box-sizing:border-box;width:min(1160px,calc(100vw - 32px));max-width:none;max-height:92vh;padding:24px;overflow:auto}
.staff-app #booking-detail.care-workspace>h2{display:none}
.staff-app #booking-detail.care-workspace>#close-booking{float:right;background:var(--season-card,#e1f0ed);color:var(--brand-teal);margin-left:12px}
.staff-app .care-timeline{clear:both;margin-top:18px}
.staff-app .care-timeline .heading{margin-bottom:14px}
.staff-app .care-timeline .care-event{position:relative;margin:0 0 12px 18px;padding:14px;background:var(--season-card,#f5faf7);border:1px solid var(--season-border,#bdd8cd);border-radius:12px;box-shadow:none}
.staff-app .care-timeline .care-event::before{content:"";position:absolute;left:-24px;top:22px;width:10px;height:10px;border-radius:50%;background:var(--brand-teal)}
.staff-app .care-timeline section:has(>.care-event){border-left:2px solid var(--season-border,#bdd8cd);margin-left:7px}
.staff-app .care-event-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.staff-app .care-event-copy{min-width:0;flex:1}
.staff-app .care-event-copy>small{display:block;margin-top:4px}
.staff-app .care-event-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.staff-app .care-event-note{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}
.staff-app .care-event-actions{display:flex;gap:8px;flex:none}
.staff-app .care-event-actions button{width:44px;height:44px;min-width:44px;margin:0;padding:10px;display:grid;place-items:center}
.staff-app .care-event-clock{background:var(--season-card,#e1f0ed);color:var(--brand-teal);padding:5px 10px;border-radius:999px;font-weight:700;font-variant-numeric:tabular-nums}
.staff-app .care-date-controls{display:flex;align-items:center;gap:8px;min-width:0;margin-bottom:18px}
.staff-app .care-date-strip{display:flex;gap:8px;min-width:0;overflow-x:auto;padding:6px 3px;scroll-snap-type:x proximity}
.staff-app .care-date-strip button{flex:none;white-space:nowrap;scroll-snap-align:start}
.staff-app .care-date-controls>input{flex:0 0 150px;min-width:0;width:150px}
.staff-app .care-sharing{clear:both;margin-top:20px}
.staff-app .care-sharing>.intake-details{margin-top:22px;padding:16px}
.staff-app .care-dialog.care-activity-dialog{box-sizing:border-box;width:min(480px,calc(100vw - 24px));max-width:none;max-height:90vh;padding:22px;border-radius:18px;background:var(--season-card,#fffaf4)}
.staff-app .care-activity-dialog .form{display:flex;flex-direction:column;align-items:stretch;gap:16px}
.staff-app .care-activity-dialog .formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.staff-app .care-activity-dialog :is(input,select,textarea){box-sizing:border-box;min-width:0;width:100%}
.staff-app .care-activity-dialog .care-share-opt-in{display:flex;flex-direction:row;gap:10px;align-items:center}
.staff-app .care-share-opt-in input[type=checkbox]{width:22px;min-width:22px;height:22px}
.staff-app .care-activity-dialog .actions{justify-content:flex-end;margin:0;display:flex;gap:10px}
.staff-app .care-activity-dialog fieldset{box-sizing:border-box;min-width:0;width:100%;padding:14px;border-radius:12px;border:1px solid var(--season-border,#d6e3db);display:grid;gap:12px}
.staff-app .care-activity-dialog .care-timeline-photo{width:100%;max-height:180px;object-fit:contain}
.staff-app .care-activity-dialog input[type=file]{font-size:13px}
.staff-app .checkin-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:18px}
.staff-app .checkin-form>label{min-width:0}
.staff-app .checkin-form .checkin-wide{grid-column:1/-1}
.staff-app #booking-detail.checkin-workspace>h2{display:none}
.staff-app #booking-detail.checkin-workspace>#close-booking{float:right;background:var(--season-card,#e1f0ed);color:var(--brand-teal);margin-left:12px}
.staff-app .checkin-owner-facts{flex-basis:100%;margin:0;font-size:14px;color:#718077}
.staff-app .checkin-form>label input{box-sizing:border-box;width:100%;min-width:0}
.staff-app .checkin-form>:is(section,details,fieldset,ul,p,.actions){grid-column:1/-1;min-width:0}
.staff-app .checkin-form .checkin-acknowledgement{grid-column:1/-1;display:flex;flex-direction:row;align-items:center;gap:12px}
.staff-app .checkin-form .checkin-acknowledgement input{width:22px;flex:none}
.staff-app .checkin-bill-summary{padding:18px;border:1px solid var(--season-border,#c8ded4);border-radius:14px;background:var(--season-card,#f2faf6);font-weight:700;margin:18px 0}
.staff-app .checkin-form .intake-details{padding:18px;border-radius:14px}
.staff-app .checkin-form-actions{justify-content:flex-end;padding-top:10px;border-top:1px solid var(--season-border,#dce7de)}
.staff-app .service-segments{grid-column:1/-1;display:flex;gap:6px;padding:6px;border:1px solid var(--season-border,#c8ded4);background:var(--season-card,#f2faf6);border-radius:14px}
.staff-app .service-segments button{flex:1;min-width:0;box-shadow:none}
.staff-app .today-care-feed{margin-top:14px;border-top:1px solid var(--season-border,#dce7de)}
.staff-app .today-care-feed .care-event{margin:0;padding:14px 0;border:0;border-bottom:1px solid var(--season-border,#dce7de);border-radius:0;box-shadow:none;background:transparent}

.staff-app .checkin-owner-section{position:relative;display:flex;align-items:end;flex-wrap:wrap;gap:10px;padding:16px;border:1px solid var(--season-border,#dce7de);border-radius:14px}
.staff-app .checkin-owner-section>label{flex:1;min-width:220px}
.staff-app .checkin-customer-options{position:absolute;top:100%;left:16px;right:16px;max-height:260px;overflow:auto;z-index:20;padding:8px;background:white;border:1px solid var(--season-border,#c8ded4);box-shadow:0 10px 30px #203c3026;border-radius:12px}
.staff-app .checkin-customer-options button{display:block;text-align:left;width:100%;margin:3px 0}
.staff-app .checkin-dog-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px;border:1px solid var(--season-border,#dce7de);border-radius:14px;padding:16px;grid-column:1/-1}
.staff-app .checkin-dog-choice{padding:16px;border:1px solid var(--season-border,#dce7de);border-radius:14px;display:grid;gap:10px;background:white}
.staff-app .checkin-dog-choice .care-share-opt-in{display:flex;flex-direction:row;align-items:center;gap:10px}
.staff-app .checkin-dog-choice>p{font-size:13px;color:#718077;margin:0}
.staff-app .checkin-dog-choice input{box-sizing:border-box;min-width:0;width:100%}
.staff-app .care-file-action{width:100%;min-height:48px}

.staff-app .checkin-timing-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.staff-app .checkin-payment-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:16px;border:1px solid var(--season-border,#dce7de);border-radius:14px}
.staff-app .checkin-identity-summary{border:1px solid var(--season-border,#dce7de);border-radius:14px;padding:16px}
.staff-app .checkin-dog-summary{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
.staff-app .checkin-dog-summary-row{display:flex;align-items:center;gap:12px;padding:10px;background:white;border-radius:12px;border:1px solid var(--season-border,#dce7de)}
.staff-app .checkin-dog-summary-row img{width:64px;height:64px}
.staff-app .checkin-timing-grid :is(label,input),.staff-app .checkin-payment-grid :is(label,input){min-width:0;width:100%;box-sizing:border-box}
.staff-app .intake-choice label:has(input:checked){background:var(--brand-teal);border-color:var(--brand-teal);color:white}
@media(max-width:800px){.staff-app .checkin-timing-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
.staff-app .checkin-timing-grid,.staff-app .checkin-payment-grid{grid-template-columns:minmax(0,1fr)}
.staff-app #booking-detail.care-workspace,.staff-app #booking-detail.checkin-workspace{width:calc(100vw - 16px);max-height:94vh;padding:14px}
.staff-app .care-timeline{padding:14px}
.staff-app .care-date-controls{flex-wrap:wrap}.staff-app .care-date-strip{width:100%}
.staff-app .care-date-controls>input{flex-basis:100%;width:100%}
.staff-app .care-event-heading{gap:6px}.staff-app .care-event-actions{gap:4px}
.staff-app .checkin-form{grid-template-columns:minmax(0,1fr)}
.staff-app .care-activity-dialog .formgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
.staff-app .service-segments{flex-wrap:wrap}.staff-app .service-segments button{padding:10px 6px;font-size:14px}
}
`;

export const checkinTouchCss=`
.staff-app .checkin-form :is(button,select,input:not([type=checkbox]):not([type=radio])){min-height:48px;font-size:16px}
.staff-app .touch-answer-options,.staff-app .terms-language-switch{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}
.staff-app .touch-answer-options button,.staff-app .terms-language-switch button{margin:0;min-height:48px;padding:10px 16px;border-radius:14px;touch-action:manipulation;box-shadow:none}
.staff-app .terms-language-switch{width:fit-content;padding:5px;border:1px solid var(--season-border,#c8ded4);border-radius:18px;background:var(--season-card,#f6faf6)}
.staff-app .checkin-form .intake-choice{display:flex;gap:7px;flex-wrap:wrap}
.staff-app .checkin-form .intake-choice label,.staff-app .checkin-form .intake-grid label:has(input[type=checkbox]){box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:48px;padding:10px 12px;border:1px solid var(--season-border,#c8ded4);border-radius:14px;cursor:pointer;touch-action:manipulation}
.staff-app .checkin-form :is(input[type=radio],input[type=checkbox]){flex:none;width:22px!important;height:22px;min-height:22px}
.staff-app .checkin-form .intake-choice label:has(input:checked),.staff-app .checkin-form .intake-grid label:has(input:checked){background:var(--brand-teal,#155747);color:white}
.staff-app .checkin-dog-choice:has(input[type=checkbox]:checked){border:2px solid var(--brand-teal,#155747);background:var(--season-card,#f4f9f5)}
.staff-app .checkin-live-bill,.staff-app .checkin-signing-bill{padding:18px;border-radius:18px;border:1px solid var(--season-border,#c8ded4);background:var(--season-card,#f3f9f5)}
.staff-app .checkin-live-bill h4,.staff-app .checkin-signing-bill h4{margin:0 0 12px;font-size:19px}
.staff-app .checkin-live-bill>p{margin:6px 0;font-size:14px}.staff-app .checkin-live-bill .record-amounts{margin-bottom:0}
.staff-app .checkin-signing-bill .record-amounts{grid-template-columns:repeat(2,minmax(0,1fr));margin:0;background:white;gap:10px}
.staff-app .checkin-signing-bill .record-amounts>div{border:0;padding:0;min-width:0}
.staff-app .checkin-signing-bill .record-amounts>div:last-child{grid-column:1/-1;border-top:1px solid var(--season-border,#c8ded4);padding-top:12px}
.staff-app .checkin-signing-bill .record-amounts>div:last-child strong{font-size:28px}
.staff-app .checkin-payment-grid>h4,.staff-app .checkin-payment-grid>p{grid-column:1/-1;margin:0}
.staff-app .checkin-payment-grid>label:first-of-type{padding:12px;border-radius:12px;background:var(--season-card,#f2f8f4);border:1px solid var(--season-border,#c8ded4)}
.staff-app .checkin-coupon-panel{display:block!important;min-width:0}
.staff-app .checkin-coupon-panel>label{display:block}
.staff-app .checkin-coupon-row{display:flex;flex-wrap:nowrap;gap:8px;align-items:center;margin-top:7px;max-width:480px}
.staff-app .checkin-coupon-row input{width:9ch!important;min-width:0!important;flex:1 1 9ch;letter-spacing:.18em;font-variant-numeric:tabular-nums}
.staff-app .checkin-coupon-row button{flex:0 0 auto;margin:0!important;white-space:nowrap;padding:10px 16px}
@media(pointer:coarse){.staff-app .checkin-form .care-share-opt-in{min-height:52px;padding:12px}.staff-app .checkin-signature{scroll-margin-top:16px}}
`;
