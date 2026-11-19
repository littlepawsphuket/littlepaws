// Shared finish for directory, administration, finance and reporting workspaces.
export const workspaceCss = `
.staff-app .record-dog-photos{display:flex;flex-wrap:wrap;gap:14px;margin:16px 0;max-width:100%}
.staff-app .record-dog-photos:empty{display:none}
.staff-app .record-dog-photos figure{margin:0;width:84px;min-width:0;text-align:center}
.staff-app .record-dog-photos img{display:block;width:76px;height:76px;margin:0 auto 6px;border-radius:18px;object-fit:cover;border:1px solid var(--season-border,#c8ded4);background:var(--season-card,#f4faf6)}
.staff-app .record-dog-photos figcaption{font-size:13px;line-height:1.4;overflow-wrap:anywhere;color:var(--ink)}
.staff-app .customer-directory-card>.record-dog-photos{flex-basis:100%;flex-grow:0;margin:0}

.staff-app #stays[data-screen=customers]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.staff-app #stays>.customer-directory-card{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin:0;padding:24px;min-width:0}
.staff-app .customer-directory-card>div{flex:1;min-width:0}
.staff-app .customer-directory-card h2{font-size:20px;overflow-wrap:anywhere;margin:0}
.staff-app .customer-directory-card p{margin:5px 0 0;color:#687c71}
.staff-app .customer-directory-card>button{margin:0!important;flex-basis:100%}
.staff-app .customer-initial{width:56px;height:56px;display:grid;place-items:center;flex:none;font-size:25px;font-weight:700;color:var(--brand-teal);background:var(--season-card,#edf7f0);border:1px solid var(--season-border,#c8ded4);border-radius:18px}
.staff-app #customer-detail>h2,.staff-app #ledger-editor>h2{margin:0 65px 22px 0;font-size:20px}
.staff-app #customer-detail>#close-customer,.staff-app #ledger-editor>#ledger-close{position:absolute;top:18px;right:18px;margin:0;background:var(--season-card,#edf7f0);color:var(--brand-teal)}
.staff-app .customer-profile-heading h3{font-size:25px;margin:0}
.staff-app .customer-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:24px 0 12px}
.staff-app .customer-section-heading h3{margin:0}
.staff-app .customer-dog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.staff-app .customer-dog-grid>.customer-dog-card{margin:0;padding:18px;min-width:0}
.staff-app .customer-dog-card>.customer-dog-photo{width:92px;height:92px;object-fit:cover;border-radius:20px;margin-bottom:12px}
.staff-app .customer-dog-card h4{font-size:20px;margin:0 0 8px}
.staff-app .customer-dog-card p{font-size:14px;line-height:1.7;overflow-wrap:anywhere}
.staff-app .customer-dog-card .photo-actions{gap:8px;margin:14px 0 0}
.staff-app .customer-dog-card .photo-actions button{font-size:13px;padding:8px 12px;min-height:42px;background:var(--season-card,#edf7f0);color:var(--brand-teal)}
.staff-app .customer-dog-card .record-actions{padding-top:12px;border-top:1px solid var(--season-border,#c8ded4)}
.staff-app .customer-dog-card .record-actions button{font-size:13px;padding:8px 12px}
.staff-app .customer-history{margin-top:28px;padding-top:20px;border-top:1px solid var(--season-border,#c8ded4)}
.staff-app .customer-history>article{padding:16px;margin:12px 0;box-shadow:none}
.staff-app .customer-history h4{margin:0 0 8px}
.staff-app #customer-content>form>label:has(textarea){grid-column:1/-1}
.staff-app #customer-content>form>button[type=submit]{grid-column:1/-1}
.staff-app .settings-workspace{padding:24px!important}
.staff-app .settings-workspace>.settings-menu{display:flex;flex-wrap:wrap;gap:6px;padding:6px;border:1px solid var(--season-border,#c8ded4);background:var(--season-card,#edf7f0);border-radius:16px;margin-bottom:24px}
.staff-app .settings-workspace>.settings-menu button{flex:1;min-width:115px;margin:0;border-radius:12px;box-shadow:none}
.staff-app .settings-workspace>.settings-menu button[aria-pressed=false]{background:transparent}
.staff-app .settings-panel{padding:4px 0 24px;margin-bottom:18px;border-bottom:1px solid var(--season-border,#c8ded4)}
.staff-app .settings-panel>h2{font-size:23px;margin:0 0 14px}
.staff-app .settings-panel>p{color:#687c71;line-height:1.7;margin-bottom:18px}
.staff-app .settings-panel form{gap:16px;align-items:end}
.staff-app .settings-panel form>label{flex:1 1 220px;min-width:0}
.staff-app .settings-panel :is(input,select){width:100%;box-sizing:border-box;min-width:0}
.staff-app .settings-panel form>p{flex-basis:100%;margin:0;color:#687c71;font-size:14px}
.staff-app .settings-panel form>button[type=submit]{margin:0}
.staff-app .settings-rate-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:4px}
.staff-app .settings-rate{padding:20px;gap:12px;background:white;border-radius:16px;box-shadow:0 4px 14px #163d2608}
.staff-app .settings-rate h3{font-size:18px}
.staff-app .settings-rate>p{font-size:13px;color:#687c71}
.staff-app .settings-rate label{font-size:14px;gap:6px}
.staff-app .settings-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0 4px}
.staff-app .settings-tool{display:flex;align-items:center;gap:14px;min-height:86px;margin:0;padding:20px;text-align:start;text-decoration:none;border:1px solid var(--season-border,#c8ded4);border-radius:16px;background:var(--season-card,#f7fcf8);color:var(--brand-teal);box-shadow:0 3px 10px #163d2608;font-weight:700}
.staff-app .settings-tool svg{width:26px;height:26px;flex:none}
.staff-app .settings-tool:hover{box-shadow:0 7px 20px #163d2615;transform:translateY(-1px)}
.staff-app .settings-list-row{gap:14px;padding:16px 0;margin-top:8px}
.staff-app .settings-list-row .settings-menu{gap:8px;margin:0}
.staff-app .settings-list-row button{margin:0}
.staff-app .settings-workspace>button{margin:0 0 24px;background:var(--season-card,#edf7f0);color:var(--brand-teal)}
.staff-app .theme-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%}
.staff-app .theme-options button{border:2px solid transparent!important;display:grid;justify-items:start;gap:12px;background:white!important;color:var(--ink)!important;padding:12px;margin:0;box-shadow:0 3px 12px #163d260a}
.staff-app .theme-options button[aria-pressed=true]{border-color:var(--brand-teal)!important}
.staff-app .theme-options span{display:block;width:100%;height:60px;border-radius:10px;background:linear-gradient(135deg,#e5f4e9,#fff7e7)}
.staff-app .theme-options [data-theme=christmas] span{background:linear-gradient(135deg,#174f3c 50%,#c84a4a 50%)}
.staff-app .theme-options [data-theme=valentine] span{background:linear-gradient(135deg,#f7c5d7,#9a3a65)}
.staff-app .theme-options [data-theme=halloween] span{background:linear-gradient(135deg,#42254d,#e8a257)}
.staff-app .theme-options [data-theme=songkran] span{background:linear-gradient(135deg,#b3e3ed,#20a7bb)}
.staff-app .theme-options [data-theme=buddhist] span{background:linear-gradient(135deg,#fff2cf,#c5a359)}
.staff-app .theme-options [data-theme=japan] span{background:linear-gradient(135deg,#f6c8da,#a3c7e6)}
.staff-app #ledger-toolbar{border:1px solid var(--season-border,#c8ded4);border-radius:18px;padding:22px;background:white;margin:0 0 20px;box-shadow:0 4px 18px #163d260a}
.staff-app #ledger-toolbar h2{margin:0 0 16px;font-size:23px}
.staff-app #ledger-toolbar .workspace-menu{gap:10px;margin-bottom:20px}
.staff-app #ledger-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto auto;gap:12px;align-items:end}
.staff-app #ledger-filters label{min-width:0}
.staff-app #ledger-filters :is(input,select){min-width:0;box-sizing:border-box;width:100%}
.staff-app .ledger-sheet{border-radius:16px;box-shadow:0 4px 18px #163d260a}
.staff-app .ledger-sheet :is(th,td){padding:16px!important}
.staff-app .ledger-sheet td:nth-child(4){white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums;text-align:end}
.staff-app .ledger-sheet tr[data-kind=income] td:nth-child(2)>strong{color:#17624b;background:#e7f5eb;padding:4px 9px;border-radius:999px;font-size:12px}
.staff-app .ledger-sheet tr[data-kind=expense] td:nth-child(2)>strong{color:#8b5430;background:#fff1df;padding:4px 9px;border-radius:999px;font-size:12px}
.staff-app .ledger-sheet tr[data-kind=refund] td:nth-child(2)>strong{color:#8a425b;background:#faeaf0;padding:4px 9px;border-radius:999px;font-size:12px}
.staff-app #ledger-editor{box-sizing:border-box;width:min(960px,calc(100vw - 24px));max-width:none;max-height:92vh;padding:24px}
.staff-app .ledger-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.staff-app #ledger-content>form>button[type=submit]{width:100%;margin:4px 0}
.staff-app #ledger-content>form{gap:18px}
.staff-app :is(#coupon-dialog,#account-dialog){box-sizing:border-box;width:min(760px,calc(100vw - 24px));max-width:none;max-height:92vh;padding:24px}
.staff-app :is(#coupon-dialog,#account-dialog)>h2{font-size:20px;margin:0 65px 22px 0}
.staff-app :is(#coupon-close,#account-dialog>button:first-of-type){position:absolute;top:18px;right:18px;margin:0;background:var(--season-card,#edf7f0);color:var(--brand-teal)}
.staff-app #coupon-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 0 20px}
.staff-app .coupon-status-tabs{display:flex;flex-wrap:wrap;gap:5px;border:1px solid var(--season-border,#c8ded4);padding:5px;background:var(--season-card,#edf7f0);border-radius:14px}
.staff-app .coupon-status-tabs button{margin:0;box-shadow:none}
.staff-app #stays[data-screen=coupons]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.staff-app .coupon-list-card{margin:0;padding:22px;border-style:dashed;min-width:0}
.staff-app .coupon-list-card h2{font-size:24px;margin-bottom:14px;color:var(--brand-teal)}
.staff-app .coupon-list-card p{font-size:14px;line-height:1.7}
.staff-app .coupon-list-code{font-size:19px!important;letter-spacing:.14em;font-weight:700;background:var(--season-card,#edf7f0);padding:10px 12px;border-radius:10px}
.staff-app .coupon-list-card>button{margin-top:14px!important;width:100%}
.staff-app .coupon-form,.staff-app .account-workspace form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:end;margin:16px 0}
.staff-app .coupon-form label,.staff-app .account-workspace label{min-width:0}
.staff-app .coupon-form :is(input,select),.staff-app .account-workspace input:not([type=checkbox]){width:100%;box-sizing:border-box;min-width:0}
.staff-app .coupon-form>button,.staff-app .account-workspace form>button{grid-column:1/-1;margin:0}
.staff-app .account-workspace label:has(input[type=checkbox]){display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--season-border,#c8ded4);border-radius:12px;background:var(--season-card,#edf7f0)}
.staff-app .account-user-card{padding:20px;margin:14px 0}
.staff-app .account-user-card>button{margin:8px 10px 0 0}
.staff-app .account-workspace form+div.photo-actions{padding:16px;border:1px solid var(--season-border,#c8ded4);border-radius:14px;margin:20px 0}
.staff-app .backup-workspace{padding:28px!important;max-width:760px;margin:0 auto!important}
.staff-app .backup-workspace h2{font-size:25px;margin:0 0 16px}
.staff-app .backup-workspace>p{line-height:1.9;color:#687c71}
.staff-app .backup-workspace>button{display:block;margin:18px 0}
.staff-app .backup-workspace>a{display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--season-border,#c8ded4);text-decoration:none}
.staff-app .report-workspace-toolbar{padding:24px}
.staff-app .report-workspace-toolbar>button{margin:0 0 20px}
.staff-app .report-filters{display:block}
.staff-app .report-filters>.formgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.staff-app .report-filters label{min-width:0}
.staff-app .report-filters :is(input,select){width:100%;box-sizing:border-box;min-width:0}
.staff-app .report-filters .actions{gap:10px;display:flex;flex-wrap:wrap;margin:20px 0 0}
.staff-app .report-workspace-output{padding:24px}
.staff-app .report-workspace-output>h2{font-size:24px}
.staff-app .report-stat{min-width:0;box-shadow:0 4px 14px #163d2608}
.staff-app .report-stat strong{font-variant-numeric:tabular-nums}
.staff-app .report-workspace-output>.actions{display:flex;gap:10px;flex-wrap:wrap;padding:16px 0;border-top:1px solid var(--season-border,#c8ded4)}
@media(max-width:900px){.staff-app .settings-rate-grid{grid-template-columns:minmax(0,1fr)}.staff-app #ledger-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.staff-app #stays[data-screen=coupons]{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
.staff-app #stays[data-screen=customers],.staff-app .customer-dog-grid,.staff-app #stays[data-screen=coupons]{grid-template-columns:minmax(0,1fr)}
.staff-app .settings-tools,.staff-app .theme-options{grid-template-columns:repeat(2,minmax(0,1fr))}
.staff-app .settings-tool{min-height:78px;padding:14px;gap:10px;font-size:14px}
.staff-app .settings-workspace{padding:16px!important}
.staff-app .settings-workspace>.settings-menu{gap:4px;padding:4px}.staff-app .settings-workspace>.settings-menu button{font-size:13px;min-width:90px;padding:10px 8px}
.staff-app .settings-rate{padding:16px}.staff-app .settings-panel form>button[type=submit]{width:100%}
.staff-app #ledger-toolbar{padding:16px}.staff-app #ledger-filters>label:first-child{grid-column:1/-1}
.staff-app .ledger-fields,.staff-app .coupon-form,.staff-app .account-workspace form{grid-template-columns:minmax(0,1fr)}
.staff-app :is(#ledger-editor,#coupon-dialog,#account-dialog){padding:18px;width:calc(100vw - 16px)}
.staff-app .report-filters>.formgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
.staff-app .report-filters>.formgrid>label:first-child{grid-column:1/-1}
.staff-app .report-workspace-toolbar,.staff-app .report-workspace-output{padding:18px}
.staff-app .customer-profile-heading h3{font-size:23px}
.staff-app .backup-workspace{padding:20px!important}
}
`;
