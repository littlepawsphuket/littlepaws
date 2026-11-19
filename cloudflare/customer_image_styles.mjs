// Customer PNGs use phone-readable proportions. Print/PDF layouts do not use this stylesheet.
export const customerImageViewport={width:540,height:1,deviceScaleFactor:2};
export const customerImageCss=`
html,body{min-height:0;height:auto}
body{font-size:21px;line-height:1.5}
main{max-width:540px;padding:16px}
header{padding:20px;border-radius:20px;flex-wrap:wrap;gap:14px}
header>div:first-child{width:100%;min-width:0}
.brand{font-size:17px;line-height:1.4;gap:10px}.logo{width:50px;height:48px}
header h1{font-size:34px;margin:14px 0 6px;line-height:1.2}
.status{font-size:16px;padding:4px 12px}
.address{display:flex;align-items:center;gap:14px;max-width:100%;text-align:left;font-size:14px;line-height:1.5}
.mascot{width:74px;margin:0;flex:none}
section{padding:16px;margin-top:14px;border-radius:16px}
h2{font-size:23px;margin-bottom:12px}h3{font-size:20px}
.facts{gap:10px}.fact{padding:12px;border-radius:12px;min-width:0}
.fact small,.dog-list small{font-size:16px;line-height:1.5}
.fact strong,.facts.agenda .fact strong{font-size:23px;line-height:1.4}
.agenda .fact:last-child:nth-child(odd){grid-column:1/-1}
.dog-list{grid-template-columns:minmax(0,1fr);gap:10px}
.dog-list li{padding:12px;gap:14px}
.dog-list strong{font-size:24px}.dog-photo,.dog-icon{width:76px;height:76px;border-radius:16px}
.dog-icon svg{width:58px;height:58px}
.amounts .fact strong{font-size:23px}
.amounts .fact:last-child:nth-child(odd){grid-column:1/-1}
.payment{grid-template-columns:minmax(0,1fr) auto;font-size:19px;gap:4px 10px;padding:12px 0}
.payment>span:first-child{grid-column:1/-1;color:#52665c;font-size:17px}
.payment strong{white-space:nowrap}
.signature{width:100%;max-height:150px}
.payment-qr{width:280px;height:auto}
footer{font-size:15px;line-height:1.6;margin:18px 8px 4px}footer strong{font-size:19px}
`;
export const careImageCss=`
html,body{height:auto;min-height:0}body{font-size:22px;line-height:1.55}
main{max-width:540px;padding:16px}
.brand{font-size:16px;padding:14px;gap:10px}.brand .logo{width:42px;height:42px}.brand .mascot{width:72px}
.profile{padding:18px;gap:14px;margin:14px 0 20px;align-items:flex-start}
.profile img,.dog-icon{width:76px;height:76px;border-radius:16px}.dog-icon svg{width:58px;height:58px}
h1{font-size:34px;line-height:1.3}.profile small{font-size:17px}.profile strong{font-size:21px}.profile p{font-size:17px;line-height:1.5}
h2{font-size:25px;margin:20px 0 12px}.timeline{padding-inline-start:13px;margin-inline-start:5px}
article{padding:17px;border-radius:18px;margin-bottom:14px}article h3{font-size:25px;line-height:1.4}
article header{gap:10px;flex-wrap:wrap}article p{font-size:22px;margin:12px 0}
time{font-size:22px;padding:4px 13px}
.photos{gap:10px}.photos img{width:100%;height:auto;max-height:580px;border-radius:18px}
.photos[data-count="1"] img{max-width:100%;max-height:580px}
footer{font-size:15px;line-height:1.6;margin:22px 8px 4px}footer strong{font-size:19px}
`;
