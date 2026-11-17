from datetime import datetime
from functools import cached_property, partial
from io import BytesIO
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

import uharfbuzz
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, KeepTogether, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from app.brand import SLOGAN_TEXT, SLOGAN_TITLE
from app.export_theme import THEME_STYLES, draw_mascots, draw_motif
from app.export_dog_photo import DogThumbnail
from app.i18n import display_date, display_payment_datetime, stay_duration, translate
from app.stay_terms import consent_terms, updated_term_sections


FONT = 'SukhumvitSet-Text'
FONT_BOLD = 'SukhumvitSet-SemiBold'
FONT_PATH = '/System/Library/Fonts/Supplemental/SukhumvitSet.ttc'
FONT_LOCK = Lock()
TEAL = colors.HexColor('#14585D')
BROWN = colors.HexColor('#75401E')
INK = colors.HexColor('#362B22')
MUTED = colors.HexColor('#695743')
CREAM = colors.HexColor('#FCF6EB')
LINE = colors.HexColor('#EADBC7')
MINT = colors.HexColor('#E1F0ED')
LOGO = Path(__file__).resolve().parent / 'static' / 'little-paws-logo.png'
ADDRESS = {
    'th': ('163/206 ม.5 มบ.ไอลีฟทาวน์ 2 ซ.12',
           'ต.ศรีสุนทร อ.ถลาง จ.ภูเก็ต 83110',
           'โทร 081-426-6241'),
    'en': ('163/206 Moo. 5 iLeaf Town 2 Village Soi.12',
           'Srisunthon, Thalang, Phuket 83110',
           'Telephone: 081-426-6241'),
}


class TicketHeading(Flowable):
    def __init__(self, title, reference, theme):
        super().__init__()
        self.title = title
        self.reference = reference
        self.theme = theme
        self.style = THEME_STYLES.get(theme)

    def wrap(self, available_width, available_height):
        self.width = available_width
        title_width = available_width-28-(120 if self.style else 0)
        _, self.title_height = self.title.wrap(title_width, available_height)
        _, self.reference_height = self.reference.wrap(available_width-28, available_height)
        self.height = self.title_height+self.reference_height+35
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        canvas.saveState()
        canvas.setFillColor(colors.HexColor(self.style.dark) if self.style else TEAL)
        canvas.roundRect(0, 0, self.width, self.height, 10, stroke=0, fill=1)
        separator = self.reference_height+17
        canvas.setStrokeColor(colors.HexColor('#A5CCC6'))
        canvas.setDash(3, 3)
        canvas.line(7, separator, self.width-7, separator)
        canvas.setDash()
        canvas.setFillColor(colors.white)
        for edge in (0, self.width):
            canvas.circle(edge, separator, 5, stroke=0, fill=1)
        self.title.drawOn(canvas, 14, self.height-self.title_height-9)
        self.reference.drawOn(canvas, 14, 8)
        if self.style:
            draw_mascots(canvas, self.theme, self.width-104, separator+2, 91, self.title_height+12)
            draw_motif(canvas, self.style, self.width-113, self.height-12, 11)
        canvas.restoreState()


class Signature(Flowable):
    def __init__(self, strokes):
        super().__init__()
        self.strokes = strokes
        self.width = 230
        self.height = 72

    def draw(self):
        canvas = self.canv
        canvas.setStrokeColor(LINE)
        canvas.roundRect(0, 0, self.width, self.height, 7, stroke=1, fill=0)
        points = [point for stroke in self.strokes for point in stroke]
        left, right = min(x for x, _ in points), max(x for x, _ in points)
        top, bottom = min(y for _, y in points), max(y for _, y in points)
        scale = min((self.width-24)/max(right-left, 1), (self.height-24)/max(bottom-top, 1), 1.5)
        x_offset = (self.width-(right-left)*scale)/2
        y_offset = (self.height-(bottom-top)*scale)/2
        canvas.setStrokeColor(INK)
        canvas.setLineWidth(1.35)
        canvas.setLineCap(1)
        canvas.setLineJoin(1)
        for stroke in self.strokes:
            path = canvas.beginPath()
            for index, (x, y) in enumerate(stroke):
                move = path.lineTo if index else path.moveTo
                move(x_offset+(x-left)*scale, y_offset+(bottom-y)*scale)
            canvas.drawPath(path)


def draw_brand_slogan(canvas, center, bottom, scale=1):
    canvas.saveState()
    canvas.translate(center, bottom)
    canvas.scale(scale, scale)
    canvas.setFillColor(BROWN)
    canvas.setFont(FONT_BOLD, 10)
    title_width = canvas.stringWidth(SLOGAN_TITLE, FONT_BOLD, 10)
    title_left = 7 - title_width/2
    canvas.drawString(title_left, 17, SLOGAN_TITLE)
    # Draw the two marks so the footer renders consistently without an emoji font.
    paw_x = title_left - 9
    canvas.ellipse(paw_x-2.6, 17, paw_x+2.6, 20.8, stroke=0, fill=1)
    for dx, dy in ((-3.3, 3.8), (-1.2, 6.0), (1.2, 6.0), (3.3, 3.8)):
        canvas.circle(paw_x+dx, 17+dy, 1.05, stroke=0, fill=1)
    text = Paragraph(escape(SLOGAN_TEXT), ParagraphStyle('slogan', fontName=FONT,
                     fontSize=9, leading=12, alignment=TA_CENTER, textColor=BROWN, shaping=True))
    text.wrap(260, 24)
    text.drawOn(canvas, -134, 0)
    heart_x = pdfmetrics.stringWidth(SLOGAN_TEXT, FONT, 9)/2 + 4
    canvas.setFillColor(colors.HexColor('#B75052'))
    heart = canvas.beginPath()
    heart.moveTo(heart_x, 3)
    heart.curveTo(heart_x-9, 9, heart_x-3, 13, heart_x, 9)
    heart.curveTo(heart_x+3, 13, heart_x+9, 9, heart_x, 3)
    canvas.drawPath(heart, stroke=0, fill=1)
    canvas.restoreState()


def document_frame(canvas, doc, *, lang, theme):
    width, height = A4
    canvas.setStrokeColor(LINE)
    canvas.line(40, height-80, width-40, height-80)
    canvas.line(40, 48, width-40, 48)
    draw_brand_slogan(canvas, width/2, 14)
    if style := THEME_STYLES.get(theme):
        draw_motif(canvas, style, 46, 28, 15)
        draw_motif(canvas, style, 65, 28, 10)
    canvas.drawImage(ImageReader(str(LOGO)), 40, height-74, width=60, height=59,
                     preserveAspectRatio=True, mask='auto')
    canvas.setFillColor(TEAL)
    canvas.setFont(FONT_BOLD, 12)
    canvas.drawString(108, height-44, 'Little Paws Homestay Phuket')
    canvas.setFont(FONT, 9)
    canvas.drawString(108, height-59, 'Management System')
    address_width = 244
    address = Paragraph('<br/>'.join(escape(line) for line in ADDRESS[lang]),
                        ParagraphStyle('address', fontName=FONT,
                                       fontSize=9, leading=12, textColor=MUTED, alignment=TA_RIGHT,
                                       shaping=True))
    _, address_height = address.wrap(address_width, 50)
    address.drawOn(canvas, width-40-address_width, height-30-address_height)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width-40, 28, f'{doc.page}')


def build_stay_pdf(stay, dogs, status, consent, lang, *, theme="classic"):
    return build_booking_pdf(stay, dogs, status, lang, consent=consent, theme=theme)


def build_booking_pdf(stay, dogs, status, lang, *, consent=None, appointment=False, receipt=False, theme="classic"):
    # ReportLab shares font/subset state across requests.
    with FONT_LOCK:
        register_thai_font()
        return _build_booking_pdf(stay, dogs, status, consent, lang, appointment, receipt, theme)


class CollectionFont(TTFont):
    def __init__(self, name, index):
        super().__init__(name, FONT_PATH, subfontIndex=index, shapable=True)
        self.collection_index = index

    @cached_property
    def hbFace(self):
        default_face = super().hbFace
        # ReportLab initializes shaping state for face zero. Select the same face it embeds.
        return uharfbuzz.Face(default_face.blob, self.collection_index)


def register_thai_font():
    registered = pdfmetrics.getRegisteredFontNames()
    for name, index in ((FONT, 2), (FONT_BOLD, 4)):
        if name not in registered:
            pdfmetrics.registerFont(CollectionFont(name, index))


def _build_booking_pdf(stay, dogs, status, consent, lang, appointment, receipt, theme):
    output = BytesIO()
    document_type = 'Deposit receipt' if receipt else 'Booking confirmation' if appointment else 'Stay'
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=40, rightMargin=40,
                            topMargin=96, bottomMargin=57,
                            title=f'Little Paws - {document_type} {stay["id"]}', author='Little Paws Homestay Phuket')
    theme_style = THEME_STYLES.get(theme)
    table_tint = colors.HexColor(theme_style.tint) if theme_style else MINT
    # The default ReportLab frame has 6 pt of padding at each side.
    width = doc.width - 12

    def tr(message):
        return translate(message, lang)

    def paragraph(value, size=11, color=INK, after=0, leading=None):
        return Paragraph(
            escape(str(value)).replace('\n', '<br/>'),
            ParagraphStyle('thai', fontName=FONT, fontSize=size, leading=leading or size+5,
                           textColor=color, spaceAfter=after, shaping=True),
        )

    def money(amount):
        return f"{amount:,.2f} {tr('บาท')}"

    def table(rows, fractions, header=False, valign='TOP'):
        style = [
            ('VALIGN', (0, 0), (-1, -1), valign),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [CREAM, colors.white]),
            ('LINEBELOW', (0, 0), (-1, -1), .4, LINE),
        ]
        if header:
            style.append(('BACKGROUND', (0, 0), (-1, 0), table_tint))
        return LongTable(rows, colWidths=[width*fraction for fraction in fractions], hAlign='LEFT',
                         style=TableStyle(style), repeatRows=int(header), splitInRow=1)

    title = 'ใบรับมัดจำ' if receipt else 'ใบยืนยันการจอง' if appointment else 'แบบสรุปการรับฝากน้องหมา'
    references = []
    if not appointment:
        if dict(stay).get('stay_number'):
            references.append(f"{tr('หมายเลขการเข้าพัก')}  {stay['stay_number']}")
        else:
            references.append(f"{tr('รายการ #')}{stay['id']}")
    if dict(stay).get('booking_number'):
        references.append(f"{tr('เลขจอง')}  {stay['booking_number']}")
    if receipt:
        references.append(f"{tr('เลขที่ใบรับมัดจำ')}  DEP-{stay['payments'][0]['id']}")
    references.append(tr(status))
    blocks = [TicketHeading(paragraph(tr(title), 24, colors.white),
                            paragraph('  ·  '.join(references), 11, colors.HexColor('#E1F0ED')), theme),
              Spacer(1, 13)]
    if receipt:
        deposit = stay['payments'][0]
        balance = stay['receipt_balance']
        balance_label = 'ยอดคงเหลือ' if stay['stay_id'] else 'ยอดคงเหลือที่ต้องชำระวันเข้าพัก'
        blocks.extend([
            paragraph(f"{tr('ยอดมัดจำที่ได้รับ')}  {money(deposit['amount'])}", 24, TEAL, 10),
            paragraph(f"{tr('วันที่รับชำระ')}  {display_payment_datetime(deposit, lang)}", 11, MUTED, 8),
            paragraph(f"{tr(balance_label)}  {money(balance) if balance is not None else tr('รอระบุราคา')}",
                      13, TEAL, 12),
        ])
    blocks.extend([
        table([
            [paragraph(tr('วันเข้าพักที่จอง' if appointment else 'วันเข้าพัก'), 10, TEAL),
             paragraph(tr('วันรับกลับ'), 10, TEAL)],
            [paragraph(display_date(stay['checkin'], lang), 18, TEAL),
             paragraph(display_date(stay['checkout'], lang), 18, TEAL)],
        ], (.5, .5), header=True),
        Spacer(1, 13),
    ])
    details = [('ชื่อลูกค้า', stay['customer']), ('โทรศัพท์ / LINE', stay['contact'] or '-')]
    service = dict(stay).get('service_type')
    duration_label = 'จำนวนเดือน' if service == 'monthly' else 'จำนวนวัน'
    details.append((duration_label, stay_duration(stay['charged_nights'], service, lang)))
    blocks.extend([
        table([[paragraph(tr(label), 10, MUTED), paragraph(value)] for label, value in details], (.32, .68)),
        Spacer(1, 15),
        paragraph(tr('สุนัขในการจอง' if appointment else 'สุนัขที่รับฝากและค่าบริการ'), 15, BROWN, 8),
    ])
    rate_heading, total_heading = {'daycare': ('ราคา / วัน', 'รวมตามจำนวนวัน'),
                                    'monthly': ('ราคา / เดือน', 'รวมตามจำนวนเดือน')}.get(
                                        service, ('ราคา / คืน', 'รวมตามจำนวนคืน'))
    dog_rows = [['', *[paragraph(tr(label), 10, TEAL) for label in ('ชื่อสุนัข', rate_heading, total_heading)]]]
    no_rate = tr('รอระบุราคา') if appointment else '-'
    for dog in dogs:
        rate = dog['nightly_rate_cents']
        dog_rows.append([
            DogThumbnail(dog['photo'], 34),
            paragraph(dog['name']),
            paragraph(money(rate/100) if rate is not None else no_rate, 9, MUTED),
            paragraph(money(rate*stay['charged_nights']/100) if rate is not None else '-', 9, MUTED),
        ])
    blocks += [table(dog_rows, (.115, .345, .23, .31), header=True, valign='MIDDLE'), Spacer(1, 10)]
    discount = stay['discount_cents']/100
    quote_pending = appointment and (not dogs or any(dog['nightly_rate_cents'] is None for dog in dogs))
    totals = [
        ('รวมก่อนส่วนลด', no_rate if quote_pending else money(stay['agreed_total']+discount+dict(stay).get('rounding_cents',0)/100)),
        ('ส่วนลด', money(discount)),
        ('ยอดสุทธิโดยประมาณ' if appointment else 'ยอดสุทธิ',
         no_rate if quote_pending else money(stay['agreed_total'])),
    ]
    if rounding := dict(stay).get('rounding_cents'):
        totals.insert(2, ('ปัดเศษสตางค์ทิ้ง', money(rounding/100)))
    if not receipt:
        display_totals = totals[1:] if appointment else totals
        blocks.append(paragraph('  |  '.join(f'{tr(label)}: {value}' for label, value in display_totals), 9, MUTED))
        payments = dict(stay).get('payments', [])
        if payments or dict(stay).get('payment_tracking'):
            rows = [['#', *[paragraph(tr(label), 10, TEAL) for label in ('วันที่รับชำระ', 'รายการ', 'จำนวนเงิน')]]]
            rows.extend([paragraph(index), paragraph(display_payment_datetime(payment, lang)),
                         paragraph(tr(payment['label'])), paragraph(money(payment['amount']))]
                        for index, payment in enumerate(payments, 1))
            received = sum(payment['amount'] for payment in payments)
            blocks.extend([Spacer(1, 12), paragraph(tr('ประวัติการชำระเงิน'), 15, BROWN, 8)])
            if payments:
                blocks.append(table(rows, (.09, .30, .35, .26), header=True))
            else:
                blocks.append(paragraph(tr('ยังไม่มีการชำระเงิน')))
            balance = max(0, dict(stay).get('payment_total', stay['agreed_total'])-received)
            paid = f"{tr('ชำระแล้ว')}  {money(received)}"
            if not quote_pending or dict(stay).get('payment_tracking'):
                paid += f"  |  {tr('ยอดคงเหลือ')}  {money(balance)}"
            blocks.extend([Spacer(1, 6), paragraph(paid, 10, TEAL)])
    if stay['note']:
        note_title = 'หมายเหตุการจอง' if appointment else 'หมายเหตุการเข้าพัก'
        blocks.extend([Spacer(1, 12), paragraph(tr(note_title), 13, BROWN, 4), paragraph(stay['note'])])
    if appointment and not receipt:
        blocks.extend([Spacer(1, 14), paragraph(tr('กรุณาตรวจรายละเอียดการจองก่อนเข้าพัก ค่าฝากจะยืนยันเมื่อเช็กอิน'), 10, MUTED)])
    elif not appointment:
        blocks.extend(consent_blocks(consent, lang, paragraph, tr))

    frame = partial(document_frame, lang=lang, theme=theme)
    doc.build(blocks, onFirstPage=frame, onLaterPages=frame)
    output.seek(0)
    return output


def consent_blocks(consent, lang, paragraph, tr):
    terms = consent_terms(consent, lang)
    blocks = [PageBreak(), paragraph(terms['title'], 21, BROWN, 5),
               paragraph(terms['business'], 12, TEAL, 3), paragraph(terms['intro'], 10, MUTED, 10)]
    if not consent:
        blocks.append(paragraph(tr('เงื่อนไขปัจจุบัน'), 10, MUTED, 8))
    def section_blocks(sections):
        content = []
        for section in sections:
            content.append(paragraph(section['heading'], 14, BROWN, 5))
            content.extend(paragraph(f'{index}. {item}', 9.5, INK, 2, leading=13)
                           for index, item in enumerate(section['items'], 1))
            content.append(Spacer(1, 5))
        return content

    blocks.extend(section_blocks(terms['sections']))

    if consent:
        signed = datetime.fromisoformat(consent['signed_at'])
        blocks.append(KeepTogether([
            paragraph(tr('การรับทราบของผู้ฝากและลายเซ็น'), 15, BROWN, 5),
            paragraph(tr('ผู้ฝากรับทราบเงื่อนไขการฝากเลี้ยงข้างต้นแล้ว'), 11, TEAL, 3),
            paragraph(f"{tr('ชื่อผู้ฝาก')}  {consent['customer_name']}", after=3),
            paragraph(f"{tr('ภาษาที่ลงลายเซ็น')}: {tr('ไทย') if consent['signed_language'] == 'th' else tr('อังกฤษ')}", after=3),
            paragraph(f"{tr('ลงลายเซ็นวันที่')} {display_date(signed.date(), lang)} {tr('เวลา')} {signed:%H:%M} {tr('น.')}", after=6),
            Signature(consent['strokes']),
        ]))
    else:
        blocks.extend([paragraph(tr('การรับทราบของผู้ฝากและลายเซ็น'), 15, BROWN, 5),
                       paragraph(tr('รายการนี้ยังไม่มีข้อมูลการรับทราบหรือลายเซ็นที่บันทึกไว้'), 11, MUTED)])
    updated = updated_term_sections(consent, lang)
    if updated:
        blocks.extend([Spacer(1, 12), KeepTogether([
            paragraph(tr('เงื่อนไขปัจจุบันที่เพิ่มหลังลงลายเซ็น'), 15, BROWN, 5),
            *section_blocks(updated),
        ])])
    return blocks
