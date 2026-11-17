import re
from base64 import b64encode
from functools import lru_cache
from io import BytesIO
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont

# Keep ordinary punctuation in the text font unless an emoji selector is present.
EMOJI_BASE = r'(?:[\U0001F300-\U0001FAFF]|[\u2600-\u27BF]\uFE0F|[❤⭐☀☁☕✅✨])'
EMOJI_UNIT = rf'{EMOJI_BASE}\uFE0F?[\U0001F3FB-\U0001F3FF]?'
EMOJI = re.compile(rf'[\U0001F1E6-\U0001F1FF]{{2}}|[0-9#*]\uFE0F?\u20E3|{EMOJI_UNIT}(?:\u200D{EMOJI_UNIT})*')


@lru_cache(maxsize=1)
def emoji_font():
    return ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', 64)


@lru_cache(maxsize=256)
def emoji_image(value):
    font = emoji_font()
    left, top, right, bottom = font.getbbox(value)
    image = Image.new('RGBA', (max(1, right-left), max(1, bottom-top)))
    ImageDraw.Draw(image).text((-left, -top), value, font=font, embedded_color=True)
    output = BytesIO()
    image.save(output, 'PNG')
    return b64encode(output.getvalue()).decode('ascii'), image.width / image.height


def emoji_markup(value, size):
    chunks = []
    offset = 0
    for match in EMOJI.finditer(value):
        chunks.append(escape(value[offset:match.start()]))
        try:
            data, aspect = emoji_image(match[0])
            chunks.append(f'<img src="data:image/png;base64,{data}" width="{size*aspect:.2f}" '
                          f'height="{size}" valign="-2"/>')
        except (OSError, ValueError):
            chunks.append(escape(match[0]))
        offset = match.end()
    chunks.append(escape(value[offset:]))
    return ''.join(chunks).replace('\n','<br/>')
