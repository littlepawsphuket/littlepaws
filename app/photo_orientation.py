from io import BytesIO

from PIL import Image, ImageOps


def upright_jpeg(data):
    """Apply EXIF orientation to the pixels for renderers that ignore the tag."""
    with Image.open(BytesIO(data)) as image:
        if image.getexif().get(274, 1) not in range(2, 9):
            return data
        output = BytesIO()
        ImageOps.exif_transpose(image).convert('RGB').save(output, 'JPEG', quality=88)
        return output.getvalue()
