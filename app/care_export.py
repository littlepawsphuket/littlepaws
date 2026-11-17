from io import BytesIO
from itertools import groupby

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.appointment_image import render_card_png
from app.export_dog_photo import DogThumbnail
from app.export_emoji import emoji_markup
from app.export_theme import THEME_STYLES
from app.i18n import display_date, translate
from app.photo_orientation import upright_jpeg
from app.stay_pdf import FONT, FONT_BOLD, FONT_LOCK, LOGO, draw_brand_slogan, register_thai_font


class ActivityPhoto(Image):
    def __init__(self, attachment, width, height, border):
        super().__init__(BytesIO(upright_jpeg(attachment)), width=width, height=height, kind='proportional')
        self.border = border

    def draw(self):
        canvas = self.canv
        width, height = self.drawWidth, self.drawHeight
        radius = min(10, width / 4, height / 4)
        canvas.saveState()
        outline = canvas.beginPath()
        outline.roundRect(0, 0, width, height, radius)
        canvas.clipPath(outline, stroke=0, fill=0)
        super().draw()
        canvas.restoreState()
        canvas.saveState()
        canvas.setStrokeColor(self.border)
        canvas.setLineWidth(.9)
        canvas.roundRect(0, 0, width, height, radius, stroke=1, fill=0)
        canvas.restoreState()


class ActivityCard(Flowable):
    def __init__(self, content, tint):
        super().__init__()
        self.content = content
        self.tint = tint
        self.spaceAfter = 8

    def wrap(self, width, height):
        self.width = width
        _, content_height = self.content.wrap(width - 24, height)
        self.height = content_height + 22
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        canvas.setFillColor(colors.white)
        canvas.setStrokeColor(self.tint)
        canvas.setLineWidth(1)
        canvas.roundRect(.5, .5, self.width-1, self.height-1, 14, stroke=1, fill=1)
        self.content.drawOn(canvas, 12, 11)


def build_care_export(dog, events, photos, lang, theme, format, today, scope, activity_title):
    with FONT_LOCK:
        register_thai_font()
        output = draw_care_document(dog, events, photos, lang, theme, format, today, scope, activity_title)
    return render_card_png(output.getvalue()) if format == 'png' else output


def draw_care_document(dog, events, photos, lang, theme, format, today, scope, activity_title):
    style = THEME_STYLES.get(theme)
    accent = colors.HexColor(style.dark if style else '#12666A')
    paper = colors.HexColor(style.paper if style else '#F4F8F5')
    tint = colors.HexColor(style.tint if style else '#DDEFE9')
    ink = colors.HexColor('#203534')
    muted = colors.HexColor('#415D59')
    width, height = A4
    margin = 23
    inner = width - 2 * margin - 12
    output = BytesIO()

    def tr(message):
        return translate(message, lang)

    def paragraph(value, size=15, *, bold=False, color=ink, after=0, before=0, next_block=False):
        text_style = ParagraphStyle('care', fontName=FONT_BOLD if bold else FONT, fontSize=size,
                                    leading=size*1.30, textColor=color, shaping=True,
                                    spaceAfter=after, spaceBefore=before, keepWithNext=next_block)
        return Paragraph(emoji_markup(value, size), text_style)

    days = [(day, list(entries)) for day, entries in groupby(events, lambda event: event['recorded_at'][:10])]
    subtitle = display_date(today, lang)
    if scope == 'all' and days:
        subtitle = display_date(days[-1][0], lang)
        if len(days) > 1:
            subtitle += ' – ' + display_date(days[0][0], lang)
    profile = dog['profile']
    sex = {'male': 'เพศผู้', 'female': 'เพศเมีย'}.get(profile.get('gender'))
    facts = [profile.get('breed'), tr(sex) if sex else '', tr(dog['size_label'])]
    if profile.get('birth_date'):
        facts.append(f"{dog['age_years']} {tr('ปี')} {dog['age_months']} {tr('เดือน')}")
    intro = [
        paragraph(tr('สรุปกิจกรรมของน้อง'), 14, bold=True, color=accent),
        paragraph(dog['name'], 34, bold=True),
    ]
    if dog.get('owner'):
        intro.append(paragraph(f"{tr('เจ้าของ')} · {dog['owner']}", 16, bold=True, color=accent))
    if any(facts):
        intro.append(paragraph(' · '.join(filter(None, facts)), 13, color=muted))
    intro.append(paragraph(subtitle, 13, color=muted))
    profile_card = Table([[DogThumbnail(dog['profile_photo'], 76), intro]], colWidths=[100, inner-100])
    profile_card.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),tint), ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LEFTPADDING',(0,0),(-1,-1),12), ('RIGHTPADDING',(0,0),(-1,-1),12),
        ('TOPPADDING',(0,0),(-1,-1),8), ('BOTTOMPADDING',(0,0),(-1,-1),8),
    ]))
    blocks = [profile_card, Spacer(1, 8)]
    if not days:
        blocks.append(paragraph(tr('ยังไม่มีกิจกรรมในวันนี้' if scope == 'today' else 'ยังไม่มีบันทึกกิจกรรม'), color=muted))
    for day, entries in days:
        blocks.append(paragraph(display_date(day, lang), 20, bold=True, color=accent,
                                before=7, after=7, next_block=True))
        for event in entries:
            title = paragraph(tr(activity_title(event)), 19, bold=True)
            clock = paragraph(event['recorded_at'][11:16], 15, bold=True, color=accent)
            content_width = inner-24
            content = [[clock, title]]
            if event['note']:
                content.append([paragraph(event['note'], color=muted), ''])
            attachments = photos.get(event['id'], ())
            if attachments:
                columns = min(len(attachments), 2)
                cell_width = content_width / columns
                if columns == 1:
                    photo_height = 420
                else:
                    photo_height = 220
                images = []
                for attachment in attachments:
                    images.append(ActivityPhoto(attachment, cell_width-9, photo_height, tint))
                rows = [images[i:i+columns] for i in range(0,len(images),columns)]
                if len(rows[-1]) < columns:
                    rows[-1].append('')
                gallery = Table(rows, colWidths=[cell_width]*columns, hAlign='LEFT')
                gallery.setStyle(TableStyle([
                    ('VALIGN',(0,0),(-1,-1),'MIDDLE'), ('ALIGN',(0,0),(-1,-1),'LEFT'),
                    ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),0),
                ]))
                content.append([gallery, ''])
            card = Table(content, colWidths=[62, content_width-62])
            commands = [
                ('BACKGROUND',(0,0),(0,0),tint), ('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),13),
                ('LEFTPADDING',(0,0),(0,0),6), ('LEFTPADDING',(1,0),(1,0),8),
                ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2),
            ]
            commands.extend(('SPAN',(0,row),(1,row)) for row in range(1,len(content)))
            card.setStyle(TableStyle(commands))
            blocks.append(ActivityCard(card, tint))

    if format == 'png':
        height = max(285, 116 + sum(block.wrap(inner,14000)[1] + block.getSpaceBefore() + block.getSpaceAfter()
                                    for block in blocks))
        if height > 14000:
            raise ValueError('Image too long')

    document = SimpleDocTemplate(output, pagesize=(width,height), leftMargin=margin, rightMargin=margin,
                                 topMargin=55,bottomMargin=43, title='Little Paws Activity Update')

    def frame(canvas, doc):
        canvas.setFillColor(paper)
        canvas.rect(0,0,width,height,fill=1,stroke=0)
        canvas.drawImage(ImageReader(str(LOGO)),margin+6,height-46,31,31,mask='auto',preserveAspectRatio=True)
        canvas.setFillColor(accent)
        canvas.setFont(FONT_BOLD,16)
        canvas.drawString(margin+45,height-34,'Little Paws Homestay Phuket')
        draw_brand_slogan(canvas,width/2,12)
        if format == 'pdf':
            canvas.setFont(FONT,9)
            canvas.setFillColor(muted)
            canvas.drawRightString(width-margin,9,str(doc.page))

    document.build(blocks,onFirstPage=frame,onLaterPages=frame)
    if format == 'png' and document.page != 1:
        raise ValueError('Image too long')
    output.seek(0)
    return output
