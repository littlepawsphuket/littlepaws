import hashlib
import json

from app.i18n import translate


TERMS = {
    'title': 'เงื่อนไขการฝากเลี้ยงน้องหมา',
    'business': 'Little Paws Homestay Phuket',
    'intro': 'บ้านพักน้องหมาสไตล์โฮมมี่ ดูแลใกล้ชิดเหมือนสมาชิกในครอบครัว',
    'sections': [
        {
            'heading': '1. เงื่อนไขการรับฝาก',
            'items': [
                'น้องหมาต้องมีสุขภาพแข็งแรง ไม่มีโรคติดต่อ',
                'ได้รับวัคซีนพื้นฐานครบถ้วนและยังไม่หมดอายุ รวมถึงวัคซีนพิษสุนัขบ้า',
                'ได้รับการป้องกันเห็บหมัดและถ่ายพยาธิตามความเหมาะสม',
                'ไม่รับน้องหมาที่มีพฤติกรรมก้าวร้าวหรือเสี่ยงทำอันตรายต่อตัวอื่น',
                'ไม่รับน้องหมาเพศเมียที่กำลังอยู่ในช่วงติดสัด',
                'น้องหมาที่มีโรคประจำตัวที่ไม่ติดต่อ สามารถสอบถามเพื่อประเมินการรับฝากเป็นรายกรณี',
                'เจ้าของต้องแจ้งประวัติสุขภาพ ยาประจำตัว อาการแพ้ และพฤติกรรมที่ควรระวังตามความเป็นจริง',
            ],
        },
        {
            'heading': '2. รูปแบบการดูแล',
            'items': [
                'ดูแลแบบ Cage-Free ไม่ขังกรง โดยจัดพื้นที่ให้เหมาะกับน้องหมาแต่ละตัว',
                'มีห้องแอร์สำหรับพักผ่อนและสวนหญ้าสำหรับเดินเล่น',
                'แยกพื้นที่สำหรับน้องหมาที่ไม่เหมาะกับการอยู่รวมกัน',
                'การเล่นร่วมกับน้องหมาตัวอื่นต้องผ่านการประเมินนิสัยและความเข้ากันได้ก่อน',
                'รับจำนวนจำกัดต่อวัน เพื่อให้ดูแลได้ทั่วถึง',
                'อัปเดตรูปภาพและวิดีโอให้เจ้าของทุกวัน',
            ],
        },
        {
            'heading': '3. ความรับผิดชอบกรณีอุบัติเหตุและเจ็บป่วย',
            'items': [
                'อุบัติเหตุ: ผู้รับฝากไม่รับผิดชอบต่ออุบัติเหตุหรือความเสียหายที่ไม่ได้เกิดจากความผิดหรือความประมาทของผู้รับฝาก',
                'การเจ็บป่วย: เจ้าของรับผิดชอบค่ารักษาพยาบาลที่ไม่ได้เกิดจากความผิดของผู้รับฝาก โดยผู้รับฝากจะแจ้งรายละเอียดและขอความยินยอมก่อนดำเนินการ',
                'กรณีฉุกเฉิน: หากไม่สามารถติดต่อเจ้าของได้ ผู้รับฝากสามารถนำส่งสัตวแพทย์ตามความจำเป็น และจะแจ้งเจ้าของโดยเร็วที่สุด',
            ],
        },
    ],
}
def translated_terms(terms, lang):
    return {
        **terms,
        'title': translate(terms['title'], lang),
        'intro': translate(terms['intro'], lang),
        'sections': [
            {'heading': translate(section['heading'], lang),
             'items': [translate(item, lang) for item in section['items']]}
            for section in terms['sections']
        ],
    }


TERMS_SNAPSHOT = json.dumps(TERMS, ensure_ascii=False, separators=(',', ':'))
TERMS_VERSION = hashlib.sha256(TERMS_SNAPSHOT.encode()).hexdigest()


TERMS_EN = translated_terms(TERMS, 'en')
TERMS_EN_SNAPSHOT = json.dumps(TERMS_EN, ensure_ascii=False, separators=(',', ':'))
TERMS_VERSIONS = {'th': TERMS_VERSION,
                  'en': hashlib.sha256((TERMS_SNAPSHOT + TERMS_EN_SNAPSHOT).encode()).hexdigest()}


def consent_terms(consent, lang):
    if not consent:
        return TERMS_EN if lang == 'en' else TERMS
    return consent['terms_en'] if lang == 'en' else consent['terms']


def updated_term_sections(consent, lang):
    if not consent:
        return []
    display = TERMS_EN if lang == 'en' else TERMS
    saved = consent_terms(consent, lang)
    return [section for section in display['sections'] if section not in saved['sections']]


def parse_signature(raw):
    if not raw or len(raw) > 60000:
        return None
    try:
        strokes = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    if not isinstance(strokes, list) or not strokes or len(strokes) > 150:
        return None
    point_count = 0
    has_line = False
    for stroke in strokes:
        if not isinstance(stroke, list) or not stroke:
            return None
        point_count += len(stroke)
        if point_count > 4000:
            return None
        for point in stroke:
            if (not isinstance(point, list) or len(point) != 2
                    or any(type(coordinate) is not int for coordinate in point)
                    or not (0 <= point[0] <= 720 and 0 <= point[1] <= 240)):
                return None
        x, y = stroke[0]
        has_line |= any((px-x)**2 + (py-y)**2 >= 64 for px, py in stroke)
    return strokes if has_line else None
