from io import BytesIO

from PIL import Image, ImageOps
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable


def dog_thumbnail(photo):
    if photo:
        try:
            with Image.open(BytesIO(photo)) as image:
                return ImageReader(ImageOps.fit(ImageOps.exif_transpose(image).convert('RGB'), (144, 144), Image.Resampling.LANCZOS))
        except (OSError, ValueError):
            pass
    return None


def draw_dog_thumbnail(canvas, photo, x, y, size):
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(size / 48, size / 48)
    boundary = canvas.beginPath()
    boundary.roundRect(0, 0, 48, 48, 9)
    canvas.clipPath(boundary, stroke=0, fill=0)
    if photo is not None:
        canvas.drawImage(photo, 0, 0, width=48, height=48)
    else:
        canvas.setFillColor(HexColor('#F6E7CF'))
        canvas.rect(0, 0, 48, 48, stroke=0, fill=1)
        canvas.setFillColor(HexColor('#A85832'))
        canvas.ellipse(8, 20, 19, 36, stroke=0, fill=1)
        canvas.ellipse(29, 20, 40, 36, stroke=0, fill=1)
        canvas.setFillColor(HexColor('#DF9B5B'))
        canvas.ellipse(13, 13, 35, 36, stroke=0, fill=1)
        canvas.setFillColor(HexColor('#FFF4DF'))
        canvas.ellipse(17, 13, 31, 24, stroke=0, fill=1)
        canvas.setFillColor(HexColor('#432C24'))
        canvas.circle(19.5, 26, 1.35, stroke=0, fill=1)
        canvas.circle(28.5, 26, 1.35, stroke=0, fill=1)
        canvas.ellipse(22, 19, 26, 22, stroke=0, fill=1)
        canvas.setStrokeColor(HexColor('#432C24'))
        canvas.setLineWidth(.8)
        canvas.arc(20.5, 16.5, 24, 20, 180, 180)
        canvas.arc(24, 16.5, 27.5, 20, 180, 180)
    canvas.restoreState()


class DogThumbnail(Flowable):
    def __init__(self, photo, size):
        super().__init__()
        self.photo = dog_thumbnail(photo)
        self.width = self.height = size

    def draw(self):
        draw_dog_thumbnail(self.canv, self.photo, 0, 0, self.width)
