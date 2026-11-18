import { documentAssets } from "./document_data.mjs";
import { escape, palette, picture } from "./document_layout.mjs";
import { renderExport, privateDocumentHeaders } from "./document_exports.mjs";
import { reportWorkbook } from "./report_xlsx.mjs";

export async function exportReport(env, report, format) {
  const filename = `little-paws-${report.name}-${report.start}-${report.end}-${report.lang}.${format}`;
  if (format === "xlsx")
    return new Response(reportWorkbook(report), {
      headers: {
        ...privateDocumentHeaders,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  if (format === "png" && report.chart?.months.length > 120) {
    return new Response(
      "Choose a shorter report period for the image export.",
      { status: 422, headers: privateDocumentHeaders },
    );
  }
  const assets = await documentAssets(env);
  const html = reportHtml(report, assets, format);
  if (new TextEncoder().encode(html).length > 5 * 1024 * 1024) {
    return new Response(
      "Choose a shorter report period for the document export.",
      { status: 422, headers: privateDocumentHeaders },
    );
  }
  return renderExport(env, {
    html,
    format,
    lang: report.lang,
    filename,
  });
}

export function reportHtml(report, { theme, logo, font, mascot }, format) {
  const en = report.lang === "en",
    image = format === "png";
  const address = en
    ? [
        "163/206 Moo 5, iLeaf Town 2 Village, Soi 12",
        "Srisunthon, Thalang, Phuket 83110",
        "Telephone 081-426-6241",
      ]
    : [
        "163/206 ม.5 มบ.ไอลีฟทาวน์ 2 ซ.12",
        "ต.ศรีสุนทร อ.ถลาง จ.ภูเก็ต 83110",
        "โทร 081-426-6241",
      ];
  const [accent, tint] = palette[theme] || palette.classic;
  const slogan = en
    ? "Because every little paw deserves a whole lot of love."
    : "เพราะทุกอุ้งเท้าเล็ก ๆ สมควรได้รับความรักที่ยิ่งใหญ่";
  const pageFooter = format === "pdf"
    ? `@bottom-center{content:"Little Paws, Big Love.\\A ${slogan}";white-space:pre;text-align:center;font:9px/1.6 Sukhumvit,"Sukhumvit Set",sans-serif;color:${accent}}@bottom-right{content:counter(page);font:9px Sukhumvit,sans-serif;color:${accent}}`
    : "";
  const money = (value) =>
    new Intl.NumberFormat(en ? "en-GB" : "th-TH", {
      style: "currency",
      currency: "THB",
    }).format(value / 100);
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(en ? "en-GB" : "th-TH", {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(value + "T00:00:00Z"))
      : "—";
  const value = (entry, type) =>
    entry === null || entry === undefined || entry === ""
      ? "—"
      : type === "money"
        ? money(entry)
        : type === "date"
          ? date(entry)
          : String(entry);
  const stats = report.summary
    .map(
      (item) =>
        `<div class="stat"><small>${escape(item.label)}</small><strong>${escape(value(item.value, item.type))}</strong></div>`,
    )
    .join("");
  let chart = "";
  if (report.chart?.months.length) {
    const colors = ["#257b69", "#bd6a5b", "#8b6baf"];
    const maximum = Math.max(
      1,
      ...report.chart.months.flatMap((item) => item.values.map(Math.abs)),
    );
    chart = `<section><h2>${en ? "Monthly trends" : "แนวโน้มรายเดือน"}</h2>${report.chart.months.map((item) => `<div class="month"><strong>${escape(item.month)}</strong>${item.values.map((amount, index) => `<div class="bar-row"><span>${escape(report.chart.series[index])}</span><div class="track"><div style="width:${Math.max(0, (Math.abs(amount) / maximum) * 100)}%;background:${colors[index % colors.length]}"></div></div><b>${escape(value(amount, report.chart.type))}</b></div>`).join("")}</div>`).join("")}</section>`;
  }
  const groups = report.groups
    .map(
      (group) =>
        `<section><h2>${escape(group.label)}</h2>${(image ? group.items.slice(0, 30) : group.items).map(([label, amount]) => `<div class="group-row"><span>${escape(label)}</span><b>${escape(value(amount, group.type))}</b></div>`).join("")}${image && group.items.length > 30 ? `<p>${en ? "More entries are available in Excel and PDF." : "ดูรายการเพิ่มเติมใน Excel และ PDF"}</p>` : ""}</section>`,
    )
    .join("");
  const details = image
    ? `<p>${en ? "Records in this report" : "จำนวนรายการในรายงาน"} · ${report.rows.length}</p>`
    : `<table><thead><tr>${report.columns.map((column) => `<th>${escape(column.label)}</th>`).join("")}</tr></thead><tbody>${report.rows.map((row) => `<tr>${row.values.map((entry, index) => `<td>${escape(value(entry, report.columns[index].type))}</td>`).join("")}</tr>`).join("")}</tbody></table>${!report.rows.length ? `<p>${en ? "No records in this period." : "ไม่พบข้อมูลในช่วงที่เลือก"}</p>` : ""}`;
  return `<!doctype html><html lang="${report.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title><style>
    ${font ? `@font-face{font-family:Sukhumvit;src:url('${font}')} ` : ""}
    *{box-sizing:border-box}body{margin:0;background:${tint};color:#263c34;font:15px/1.6 Sukhumvit,"Sukhumvit Set",sans-serif}
    header{display:flex;align-items:center;gap:14px;background:${accent};color:white;padding:18px 28px}header .logo{width:62px;height:62px;object-fit:contain}header .identity{flex:1;min-width:0}header .identity small{display:block;font-size:11px;line-height:1.5}header .mascot{width:130px;height:72px;object-fit:contain;margin-left:auto}
    main{padding:26px}h1{font-size:28px;line-height:1.4;margin:0 0 8px}h2{font-size:18px;color:${accent};margin:0 0 12px}p{margin:8px 0 18px}.note{color:#52675d;font-size:13px}
    .summary{display:grid;grid-template-columns:repeat(${image ? 2 : 4},minmax(0,1fr));gap:12px;margin:20px 0}.stat{background:white;border:1px solid ${accent}22;border-radius:18px;padding:15px}.stat small{display:block;color:#62736b}.stat strong{display:block;color:${accent};font-size:24px;overflow-wrap:anywhere}
    section{border-radius:18px;background:white;padding:18px;margin:18px 0;break-inside:auto}.month{padding:10px 0;border-bottom:1px solid #e2ebe5;break-inside:avoid}.bar-row{display:grid;grid-template-columns:110px minmax(0,1fr) 120px;gap:10px;align-items:center;font-size:12px}.bar-row b{text-align:right}.track{height:10px;background:#edf2ef;border-radius:10px;overflow:hidden}.track div{height:100%;border-radius:10px}
    .group-row{display:flex;justify-content:space-between;gap:15px;padding:7px 0;border-bottom:1px solid #e2ebe5;break-inside:avoid}table{width:100%;border-collapse:collapse;background:white;font-size:11px;table-layout:fixed}th,td{padding:9px 7px;vertical-align:top;text-align:left;overflow-wrap:anywhere;border-bottom:1px solid #dfe8e2}th{background:${accent};color:white}thead{display:table-header-group}tr{break-inside:avoid}
    footer{text-align:center;padding:16px 26px 24px;font-size:12px;color:${accent}}footer strong{font-size:15px}footer p{margin:3px 0}
    @page{size:A4 landscape;margin:12mm 12mm 20mm;${pageFooter}} @media print{body{background:white;font-size:11px}header{padding:12px 18px}main{padding:18px 0}header,section,.summary,footer{-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:23px}h2{break-after:avoid}.stat strong{font-size:20px}footer{${format === "pdf" ? "display:none;" : ""}padding:3px;font-size:9px}footer strong{font-size:11px}footer p{margin:0}}
    </style></head><body><header>${picture(logo, "Little Paws", "logo")}<div class="identity"><strong>Little Paws Homestay Phuket</strong><small>${address.map(escape).join("<br>")}</small></div>${picture(mascot, "", "mascot")}</header><main><h1>${escape(report.title)}</h1><p>${date(report.start)} – ${date(report.end)}</p><p class="note">${escape(report.note)}</p><div class="summary">${stats}</div>${report.peakDay ? `<p>${en ? "Peak day" : "วันสูงสุด"} · ${date(report.peakDay)}</p>` : ""}${chart}${groups}${details}</main><footer><strong>Little Paws, Big Love.</strong><p>${en ? "Because every little paw deserves a whole lot of love." : "เพราะทุกอุ้งเท้าเล็ก ๆ สมควรได้รับความรักที่ยิ่งใหญ่"} ❤️</p></footer></body></html>`;
}
