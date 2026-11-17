from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

from app.appointment_image import render_card_png
from app.export_theme import STATIC, THEME_STYLES, draw_mascots, draw_motif
from app.i18n import display_date, translate
from app.stay_pdf import ADDRESS, CREAM, FONT, FONT_BOLD, FONT_LOCK, LOGO, TEAL, draw_brand_slogan, register_thai_font


def build_coupon_image(coupon, lang, theme):
    with FONT_LOCK:
        register_thai_font()
        pdf = draw_coupon(dict(coupon), lang, theme)
    return render_card_png(pdf)


def draw_coupon(coupon, lang, theme):
    def tr(message, **values):
        return translate(message, lang).format(**values)

    def number(cents):
        return f'{cents / 100:,.2f}'.rstrip('0').rstrip('.')

    width = 1080
    height = 994
    style = THEME_STYLES.get(theme)
    dark = colors.HexColor(style.dark) if style else TEAL
    light = colors.HexColor(style.light) if style else colors.HexColor('#267C77')
    paper = colors.HexColor(style.paper) if style else CREAM
    tint = colors.HexColor(style.tint) if style else colors.HexColor('#E1F0ED')
    output = BytesIO()
    canvas = Canvas(output, pagesize=(width, height))

    def text(message, y, size, color, *, bold=False, left=96, text_width=888):
        paragraph = Paragraph(escape(message), ParagraphStyle(
            'coupon', fontName=FONT_BOLD if bold else FONT, fontSize=size, leading=size*1.2,
            alignment=TA_CENTER, textColor=color, shaping=True))
        _, h = paragraph.wrap(text_width, height)
        paragraph.drawOn(canvas, left, y-h)

    canvas.setFillColor(paper)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.drawImage(ImageReader(str(LOGO)), 54, 848, 105, 105, preserveAspectRatio=True, mask='auto')
    canvas.setFillColor(dark)
    canvas.setFont(FONT_BOLD, 33)
    canvas.drawString(174, 910, 'Little Paws Homestay Phuket')
    canvas.setFont(FONT, 24)
    canvas.drawString(174, 875, ADDRESS[lang][-1])
    if style:
        draw_mascots(canvas, theme, 804, 849, 212, 106)
        draw_motif(canvas, style, 790, 935, 23)
    else:
        canvas.drawImage(ImageReader(str(STATIC/'balen-gucci-relax.webp')), 804, 849, 212, 106, mask='auto')

    ticket_x, ticket_y, ticket_width, ticket_height = 54, 283, 972, 546
    canvas.setFillColor(colors.HexColor('#D9D3C5'))
    canvas.roundRect(ticket_x, ticket_y-8, ticket_width, ticket_height, 34, fill=1, stroke=0)
    canvas.saveState()
    clip = canvas.beginPath()
    clip.roundRect(ticket_x, ticket_y, ticket_width, ticket_height, 34)
    canvas.clipPath(clip, stroke=0, fill=0)
    canvas.linearGradient(ticket_x, ticket_y, ticket_x+ticket_width, ticket_y+ticket_height, [dark, light], extend=True)
    canvas.restoreState()

    amount = number(coupon['value'])
    amount = f'{amount}%' if coupon['kind'] == 'percent' else f'฿{amount}'
    text(tr('คูปองส่วนลด'), 783, 39, colors.white, bold=True)
    text(tr('ลด {amount}', amount=amount), 715, 92, colors.white, bold=True)
    canvas.setStrokeColor(tint)
    canvas.setDash(8, 7)
    canvas.line(69, 564, 1011, 564)
    canvas.setDash()
    canvas.setFillColor(paper)
    for x in (54, 1026):
        canvas.circle(x, 564, 17, fill=1, stroke=0)

    text(tr('รหัสคูปอง'), 528, 28, colors.white, left=124, text_width=550)
    canvas.setFillColor(tint)
    canvas.roundRect(124, 349, 550, 132, 21, fill=1, stroke=0)
    text(' '.join(coupon['code']), 452, 70, dark, bold=True, left=124, text_width=550)

    qr_size = 216
    qr = Drawing(qr_size, qr_size)
    qr.add(QrCodeWidget(coupon['code'], barWidth=qr_size, barHeight=qr_size, barBorder=4))
    canvas.setFillColor(colors.white)
    canvas.rect(731, 311, qr_size, qr_size, fill=1, stroke=0)
    renderPDF.draw(qr, canvas, 731, 311)

    text(tr('ใช้ได้ถึง {date}', date=display_date(coupon['expires_on'], lang)), 248, 33, dark, bold=True)
    if coupon['minimum_cents']:
        text(tr('เมื่อมีค่าบริการตั้งแต่ {amount} บาทขึ้นไป', amount=number(coupon['minimum_cents'])), 191, 29, dark)
    remaining = max(0, coupon['max_uses']-coupon['used'])
    usage = tr('ใช้ได้ {count} ครั้ง', count=coupon['max_uses'])
    if coupon['used']:
        usage += ' · ' + tr('เหลือ {count} ครั้ง', count=remaining)
    text(usage, 139 if coupon['minimum_cents'] else 191, 29, dark)
    draw_brand_slogan(canvas, width/2, 24, scale=2.25)
    canvas.showPage()
    canvas.save()
    return output.getvalue()
