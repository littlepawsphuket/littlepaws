import {themeName} from "./system_settings.mjs";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g,(letter) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[letter]);

export function shellIcon(name) {
  const paths = {
    user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>',
    settings:'<path d="m10 3-.6 2.3-1.8 1-2.3-.6-2 3.5L5 11v2l-1.7 1.8 2 3.5 2.3-.6 1.8 1L10 21h4l.6-2.3 1.8-1 2.3.6 2-3.5L19 13v-2l1.7-1.8-2-3.5-2.3.6-1.8-1L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  };
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
}

export function staffHeader(theme,isAdmin,displayName,language='th') {
  theme = themeName(theme);
  const particles = '<div class="season-motion" aria-hidden="true">'+Array.from({length:25},() => "<span></span>").join("")+"</div>";
  const nav = [["dashboard","ภาพรวม"],["current","ฝากเลี้ยง"],["history","ประวัติการเข้าพัก"],["calendar","การจอง"],["customers","ลูกค้า"]];
  if (isAdmin) nav.push(["settings","ตั้งค่าระบบ"]);
  return `<header class="app-header">
    <a class="brand" href="#dashboard" data-mode="dashboard" aria-label="Little Paws Homestay Phuket">
      <img src="/static/little-paws-logo.png" width="94" height="88" alt="">
      <span class="brand-title"><strong>Little Paws Homestay Phuket</strong><small>Management System</small></span>
    </a>
    <nav class="primary-nav" aria-label="เมนูหลัก">${nav.map(([id,label]) =>
      `<a href="#${id}" data-mode="${id}" ${id === "dashboard" ? 'aria-current="page"' : ""}${id === "settings" ? ' class="nav-settings-icon" aria-label="ตั้งค่าระบบ" title="ตั้งค่าระบบ"' : ""}>${id === "settings" ? shellIcon("settings") : label}</a>`).join("")}</nav>
    <div class="header-controls"><nav class="language-switch" aria-label="Language">
      <a href="/?lang=th" data-ui-language="th" aria-current="${language==='th'}" lang="th">TH</a>
      <a href="/?lang=en" data-ui-language="en" aria-current="${language==='en'}" lang="en">EN</a>
    </nav><button type="button" id="care-notification-bell" class="care-notification-bell" aria-label="ความคิดเห็นใหม่จากผู้ปกครอง" title="ความคิดเห็นใหม่จากผู้ปกครอง" aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg><span id="care-notification-count" hidden>0</span></button><details class="account-menu"><summary class="account-avatar" aria-label="เมนูบัญชี" title="เมนูบัญชี">${shellIcon("user")}</summary>
      <div class="account-menu-panel"><strong id="account-name">${escape(displayName)}</strong><p>เข้าสู่ระบบด้วย Cloudflare Access</p>
      <button type="button" id="open-account">แก้ไขข้อมูลผู้ใช้ / รหัสผ่าน</button>
      ${isAdmin ? '<button type="button" id="open-users">จัดการผู้ใช้งาน</button>' : ''}
      <a href="/cdn-cgi/access/logout">ออกจากระบบ</a></div>
    </details></div>
  </header>
  <section id="staff-banner" class="season-decoration season-with-heading" aria-label="หัวข้อหน้าจอ">
    <img id="staff-landscape" class="season-landscape" src="/static/theme-${theme === "classic" ? "japan" : theme}.webp" alt="" width="1440" height="480" ${theme === "classic" ? "hidden" : ""}>
    ${particles}<div class="screen-heading"><h1 id="screen-title">ภาพรวมธุรกิจ</h1><p id="screen-subtitle">รายรับ รายจ่าย และการเข้าพักของ Little Paws</p></div>
    <img id="staff-mascot" class="season-mascot" src="/static/${theme === "classic" ? "balen-gucci-relax" : "mascot-"+theme}.webp" alt="บาเลนและกุชชี่" width="640" height="320">
  </section>`;
}

export const staffFooter = `<footer class="site-footer"><div class="site-slogan">
  <strong lang="en">🐾 Little Paws, Big Love.</strong>
  <p lang="th">เพราะทุกอุ้งเท้าเล็ก ๆ สมควรได้รับความรักที่ยิ่งใหญ่ ❤️</p>
  </div><small>Little Paws Homestay Phuket · Cloudflare</small></footer>`;

export const macStyleBridge = `
  body.staff-app{color:#362b22;font-family:"Little Paws Sukhumvit","Sukhumvit Set",system-ui,sans-serif}
  .staff-app main{max-width:1220px;padding:0 18px;margin:22px auto 30px;min-height:65vh}
  .staff-app header.app-header{gap:14px;padding-block:4px}
  .staff-app .primary-nav{gap:3px;flex:none}
  .staff-app .primary-nav a{font-size:14px;white-space:nowrap}
  .staff-app #staff-banner{min-height:clamp(130px,15vw,220px)}
  .staff-app[data-theme=classic] #staff-banner{background:linear-gradient(110deg,#f1f6ef,#fff8ee,#ffede8);border-color:#eee1d1}
  .staff-app[data-theme=classic] #staff-banner .screen-heading{color:var(--brand-brown);text-shadow:none}
  .staff-app[data-theme=classic] #staff-banner .screen-heading p{color:#654e39}
  .staff-app .season-landscape{object-fit:cover;width:100%;height:100%}
  .staff-app .season-mascot{width:clamp(110px,24vw,290px)}
  .staff-app h2{margin:0 0 18px}
  .staff-app h3{margin:.4rem 0 .65rem}
  .staff-app button{box-shadow:0 3px 7px #264b3c18;min-height:42px}
  .staff-app :is(button,input,select,textarea){font-family:inherit}
  .staff-app .text-button{display:block;padding:0;min-height:0;box-shadow:none;border:0;text-align:start;background:transparent;color:var(--brand-teal)}
  .staff-app button.secondary,.staff-app button[aria-pressed=false]{background:#e1f0ed;color:var(--brand-teal);border:1px solid transparent}
  .staff-app button[aria-pressed=true]{background:var(--brand-teal);color:white}
  .staff-app button.delete-deposit{background:#fff1ef;color:#9f4236}
  .staff-app :is(input[type=checkbox],input[type=radio]){width:18px;height:18px;min-height:18px;accent-color:var(--brand-teal)}
  .staff-app .card{border-radius:22px;margin-bottom:20px;padding:24px}
  .staff-app #stays>article,.staff-app #calendar-toolbar,.staff-app #history-toolbar,.staff-app #booking-search,
  .staff-app #ledger-toolbar,.staff-app #coupon-toolbar{background:linear-gradient(155deg,var(--season-card,#fff),#fff 65%);border:1px solid var(--season-border,#eddfce);border-radius:18px;padding:20px;margin:0 0 20px}
  .staff-app .boarding-list article{margin:0;padding:13px;display:grid;align-content:start;box-shadow:0 4px 12px #27463813}
  .staff-app .current-boarding{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
  .staff-app .boarding-list .current-dog-identity .dog-avatar{margin:0;flex:none}
  .staff-app .boarding-list .boarding-duration{font-size:12px}
  .staff-app .boarding-checkout-actions button{padding:7px 10px;font-size:14px}
  .staff-app .dog-care button{margin-top:.65rem}
  .staff-app .boarding-list article>span,.staff-app .boarding-list article>small{display:block}
  .staff-app .dashboard-trend{display:flex;gap:12px;overflow-x:auto;min-height:225px;padding:10px 0}
  .staff-app .dashboard-month{flex:1;min-width:45px;text-align:center}
  .staff-app .dashboard-month small{font-size:11px;white-space:nowrap}
  .staff-app .dashboard-bars{height:180px;display:flex;gap:5px;align-items:end;justify-content:center;border-bottom:1px solid #dbe3dc}
  .staff-app .dashboard-bar{width:30%;max-width:40px;border-radius:6px 6px 0 0}
  .staff-app .category .track>div{min-width:0;border-radius:8px}
  .staff-app .dashboard-recent{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:.65rem;border-bottom:1px solid #edf1ed;padding:.65rem 0;align-items:center}
  .staff-app #finance-toolbar{padding:0;margin:0 0 20px;display:flex;flex-wrap:wrap;align-items:end;gap:12px}
  .staff-app #finance-toolbar[hidden]{display:none}
  .staff-app .staff-subnav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
  .staff-app .staff-subnav[hidden]{display:none}
  .staff-app .settings-menu{gap:6px;margin-bottom:18px}
  .staff-app .settings-menu button{border-radius:999px;padding:7px 14px}
  .staff-app #ledger-toolbar h2{margin-bottom:15px}
  .staff-app #ledger-filters{margin-top:18px}
  .staff-app #booking-search input{min-width:min(26rem,70vw)}
  .staff-app .calendar-grid{min-width:0;overflow:visible;border:0;background:transparent}
  .staff-app .calendar-day{background:var(--season-card,#fffaf3);border-color:var(--season-border,#e8dccc)}
  .staff-app .calendar-day button{min-height:0;color:var(--brand-teal);background:#ffffffb8}
  .staff-app .calendar-date{display:flex;flex-direction:column;gap:2px;line-height:1.3;padding:3px}
  .staff-app .calendar-date small{font-size:11px;color:#6a766e}
  .staff-app .calendar-date strong{font-size:18px}
  .staff-app :is(#ledger-editor,dialog){border-color:var(--season-border,#ead9c0);background:#fffcf8;box-shadow:0 18px 64px #362b2240}
  .staff-app dialog::backdrop{background:#30261d66}
  .staff-app .intake-details,.staff-app .checkin-terms{background:#fff;border-color:#eddfce}
  .staff-app .intake-choice label{min-height:44px}
  .staff-app .site-footer{font-size:14px}
  .staff-app .site-footer p{margin-top:.5rem}
  .staff-app .account-menu-panel p{font-size:12px;padding:0 .65rem;color:#718077}
  .staff-app .account-menu-panel a{color:var(--brand-teal)}
  .staff-app #workspace-status:empty{display:none}
  @media(max-width:800px){
    .staff-app main{padding:0 16px}.staff-app .card{padding:18px}
    .staff-app .primary-nav{width:100%;justify-content:center;flex-wrap:wrap;gap:2px}
    .staff-app .primary-nav a{font-size:13px;padding:8px 10px}
    .staff-app .dashboard-recent{grid-template-columns:1fr auto}
    .staff-app .dashboard-recent small{grid-column:1/-1}
  }
  @media(max-width:480px){
    .staff-app .calendar-day button{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .staff-app .calendar-holiday{font-size:10px}
    .staff-app .brand img{width:68px;height:65px}
    .staff-app .brand-title{padding-left:8px}
    .staff-app .brand-title strong{font-size:14px}
    .staff-app .brand-title small{font-size:10px}
    .staff-app .season-mascot{width:105px}
  }
  .staff-app .report-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}
  .staff-app .report-stat{background:var(--season-card,#f4faf6);border:1px solid var(--season-border,#dce7df);border-radius:16px;padding:16px}
  .staff-app .report-stat small,.staff-app .report-stat strong{display:block}
  .staff-app .report-stat strong{font-size:24px;color:var(--brand-teal);margin-top:8px}
  .staff-app .report-filters{margin-top:18px}
  .staff-app .report-filters .formgrid,.staff-app .report-filters .actions{flex-basis:100%}
`;

export function applyStaffTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const landscape = document.getElementById("staff-landscape");
  landscape.hidden = theme === "classic";
  if (!landscape.hidden) landscape.src = "/static/theme-"+theme+".webp";
  document.getElementById("staff-mascot").src = "/static/"+(theme === "classic" ? "balen-gucci-relax" : "mascot-"+theme)+".webp";
}
