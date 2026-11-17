"""Refresh Worker terms and intake fields from the Mac application."""
import json
from pathlib import Path

from app.intake import INTAKE_GROUPS
from app.stay_terms import TERMS, TERMS_EN, TERMS_VERSIONS


def contents():
    terms = {'th': TERMS, 'en': TERMS_EN, 'versions': TERMS_VERSIONS}
    intake = [dict(title=title, fields=fields) for title, fields in INTAKE_GROUPS[1:]]
    return ('export default ' + json.dumps(terms, ensure_ascii=False, indent=2) + ';\n'
            + 'export const intakeGroups = ' + json.dumps(intake, ensure_ascii=False, indent=2) + ';\n')


if __name__ == '__main__':
    Path(__file__).with_name('stay_terms.mjs').write_text(contents(), encoding='utf-8')
