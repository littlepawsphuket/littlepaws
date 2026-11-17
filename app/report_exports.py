from io import BytesIO
from xml.sax.saxutils import escape

from flask import request
from urllib.parse import urljoin

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Font, PatternFill
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer

from app.appointment_image import render_card_png
from app.export_theme import THEME_STYLES
from app.stay_pdf import FONT, FONT_BOLD, FONT_LOCK, TEAL, register_thai_font


def spreadsheet(report):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Summary'
    sheet.append([report['title']])
    sheet.append([report['period']])
    sheet.append([report['note']])
    for label, value in report['summary']:
        sheet.append([label, value])
    for title, entries in report['groups']:
        sheet.append([title])
        for label, value in entries:
            sheet.append([label, value])
    details = book.create_sheet('Details')
    details.append(report['columns'])
    for record in report['rows']:
        details.append(record['values'])
        if record['link']:
            details.cell(details.max_row, 1).hyperlink = urljoin(request.url_root, record['link'])
    details.freeze_panes = 'A2'
    details.auto_filter.ref = details.dimensions
    if report['chart']:
        labels, points = report['chart']
        trends = book.create_sheet('Monthly')
        trends.append(['Month', *labels])
        for month, values in points:
            trends.append([month, *values])
        if points:
            chart = BarChart()
            chart.add_data(Reference(trends, min_col=2, max_col=len(labels)+1, min_row=1, max_row=len(points)+1), titles_from_data=True)
            chart.set_categories(Reference(trends, min_col=1, min_row=2, max_row=len(points)+1))
            trends.add_chart(chart, 'F2')
    for tab in book:
        for cell in tab[1]:
            cell.fill = PatternFill('solid', fgColor='14585D')
            cell.font = Font(name='Aptos', bold=True, color='FFFFFF')
        for column in tab.columns:
            tab.column_dimensions[column[0].column_letter].width = min(54, max(15, max(len(str(c.value or '')) for c in column)+4))
            for cell in column:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
    output = BytesIO()
    book.save(output)
    output.seek(0)
    return output


def document(report, lang, theme, image=False):
    with FONT_LOCK:
        register_thai_font()
        pdf = _document(report, lang, theme, image)
    return render_card_png(pdf.getvalue()) if image else pdf


def _document(report, lang, theme, image):
    output = BytesIO()
    style = THEME_STYLES.get(theme)
    accent = colors.HexColor(style.dark) if style else TEAL
    tint = colors.HexColor(style.tint) if style else colors.HexColor('#E1F0ED')
    width, height = landscape(A4)
    if image:
        # A chat image is a summary. PDF and Excel hold the full detail table.
        height = 305 + 24*len(report['summary']) + sum(38+22*min(len(entries),8) for _,entries in report['groups'])
        if report['chart'] and report['chart'][1]:
            height += 200+22*min(len(report['chart'][1]),12)
    doc = SimpleDocTemplate(output, pagesize=(width,height), leftMargin=36,rightMargin=36,
                            topMargin=88,bottomMargin=52, title=report['title'])

    def paragraph(value, size=10, bold=False):
        if isinstance(value, float):
            value = f'{value:,.2f}'
        return Paragraph(escape(str(value)), ParagraphStyle('report',fontName=FONT_BOLD if bold else FONT,
                         fontSize=size,leading=size+5,shaping=True,textColor=accent if bold else colors.HexColor('#302920')))

    def table(headers, rows, repeat=1):
        cells = [[paragraph(v, 10, True) for v in headers]] if headers else []
        cells += [[paragraph(v) for v in row] for row in rows]
        if not cells:
            return Spacer(1,1)
        return LongTable(cells, colWidths=[(doc.width-12)/len(cells[0])]*len(cells[0]), repeatRows=repeat,
                         splitInRow=1, style=[('BACKGROUND',(0,0),(-1,0),tint),('VALIGN',(0,0),(-1,-1),'TOP'),
                         ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#FAF7F0')]),
                         ('LINEBELOW',(0,0),(-1,-1),0.25,tint)])

    blocks = [paragraph(report['title'],24,True), paragraph(report['period'],13), paragraph(report['note'],10),
              Spacer(1,10),table([],report['summary'],0)]
    for title, entries in report['groups']:
        blocks += [Spacer(1,10), paragraph(title,14,True), table([],entries[:8] if image else entries,0)]
    if report['chart'] and report['chart'][1]:
        labels, points = report['chart']
        visible = points[-12:]
        if len(points) > 12:
            blocks.append(paragraph('กราฟ 12 เดือนล่าสุดในช่วงที่เลือก' if lang=='th' else 'Chart shows the latest 12 months in the selection'))
        chart_width = doc.width-12
        graph = Drawing(chart_width, 145)
        gap = (chart_width-24)/len(visible)
        bar_width = min(15, (gap-8)/len(labels))
        peak = max(1, max(max(values) for _,values in visible))
        palette = [colors.HexColor(code) for code in ('#176c65','#8b4b24','#6a497b')]
        for index, (month, values) in enumerate(visible):
            center = 12+(index+.5)*gap
            graph.add(String(center, 7, month, fontSize=8, textAnchor='middle'))
            for series, value in enumerate(values):
                if value:
                    graph.add(Rect(center+(series-len(labels)/2)*bar_width, 23, bar_width-2,
                                   value/peak*108, fillColor=palette[series], strokeColor=None))
        for index, label in enumerate(labels):
            blocks.append(Paragraph(f'<font color="{palette[index].hexval()}">●</font> {escape(label)}',
                                    ParagraphStyle('legend',fontName=FONT,shaping=True,fontSize=10,leading=15)))
        blocks += [graph, table(['เดือน' if lang=='th' else 'Month',*labels],[(m,*v) for m,v in (visible if image else points)])]
    if not image:
        blocks += [Spacer(1,14),table(report['columns'],[row['values'] for row in report['rows']])]
    else:
        blocks += [Spacer(1,10),paragraph('ภาพสรุป · ดูรายละเอียดทั้งหมดใน PDF หรือ Excel' if lang=='th'
                                         else 'Summary image · Full details in PDF or Excel')]
    def report_frame(canvas, document):
        from app.stay_pdf import LOGO, draw_brand_slogan
        from app.export_theme import draw_mascots
        canvas.setFillColor(colors.white)
        canvas.rect(0,0,width,height,fill=1,stroke=0)
        canvas.drawImage(str(LOGO),36,height-72,54,54,mask='auto',preserveAspectRatio=True)
        canvas.setFillColor(accent)
        canvas.setFont(FONT_BOLD,15)
        canvas.drawString(100,height-44,'Little Paws Homestay Phuket')
        if style:
            draw_mascots(canvas,theme,width-146,height-69,108,52)
        canvas.setStrokeColor(tint)
        canvas.line(36,height-78,width-36,height-78)
        canvas.line(36,43,width-36,43)
        draw_brand_slogan(canvas,width/2,10)
        canvas.setFont(FONT,9)
        canvas.drawRightString(width-36,22,str(document.page))

    doc.build(blocks,onFirstPage=report_frame,onLaterPages=report_frame)
    output.seek(0)
    return output
