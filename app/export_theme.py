from pathlib import Path
from typing import NamedTuple

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader


STATIC = Path(__file__).with_name('static')


class ExportTheme(NamedTuple):
    dark: str
    light: str
    paper: str
    tint: str
    accent: str
    motif: str


THEME_STYLES = {
    'christmas': ExportTheme('#13453B', '#26705A', '#F2F8F5', '#E1F0E9', '#F8FFFF', 'snow'),
    'valentine': ExportTheme('#722748', '#9A4168', '#FFF4F7', '#FBE3ED', '#F6BACF', 'heart'),
    'halloween': ExportTheme('#39274F', '#6A4077', '#FFF5E8', '#F8E4CE', '#FFC16B', 'pumpkin'),
    'songkran': ExportTheme('#154E75', '#227796', '#EFFBFD', '#DDF2F8', '#A9E8F7', 'water'),
    'buddhist': ExportTheme('#68401F', '#915E32', '#FFF9ED', '#F8EACD', '#FFE0A1', 'lotus'),
    'japan': ExportTheme('#722E48', '#984966', '#FFF5F7', '#F9E4EC', '#FFC7DC', 'sakura'),
}


def draw_mascots(canvas, theme, x, y, width, height):
    canvas.drawImage(ImageReader(str(STATIC / f'mascot-{theme}.webp')), x, y, width, height,
                     preserveAspectRatio=True, mask='auto')


def draw_motif(canvas, style, x, y, size):
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(size / 20, size / 20)
    canvas.setFillColor(HexColor(style.accent))
    if style.motif == 'snow':
        canvas.setStrokeColor(HexColor('#B0DDE7'))
        canvas.setLineWidth(1.5)
        for dx, dy in ((0, 9), (8, 4.5), (8, -4.5)):
            canvas.line(-dx, -dy, dx, dy)
        canvas.circle(0, 0, 2, stroke=0, fill=1)
    elif style.motif == 'pumpkin':
        for cx in (-5, 0, 5):
            canvas.ellipse(cx-4, -6, cx+4, 6, stroke=0, fill=1)
        canvas.rect(-1, 5, 2, 4, stroke=0, fill=1)
    elif style.motif == 'sakura':
        for cx, cy in ((0, 5), (-5, 1), (5, 1), (-3, -5), (3, -5)):
            canvas.circle(cx, cy, 4, stroke=0, fill=1)
    else:
        path = canvas.beginPath()
        if style.motif == 'heart':
            path.moveTo(0, -8)
            path.curveTo(-18, 2, -7, 13, 0, 6)
            path.curveTo(7, 13, 18, 2, 0, -8)
        elif style.motif == 'water':
            path.moveTo(0, 10)
            path.curveTo(-3, 4, -11, -1, -6, -6)
            path.curveTo(-1, -12, 12, -6, 5, 2)
            path.lineTo(0, 10)
        else:
            path.moveTo(0, -7)
            path.curveTo(-8, -6, -11, -3, -10, 3)
            path.curveTo(-6, 3, -3, 1, 0, -3)
            path.curveTo(-5, 2, -3, 6, 0, 9)
            path.curveTo(3, 6, 5, 2, 0, -3)
            path.curveTo(3, 1, 6, 3, 10, 3)
            path.curveTo(11, -3, 8, -6, 0, -7)
        path.close()
        canvas.drawPath(path, stroke=0, fill=1)
    canvas.restoreState()
