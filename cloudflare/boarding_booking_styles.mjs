// Boarding and booking workspaces share the Mac theme and responsive form layout.
export const boardingBookingCss = `
.staff-app [hidden]{display:none!important}
.staff-app #stay-actions,.staff-app #booking-tabs{display:flex;width:fit-content;max-width:100%;padding:5px;gap:5px;border:1px solid var(--season-border,#c8ded4);border-radius:16px;background:var(--season-card,#edf6f1);margin:0 0 18px;box-sizing:border-box}
.staff-app :is(#stay-actions,#booking-tabs) button{margin:0;border-radius:12px;box-shadow:none;min-height:46px}
.staff-app :is(#stay-actions,#booking-tabs) button[aria-pressed=false]{background:transparent;border-color:transparent}
.staff-app #page-actions{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
.staff-app #booking-search{padding:16px;border:1px solid var(--season-border,#c8ded4);border-radius:16px;background:var(--season-card,#fff);margin:14px 0;align-items:end}
.staff-app #booking-search label{flex:1;min-width:180px}
.staff-app #booking-search input{box-sizing:border-box;width:100%}
.staff-app #calendar-toolbar{padding:18px;border-radius:18px;gap:10px;align-items:end;box-shadow:0 4px 18px #163d2610}
.staff-app #calendar-title{flex:1;min-width:170px;align-self:center;text-align:end;font-size:20px}
.staff-app .calendar-grid{gap:0;border:1px solid var(--season-border,#c8ded4);border-radius:18px;overflow:hidden;background:white;box-shadow:0 6px 22px #163d2610}
.staff-app .calendar-grid .calendar-day{border:0;border-right:1px solid var(--season-border,#c8ded4);border-bottom:1px solid var(--season-border,#c8ded4);border-radius:0;padding:9px;min-height:110px;background:var(--season-card,#fcfefd)}
.staff-app .calendar-grid .calendar-day[data-muted]{opacity:.62;background:var(--season-pattern,#f2f5f2)}
.staff-app .calendar-date{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:8px}
.staff-app .calendar-date strong{display:grid;place-items:center;width:30px;height:30px;border-radius:50%}
.staff-app .calendar-day[data-today] .calendar-date strong{background:var(--brand-teal,#155747);color:white}
.staff-app .calendar-day[data-today]{box-shadow:inset 0 3px var(--brand-teal,#155747)}
.staff-app .calendar-grid .calendar-booking{display:block;margin:5px 0;padding:7px 8px;border-radius:9px;background:white;color:var(--brand-teal,#155747);border:1px solid var(--season-border,#c8ded4);border-left:3px solid var(--brand-teal,#155747);line-height:1.4;font-size:12px;text-align:start;box-shadow:0 2px 6px #163d2610;min-height:36px}
.staff-app .calendar-grid .calendar-booking[data-state=checked_in]{background:var(--season-card,#eef6f0);border-left-color:#7a9186}
.staff-app #booking-detail.record-workspace{box-sizing:border-box;width:min(1000px,calc(100vw - 32px));max-width:none;max-height:92vh;padding:24px;overflow:auto}
.staff-app #booking-detail.record-workspace>h2{font-size:15px;color:#718077;margin-bottom:20px;padding-right:70px}
.staff-app #booking-detail.record-workspace>#close-booking{position:absolute;top:18px;right:20px;background:var(--season-card,#e1f0ed);color:var(--brand-teal,#155747)}
.staff-app .record-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:0 0 16px}
.staff-app .record-heading h3{margin:0 0 4px;font-size:21px;line-height:1.4}
.staff-app .record-heading p{margin:0;color:#697a70;overflow-wrap:anywhere}
.staff-app .record-heading>div{min-width:0}
.staff-app .record-badge{flex:none;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;background:var(--season-card,#edf5ef);color:var(--brand-teal,#155747);border:1px solid var(--season-border,#c8ded4)}
.staff-app .record-badge[data-state=pending]{background:#fff5df;color:#7b591e;border-color:#edddb8}
.staff-app .record-badge[data-state=completed]{background:#edf0f5;color:#546378;border-color:#dbe1e8}
.staff-app .record-badge[data-state=cancelled]{background:#fff0ed;color:#a23e35;border-color:#f0ccc6}
.staff-app .record-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
.staff-app .record-facts>div{padding:14px 16px;border-radius:12px;background:var(--season-card,#f6f7f0);min-width:0}
.staff-app .record-facts dt{font-size:13px;color:#697a70;margin-bottom:5px}
.staff-app .record-facts dd{margin:0;font-weight:700;overflow-wrap:anywhere}
.staff-app .record-amounts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0;padding:16px;border-radius:14px;background:var(--season-card,#eef8f2);border:1px solid var(--season-border,#c8ded4)}
.staff-app .record-amounts small{display:block;color:#697a70;margin-bottom:4px}
.staff-app .record-amounts strong{display:block;font-size:23px;font-variant-numeric:tabular-nums;color:var(--brand-teal,#155747);overflow-wrap:anywhere}
.staff-app .record-amounts>div+div{border-left:1px solid var(--season-border,#c8ded4);padding-left:16px}
.staff-app .record-dogs{list-style:none;padding:0;margin:10px 0 22px}
.staff-app .record-dogs li{display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--season-border,#c8ded4)}
.staff-app .record-dogs img{width:64px;height:64px;border-radius:14px;object-fit:cover;flex:none}
.staff-app .record-dogs li>div{flex:1;min-width:0}
.staff-app .record-dogs small{display:block;color:#697a70}
.staff-app .record-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0}
.staff-app .record-actions button{margin:0}
.staff-app #booking-content>.record-actions{margin-bottom:20px}
.staff-app .record-reference{font-size:13px;font-weight:700;letter-spacing:.08em;color:var(--brand-teal,#155747)}
.staff-app #stays>.reservation-card{padding:24px;margin:0 0 18px}
.staff-app .reservation-card .record-heading h3{font-size:19px}
.staff-app .reservation-card .record-amounts{margin:12px 0}
.staff-app .reservation-card .record-amounts strong{font-size:19px}
.staff-app .record-payment-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:20px;margin:20px 0;border:1px solid var(--season-border,#c8ded4);border-radius:14px;background:var(--season-card,#f8fbf9);align-items:end}
.staff-app .record-payment-form>h4,.staff-app .record-payment-form>p{grid-column:1/-1;margin:0}
.staff-app .record-payment-form label{min-width:0}
.staff-app .record-payment-form input{box-sizing:border-box;width:100%;min-width:0}
.staff-app .record-payment-form button{grid-column:1/-1;margin:0}
.staff-app .record-payment-history{margin:22px 0;padding:18px;border:1px solid var(--season-border,#c8ded4);border-radius:14px}
.staff-app .record-workspace .payment-entry{padding:12px 0;gap:12px}
.staff-app .record-workspace .document-tools{margin:20px 0;padding:18px;border-radius:14px}
.staff-app .document-tools .photo-actions{align-items:end;gap:10px}
.staff-app .document-tools .photo-actions a{display:inline-flex;align-items:center;min-height:44px;box-sizing:border-box;padding:10px 14px;border:1px solid var(--season-border,#c8ded4);border-radius:10px;text-decoration:none;background:var(--season-card,#edf6f1)}
.staff-app .record-qr{margin:18px 0;padding:16px;border:1px solid var(--season-border,#c8ded4);border-radius:14px}
.staff-app .record-qr summary{cursor:pointer;font-weight:700}
.staff-app .record-qr img{display:block;width:min(100%,300px);height:auto;margin:14px auto 0}
.staff-app #booking-content>.signature-canvas{max-width:620px;margin-bottom:20px}
.staff-app .record-workspace #booking-content>button{margin:8px 8px 0 0}

.staff-app #customer-detail{box-sizing:border-box;width:min(800px,calc(100vw - 24px));max-width:none;max-height:90vh;padding:22px}
.staff-app #customer-content>form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.staff-app #customer-content>form>label{min-width:0}
.staff-app #customer-content>form>label :is(input:not([type=checkbox]),textarea,select){width:100%;min-width:0;box-sizing:border-box}
.staff-app #customer-content>form>:is(p,h3,section,fieldset){grid-column:1/-1}
@media(max-width:600px){.staff-app #customer-content>form{grid-template-columns:minmax(0,1fr)}}
@media(max-width:480px){
.staff-app .app-header .header-controls{width:auto;max-width:100%;gap:6px;flex-shrink:0}
.staff-app .header-controls .language-switch{width:auto;flex:none;order:0;padding:4px;gap:2px}
.staff-app .header-controls .language-switch a{box-sizing:border-box;width:36px;min-width:36px;min-height:40px;padding:8px 5px;font-size:12px}
}
@media(max-width:700px){
.staff-app #booking-detail.record-workspace{width:calc(100vw - 16px);padding:18px;max-height:94vh}
.staff-app #calendar-title{order:-1;flex-basis:100%;text-align:start}
.staff-app #calendar-toolbar{padding:12px;gap:6px}
.staff-app #calendar-toolbar label{min-width:0;flex:1 1 120px}
.staff-app #calendar-toolbar input,.staff-app #calendar-toolbar select{min-width:0;width:100%;box-sizing:border-box}
.staff-app .calendar-grid .calendar-day{padding:3px;min-height:88px}
.staff-app .calendar-grid .calendar-booking{font-size:10px;padding:4px 3px;min-height:32px;border-left-width:2px}
.staff-app .calendar-date{display:grid;justify-content:center;text-align:center}
.staff-app .calendar-date strong{width:26px;height:26px}
.staff-app .record-heading{gap:8px}
.staff-app .record-heading h3{font-size:19px}
.staff-app .record-badge{font-size:11px;padding:5px 8px}
.staff-app .record-facts{gap:8px}.staff-app .record-facts>div{padding:12px}
.staff-app .record-amounts{gap:6px;padding:12px}.staff-app .record-amounts strong{font-size:18px}
.staff-app .record-amounts>div+div{padding-left:8px}.staff-app .record-amounts small{font-size:11px}
.staff-app .record-payment-form{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px}
.staff-app .record-payment-form>label:first-of-type{grid-column:1/-1}
.staff-app .record-dogs li{flex-wrap:wrap}.staff-app .record-dogs button{margin-left:78px}
.staff-app #stays>.reservation-card{padding:18px}
}
`;

export const compactBoardingCss = `
.staff-app #stays>.reservation-card{padding:18px;margin-bottom:14px}
.staff-app .reservation-identity{display:flex;align-items:flex-start;gap:14px}
.staff-app .reservation-identity>.record-heading{flex:1;min-width:0;margin:0;align-items:flex-start}
.staff-app .reservation-identity .record-dog-photos{margin:0;display:flex;flex-wrap:wrap;gap:8px;max-width:45%}
.staff-app .reservation-identity .record-dog-photos figure{margin:0;display:grid;gap:3px;text-align:center;max-width:90px}
.staff-app .reservation-identity .record-dog-photos img{width:64px;height:64px;border-radius:14px;object-fit:cover}
.staff-app .reservation-identity figcaption{font-size:13px;line-height:1.3;overflow-wrap:anywhere}
.staff-app .reservation-card .record-heading h3{margin:0 0 3px}
.staff-app .reservation-card .record-reference{display:block;margin:3px 0;font-size:12px}
.staff-app .reservation-card .reservation-period{margin:10px 0;font-size:14px}
.staff-app .reservation-card .record-amounts{padding:10px 12px;margin:10px 0;gap:8px}
.staff-app .reservation-card .record-actions{margin-top:10px;gap:8px}
.staff-app .reservation-card .record-actions button{font-size:14px;padding:8px 12px}
.staff-app .boarding-list .current-dog-heading{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:8px!important}
.staff-app .current-dog-identity{width:100%;min-width:0}
.staff-app .current-dog-identity>div{flex:1;min-width:0}
.staff-app .current-dog-identity small{overflow-wrap:anywhere}
.staff-app .current-dog-pickup{display:flex!important;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:end;margin:0!important}
.staff-app .current-dog-pickup small{font-size:12px;min-width:0}
.staff-app .current-dog-pickup strong{flex:none;white-space:nowrap}
.staff-app .booking-forecast{margin:0 0 16px;padding:16px}
.staff-app .booking-forecast h2{font-size:19px;margin:0 0 4px}
.staff-app .booking-forecast p{margin:4px 0 8px;font-size:14px}
.staff-app .booking-forecast .record-amounts{margin:10px 0;padding:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.staff-app .booking-forecast .record-amounts>div:first-child{grid-column:1/-1;border-bottom:1px solid var(--season-border,#c8ded4);padding-bottom:8px}
.staff-app .booking-forecast .record-amounts>div:first-child strong{font-size:28px}
.staff-app .booking-forecast .record-amounts>div:nth-child(2){border-left:0;padding-left:0}
.staff-app .booking-forecast .record-amounts strong{white-space:nowrap;overflow-wrap:normal;font-size:20px}
.staff-app .booking-forecast>small{display:block;font-size:12px;color:#607368}
.staff-app .care-note-templates{border:1px solid var(--season-border,#c8ded4);border-radius:14px;padding:12px;width:100%;box-sizing:border-box;background:var(--season-card,#f7faf8)}
.staff-app .care-note-templates summary{font-weight:700;cursor:pointer;min-height:36px}
.staff-app .care-note-templates input{width:100%;box-sizing:border-box;margin:10px 0}
.staff-app .care-template-choices{display:grid;gap:8px;max-height:280px;overflow:auto}
.staff-app .care-template-choice{text-align:start;white-space:normal;font-size:15px;line-height:1.6;padding:12px;margin:0!important}
.staff-app .template-settings-list{display:grid;gap:12px;flex-basis:100%;width:100%}
.staff-app .template-settings-row{display:flex;gap:8px;align-items:start;width:100%}
.staff-app .template-settings-row textarea{flex:1;min-width:0;box-sizing:border-box;width:100%}
.staff-app .template-settings-row button{flex:none}
@media(max-width:480px){
.staff-app .reservation-identity{gap:10px}.staff-app .reservation-identity .record-dog-photos{max-width:40%}
.staff-app .reservation-identity .record-dog-photos img{width:56px;height:56px}
.staff-app .reservation-identity .record-heading h3{font-size:17px}
.staff-app .reservation-identity .record-heading{gap:5px;flex-wrap:wrap}
.staff-app .reservation-card .record-amounts strong,.staff-app .booking-forecast .record-amounts strong{font-size:17px}
.staff-app .current-dog-pickup{flex-wrap:nowrap!important}
}
`;
