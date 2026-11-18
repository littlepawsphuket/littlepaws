const encoder = new TextEncoder();
const xml = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char],
    );
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const sheetNamespace =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relation = (id, type, target) =>
  `<Relationship Id="${id}" Type="${relationNamespace}/${type}" Target="${target}"/>`;
const relationships = (entries) =>
  declaration +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  entries.join("") +
  "</Relationships>";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

// XLSX uses a ZIP container. Stored entries avoid compression dependencies in Workers.
function archive(entries) {
  const chunks = [],
    central = [];
  let offset = 0,
    centralSize = 0;
  for (const [path, source] of Object.entries(entries)) {
    const name = encoder.encode(path),
      body = encoder.encode(source);
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length),
      localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x800, true);
    localView.setUint16(12, 33, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, body.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length),
      view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x800, true);
    view.setUint16(14, 33, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, body.length, true);
    view.setUint32(24, body.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    record.set(name, 46);
    chunks.push(local, body);
    central.push(record);
    offset += local.length + body.length;
    centralSize += record.length;
  }
  const end = new Uint8Array(22),
    view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, central.length, true);
  view.setUint16(10, central.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end]);
}

function worksheet(rows, { filter = false, chart = false } = {}) {
  const last =
    String.fromCharCode(64 + Math.max(1, ...rows.map((row) => row.length))) +
    rows.length;
  const cells = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((value, column) => {
            const ref = String.fromCharCode(65 + column) + (index + 1);
            return typeof value === "number" && Number.isFinite(value)
              ? `<c r="${ref}" s="${index === 0 ? 1 : 0}"><v>${value}</v></c>`
              : `<c r="${ref}" s="${index === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return (
    declaration +
    `<worksheet xmlns="${sheetNamespace}" xmlns:r="${relationNamespace}"><dimension ref="A1:${last}"/>
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
    <cols><col min="1" max="9" width="25" customWidth="1"/></cols><sheetData>${cells}</sheetData>
    ${filter ? `<autoFilter ref="A1:${last}"/>` : ""}${chart ? '<drawing r:id="chart"/>' : ""}</worksheet>`
  );
}

function chartXml(chart) {
  const size = chart.months.length;
  const series = chart.series
    .map((name, index) => {
      const column = String.fromCharCode(66 + index);
      const cache = chart.months
        .map(
          (point, i) =>
            `<c:pt idx="${i}"><c:v>${chart.type === "money" ? point.values[index] / 100 : point.values[index]}</c:v></c:pt>`,
        )
        .join("");
      const categories = chart.months
        .map(
          (point, i) =>
            `<c:pt idx="${i}"><c:v>${xml(point.month)}</c:v></c:pt>`,
        )
        .join("");
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(name)}</c:v></c:tx>
      <c:cat><c:strRef><c:f>Monthly!$A$2:$A$${size + 1}</c:f><c:strCache><c:ptCount val="${size}"/>${categories}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>Monthly!$${column}$2:$${column}$${size + 1}</c:f><c:numCache><c:formatCode>#,##0.00</c:formatCode><c:ptCount val="${size}"/>${cache}</c:numCache></c:numRef></c:val></c:ser>`;
    })
    .join("");
  return (
    declaration +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea>
    <c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}<c:axId val="1"/><c:axId val="2"/></c:barChart>
    <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:lblOffset val="100"/></c:catAx>
    <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
    </c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  );
}

export function reportWorkbook(report) {
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(report.lang === "en" ? "en-GB" : "th-TH", {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(value + "T00:00:00Z"))
      : "—";
  const value = (value, type) =>
    type === "date" ? date(value) : type === "money" ? value / 100 : value;
  const summary = [
    [report.title],
    [date(report.start) + " – " + date(report.end)],
    [report.note],
    ...report.summary.map((item) => [item.label, value(item.value, item.type)]),
  ];
  for (const group of report.groups)
    summary.push(
      [group.label],
      ...group.items.map(([label, amount]) => [
        label,
        value(amount, group.type),
      ]),
    );
  const details = [
    report.columns.map((item) => item.label),
    ...report.rows.map((item) =>
      item.values.map((cell, index) => value(cell, report.columns[index].type)),
    ),
  ];
  const hasChart = Boolean(report.chart?.months.length);
  const sheets = [
    { name: "Summary", rows: summary },
    { name: "Details", rows: details, filter: true },
  ];
  if (report.chart)
    sheets.push({
      name: "Monthly",
      rows: [
        ["Month", ...report.chart.series],
        ...report.chart.months.map((item) => [
          item.month,
          ...item.values.map((amount) => value(amount, report.chart.type)),
        ]),
      ],
      chart: hasChart,
    });
  const entries = {
    "_rels/.rels": relationships([
      relation("workbook", "officeDocument", "xl/workbook.xml"),
    ]),
    "xl/workbook.xml":
      declaration +
      `<workbook xmlns="${sheetNamespace}" xmlns:r="${relationNamespace}"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="sheet${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": relationships([
      ...sheets.map((sheet, index) =>
        relation(
          "sheet" + (index + 1),
          "worksheet",
          `worksheets/sheet${index + 1}.xml`,
        ),
      ),
      relation("styles", "styles", "styles.xml"),
    ]),
    "xl/styles.xml":
      declaration +
      `<styleSheet xmlns="${sheetNamespace}"><fonts count="2"><font><sz val="11"/><name val="Sukhumvit Set"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Sukhumvit Set"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF155747"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  for (const [index, sheet] of sheets.entries())
    entries[`xl/worksheets/sheet${index + 1}.xml`] = worksheet(
      sheet.rows,
      sheet,
    );
  if (hasChart) {
    entries["xl/worksheets/_rels/sheet3.xml.rels"] = relationships([
      relation("chart", "drawing", "../drawings/drawing1.xml"),
    ]);
    entries["xl/drawings/_rels/drawing1.xml.rels"] = relationships([
      relation("chart", "chart", "../charts/chart1.xml"),
    ]);
    entries["xl/charts/chart1.xml"] = chartXml(report.chart);
    entries["xl/drawings/drawing1.xml"] =
      declaration +
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>15</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Monthly trends"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${relationNamespace}" r:id="chart"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  }
  const contentTypes = {
    ...Object.fromEntries(
      sheets.map((sheet, index) => [
        `/xl/worksheets/sheet${index + 1}.xml`,
        "spreadsheetml.worksheet+xml",
      ]),
    ),
    "/xl/workbook.xml": "spreadsheetml.sheet.main+xml",
    "/xl/styles.xml": "spreadsheetml.styles+xml",
  };
  if (hasChart)
    Object.assign(contentTypes, {
      "/xl/charts/chart1.xml": "drawingml.chart+xml",
      "/xl/drawings/drawing1.xml": "drawing+xml",
    });
  entries["[Content_Types].xml"] =
    declaration +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    Object.entries(contentTypes)
      .map(
        ([name, type]) =>
          `<Override PartName="${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`,
      )
      .join("") +
    "</Types>";
  return archive(entries);
}
