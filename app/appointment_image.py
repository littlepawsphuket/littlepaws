from io import BytesIO
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

from app.export_theme import THEME_STYLES, draw_mascots, draw_motif
from app.export_dog_photo import dog_thumbnail, draw_dog_thumbnail
from app.i18n import display_date, display_payment_datetime, stay_duration, translate
from app.stay_pdf import ADDRESS, BROWN, CREAM, FONT, FONT_BOLD, FONT_LOCK, INK, LINE, LOGO, MUTED, TEAL, draw_brand_slogan, register_thai_font


WIDTH = 1080
MARGIN = 54
CONTENT = WIDTH - 2*MARGIN
PANEL_PADDING = 36
TICKET_DARK = colors.HexColor('#103C42')
TICKET_LIGHT = colors.HexColor('#267C77')
TICKET_TEXT = colors.HexColor('#D5ECE4')
GOLD = colors.HexColor('#F6D58C')


def build_booking_image(booking, dogs, status, lang, *, appointment, receipt=False, theme="classic"):
    with FONT_LOCK:
        register_thai_font()
        pdf = _draw_card(dict(booking), dogs, status, lang, appointment, receipt, theme)
    return render_card_png(pdf)


def render_card_png(pdf):
    with TemporaryDirectory(prefix='little-paws-card-') as directory:
        source = Path(directory) / 'card.pdf'
        image = Path(directory) / 'card.png'
        source.write_bytes(pdf)
        subprocess.run(['/usr/bin/sips', '-s', 'format', 'png', str(source), '--out', str(image)],
                       check=True, capture_output=True, timeout=20)
        return BytesIO(image.read_bytes())


def _draw_card(booking, dogs, status, lang, appointment, receipt, theme):
    theme_style = THEME_STYLES.get(theme)
    paper = colors.HexColor(theme_style.paper) if theme_style else CREAM
    dark = colors.HexColor(theme_style.dark) if theme_style else TICKET_DARK
    light = colors.HexColor(theme_style.light) if theme_style else TICKET_LIGHT

    def tr(message):
        return translate(message, lang)

    def money(amount):
        return f'฿{amount:,.2f}'

    def label(value, width, size=26, color=INK, alignment=0, *, bold=False):
        style = ParagraphStyle('card', fontName=FONT_BOLD if bold else FONT, fontSize=size, leading=size+8,
                               textColor=color, alignment=alignment, shaping=True)
        item = Paragraph(escape(str(value)).replace('\n', '<br/>'), style)
        _, height = item.wrap(width, 12000)
        return item, height

    inner = CONTENT-2*PANEL_PADDING
    title = label(tr('ใบรับมัดจำ' if receipt else 'ใบยืนยันการจอง' if appointment else 'สรุปการรับฝาก'),
                  inner, 50, colors.white, bold=True)
    badge_text = tr('ได้รับมัดจำแล้ว') if receipt else tr(status)
    badge_width = min(inner, max(128, pdfmetrics.stringWidth(badge_text, FONT_BOLD, 22)+40))
    badge = label(badge_text, badge_width-28, 22, TICKET_DARK, TA_CENTER, bold=True)
    owner = label(booking['customer'], inner, 32, colors.white, bold=True)
    contact = label(booking['contact'], inner, 24, TICKET_TEXT) if booking['contact'] else None
    reference_parts = []
    if receipt:
        reference_parts.append(f"DEP-{booking['payments'][0]['id']}")
    if not appointment:
        reference_parts.append(booking.get('stay_number') or f"#{booking['id']}")
    if booking.get('booking_number'):
        reference_parts.append(booking['booking_number'])
    reference = label(' / '.join(reference_parts) or f"#{booking['id']}", inner, 24, TICKET_TEXT, bold=True)
    dates_x = 155
    date_width = (inner-dates_x-24)/2
    arrival = label(display_date(booking['checkin'], lang), date_width, 37, colors.white, bold=True)
    departure = label(display_date(booking['checkout'], lang), date_width, 37, colors.white, bold=True)
    date_height = max(arrival[1], departure[1])
    focus_day = booking['payments'][0]['occurred_on'] if receipt else booking['checkout'] if not appointment else booking['checkin']
    day_box_label = label(tr('วันที่รับชำระ' if receipt else 'วันรับกลับ' if not appointment else 'วันเข้าพัก'),
                          112, 17, TICKET_TEXT, TA_CENTER)
    day_box_number = label(str(int(focus_day[-2:])), 112, 42, colors.white, TA_CENTER, bold=True)
    day_box_month = label(display_date(focus_day, lang).split(' ', 1)[-1], 112, 16, TICKET_TEXT, TA_CENTER)
    receipt_amount = (label(f"{tr('ยอดมัดจำที่ได้รับ')}  {money(booking['payments'][0]['amount'])}",
                            inner-dates_x, 38, colors.white, bold=True) if receipt else None)
    date_block_height = max(112, date_height+67+(receipt_amount[1]+5 if receipt_amount else 0))
    header_height = title[1]+badge[1]+27+date_block_height+36
    footer_height = reference[1]+owner[1]+(contact[1]+4 if contact else 0)+69
    ticket_height = header_height+footer_height

    dog_rows = []
    photo_size = 76
    name_offset = photo_size + 18
    amount_width = 220
    name_width = inner-name_offset-amount_width-16
    nights = booking['charged_nights']
    quote_pending = appointment and not dogs
    rate_unit = tr({'daycare':'/ วัน','monthly':'/ เดือน'}.get(booking.get('service_type'), '/ คืน'))
    for dog in dogs:
        rate = dog['nightly_rate_cents']
        quote_pending |= appointment and rate is None
        name = label(dog['name'], name_width, 29)
        rate_label = label((tr('รอระบุราคา') if appointment else '—') if rate is None else f"{money(rate/100)} {rate_unit}",
                           name_width, 21, MUTED)
        amount = label('—' if rate is None else money(rate*nights/100), amount_width, 22, MUTED, TA_RIGHT)
        row_height = max(photo_size, name[1]+rate_label[1]+4, amount[1])+20
        dog_rows.append((dog_thumbnail(dog['photo']), name, rate_label, amount, row_height))

    note = label(booking['note'], inner, 25) if booking['note'] else None
    contact_line = label(ADDRESS[lang][-1], CONTENT, 23, MUTED)
    dog_height = 32+36+sum(row[-1] for row in dog_rows)+16
    estimate = tr('รอระบุราคา') if quote_pending else money(booking['agreed_total'])
    discount = booking['discount_cents']/100
    total_title = tr('ยอดสุทธิโดยประมาณ' if appointment else 'ยอดสุทธิ')
    prices = label(f"{total_title}  {estimate}", inner, 34, TEAL, bold=True)
    payment_caption = label(f"{tr('ส่วนลด')}  {money(discount)}", inner, 23, MUTED)
    if rounding := booking.get('rounding_cents'):
        payment_caption = label(f"{tr('ส่วนลด')}  {money(discount)} · {tr('ปัดเศษสตางค์ทิ้ง')}  {money(rounding/100)}",
                                inner, 23, MUTED)
    payments = booking.get('payments', [])
    payment_lines = []
    if receipt:
        deposit = payments[0]
        balance = booking['receipt_balance']
        balance_label = 'ยอดคงเหลือ' if booking['stay_id'] else 'ยอดคงเหลือที่ต้องชำระวันเข้าพัก'
        prices = label(f"{tr(balance_label)}  {money(balance) if balance is not None else tr('รอระบุราคา')}",
                       inner, 32, TEAL, bold=True)
        payment_caption = label(f"{tr('วันที่รับชำระ')}  {display_payment_datetime(deposit, lang)}",
                                inner, 24, MUTED)
    elif payments or booking.get('payment_tracking'):
        payment_lines.append(label(tr('ประวัติการชำระเงิน'), inner, 27, BROWN))
        for index, payment in enumerate(payments, 1):
            payment_lines.append(label(f"{index}. {display_payment_datetime(payment, lang)} · "
                                       f"{tr(payment['label'])} · {money(payment['amount'])}", inner, 23))
        if not payments:
            payment_lines.append(label(tr('ยังไม่มีการชำระเงิน'), inner, 23, MUTED))
        received = sum(payment['amount'] for payment in payments)
        summary = f"{tr('ชำระแล้ว')}  {money(received)}"
        if not quote_pending or booking.get('payment_tracking'):
            balance = max(0, booking.get('payment_total', booking['agreed_total'])-received)
            summary += f"  ·  {tr('ยอดคงเหลือ')}  {money(balance)}"
        payment_lines.append(label(summary, inner, 24, TEAL))
    payment_height = sum(line[1]+5 for line in payment_lines) + (22 if payment_lines else 0)
    note_height = 54+note[1] if note else 0
    payment_panel_height = prices[1]+payment_caption[1]+payment_height+55
    height = 152+ticket_height+24+dog_height+24+payment_panel_height+note_height+148
    if height > 12000:
        raise ValueError('Appointment is too long for a chat image')

    output = BytesIO()
    canvas = Canvas(output, pagesize=(WIDTH, height))

    def panel(top, h, fill=colors.white):
        canvas.setFillColor(fill)
        canvas.roundRect(MARGIN, height-top-h, CONTENT, h, 30, stroke=0, fill=1)

    def place(item, x, top):
        paragraph, h = item
        paragraph.drawOn(canvas, x, height-top-h)

    canvas.setFillColor(paper)
    canvas.rect(0, 0, WIDTH, height, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height-13, WIDTH, 13, stroke=0, fill=1)
    canvas.drawImage(ImageReader(str(LOGO)), MARGIN, height-145, width=108, height=108,
                     preserveAspectRatio=True, mask='auto')
    canvas.setFillColor(TEAL)
    canvas.setFont(FONT_BOLD, 32)
    canvas.drawString(MARGIN+124, height-86, 'Little Paws Homestay Phuket')
    canvas.setFont(FONT, 23)
    canvas.drawString(MARGIN+124, height-119, 'Management System')
    if theme_style:
        draw_mascots(canvas, theme, WIDTH-MARGIN-244, height-132, 237, 115)
        draw_motif(canvas, theme_style, WIDTH-MARGIN-250, height-55, 21)
        draw_motif(canvas, theme_style, WIDTH-MARGIN-12, height-34, 15)
    top = 152
    x = MARGIN+PANEL_PADDING
    ticket_y = height-top-ticket_height
    canvas.setFillColor(colors.HexColor('#DDD7C8'))
    canvas.roundRect(MARGIN+3, ticket_y-10, CONTENT, ticket_height, 34, stroke=0, fill=1)
    canvas.saveState()
    clip = canvas.beginPath()
    clip.roundRect(MARGIN, ticket_y, CONTENT, ticket_height, 34)
    canvas.clipPath(clip, stroke=0, fill=0)
    canvas.linearGradient(MARGIN, ticket_y, WIDTH-MARGIN, height-top,
                          [dark, light], extend=True)
    canvas.restoreState()
    cursor = top+22
    place(title, x, cursor)
    cursor += title[1]+4
    canvas.setFillColor(colors.HexColor(theme_style.accent) if theme_style else GOLD)
    canvas.roundRect(x, height-cursor-badge[1]-7, badge_width, badge[1]+7, 18, stroke=0, fill=1)
    place(badge, x+14, cursor+2)
    cursor += badge[1]+13
    canvas.setFillColor(colors.HexColor('#32686D'))
    canvas.roundRect(x, height-cursor-112, 128, 112, 18, stroke=0, fill=1)
    place(day_box_label, x+8, cursor+9)
    place(day_box_number, x+8, cursor+29)
    place(day_box_month, x+8, cursor+79)
    if receipt_amount:
        place(receipt_amount, x+dates_x, cursor)
        cursor += receipt_amount[1]+5
    for offset, caption, value in ((0, 'วันเข้าพัก', arrival), (date_width+24, 'วันรับกลับ', departure)):
        date_x = x+dates_x+offset
        place(label(tr(caption), date_width, 22, TICKET_TEXT), date_x, cursor)
        place(value, date_x, cursor+29)
    service = booking.get('service_type')
    duration = stay_duration(nights, service, lang)
    duration_label = tr('จำนวนเดือน' if service == 'monthly' else 'จำนวนวัน')
    place(label(f"{duration_label}  {duration}", inner-dates_x, 22, TICKET_TEXT),
          x+dates_x, cursor+date_height+33)
    tear_top = top+header_height
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#79A4A3'))
    canvas.setDash(7, 6)
    canvas.line(MARGIN+14, height-tear_top, WIDTH-MARGIN-14, height-tear_top)
    canvas.restoreState()
    canvas.setFillColor(paper)
    for edge in (MARGIN, WIDTH-MARGIN):
        canvas.circle(edge, height-tear_top, 15, stroke=0, fill=1)
    cursor = tear_top+19
    place(reference, x, cursor)
    cursor += reference[1]+5
    place(label(tr('ชื่อลูกค้า'), inner, 20, TICKET_TEXT), x, cursor)
    cursor += 25
    place(owner, x, cursor)
    if contact:
        place(contact, x, cursor+owner[1]+4)
    top += ticket_height+24

    panel(top, dog_height)
    place(label(tr('สุนัขที่จอง' if appointment else 'สุนัขที่รับฝาก'), inner, 27, BROWN), x, top+19)
    cursor = top+62
    for photo, name, rate_label, amount, row_height in dog_rows:
        body_height = row_height-20
        draw_dog_thumbnail(canvas, photo, x, height-cursor-(body_height+photo_size)/2, photo_size)
        text_top = cursor+(body_height-name[1]-rate_label[1]-4)/2
        place(name, x+name_offset, text_top)
        place(rate_label, x+name_offset, text_top+name[1]+4)
        place(amount, x+inner-amount_width, cursor+(body_height-amount[1])/2)
        cursor += row_height
    top += dog_height+24

    panel(top, payment_panel_height, colors.HexColor(theme_style.tint) if theme_style else colors.white)
    cursor = top+18
    place(prices, x, cursor)
    cursor += prices[1]+3
    place(payment_caption, x, cursor)
    cursor += payment_caption[1]+11
    for line in payment_lines:
        place(line, x, cursor)
        cursor += line[1]+5
    top += payment_panel_height
    if note:
        place(label(tr('หมายเหตุการจอง' if appointment else 'หมายเหตุการเข้าพัก'), inner, 24, BROWN), x, top+19)
        place(note, x, top+50)
        top += note_height
    footer_top = height-128
    place(contact_line, MARGIN, max(top+24, footer_top))
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 84, WIDTH-MARGIN, 84)
    draw_brand_slogan(canvas, WIDTH/2, 19, scale=2.35)
    if theme_style:
        draw_motif(canvas, theme_style, MARGIN+15, 45, 27)
        draw_motif(canvas, theme_style, WIDTH-MARGIN-15, 45, 27)
    canvas.showPage()
    canvas.save()
    return output.getvalue()
