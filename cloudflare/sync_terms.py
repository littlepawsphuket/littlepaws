"""Refresh Worker terms from the Mac application's bilingual terms."""
import json
from pathlib import Path

from app.stay_terms import TERMS, TERMS_EN, TERMS_VERSIONS


def contents():
    terms = {'th': TERMS, 'en': TERMS_EN, 'versions': TERMS_VERSIONS}
    return 'export default ' + json.dumps(terms, ensure_ascii=False, indent=2) + ';\n'


if __name__ == '__main__':
    Path(__file__).with_name('stay_terms.mjs').write_text(contents(), encoding='utf-8')
