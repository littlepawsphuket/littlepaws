import qrcode from 'qrcode-generator';
// Only a scoped timeline URL is encoded. No raw R2 URL or credentials appear in exports.
export function videoQr(url){
 const qr=qrcode(0,'M');qr.addData(url);qr.make();
 return qr.createSvgTag({cellSize:2,margin:4,scalable:true}).replace('<svg ','<svg role="img" aria-label="Scan to watch video" style="display:block;width:112px;height:112px" ');
}
