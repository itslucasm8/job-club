"""
Deterministic 88-day + award assessment for Job Club candidates.

The LLM extractor produces a best-guess `eligible88Days` flag from prose, but
prose-only inference gets things wrong on tricky cases (Brunswick VIC 3056 is
a metro suburb that LLMs flag as "regional Victorian work" because it sounds
rural). This module replaces that flag with a postcode-based lookup against
the official Home Affairs lists, and computes the relevant Modern Award
minimum hourly rate so we can flag below-award listings.

Public entry point:
    assess(raw: dict) -> dict
        returns flat verdict to merge into the extract output.

Reads JSON reference data lazily from ./data/ — gracefully degrades to
"unknown" verdicts when files are missing rather than throwing.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger('eligibility')

DATA_DIR = Path(__file__).resolve().parent / 'data'

# Award standard week (hours/week used to convert weekly/annual to hourly).
# 38h is the National Employment Standards default ordinary-hours week.
ORDINARY_HOURS_PER_WEEK = 38.0
WEEKS_PER_YEAR = 52.0


# ─── Reference data loaders ────────────────────────────────────────────────

@lru_cache(maxsize=16)
def _load_json(name: str) -> dict | None:
    path = DATA_DIR / name
    if not path.exists():
        log.warning('reference data missing: %s', name)
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:
        log.error('failed to load %s: %s', name, e)
        return None


def reload_data() -> None:
    """Clear all reference-data caches. Call after a save-reference-data write."""
    _load_json.cache_clear()
    _load_postcodes.cache_clear()


@lru_cache(maxsize=8)
def _load_postcodes(industry: str) -> tuple[set[int], set[str]] | None:
    """Returns (postcode_set, all_state_codes_set) or None if missing."""
    data = _load_json(f'postcodes_{industry}.json')
    if not data or not isinstance(data, dict):
        return None
    states_data = data.get('states', {}) or {}
    codes: set[int] = set()
    all_states: set[str] = set()
    for state, entry in states_data.items():
        if not isinstance(entry, dict):
            continue
        if entry.get('include_all_state'):
            all_states.add(state)
            continue
        for spec in entry.get('postcodes') or []:
            spec = str(spec).strip()
            if not spec:
                continue
            if '-' in spec:
                try:
                    lo, hi = spec.split('-', 1)
                    lo_i, hi_i = int(lo), int(hi)
                    codes.update(range(lo_i, hi_i + 1))
                except ValueError:
                    log.warning('skipping malformed range in %s: %r', industry, spec)
            else:
                try:
                    codes.add(int(spec))
                except ValueError:
                    log.warning('skipping non-numeric postcode in %s: %r', industry, spec)
    return codes, all_states


def _industry_for_category(category: str | None) -> str | None | str:
    """Returns: industry slug, None (not eligible), or 'ambiguous'."""
    if not category:
        return None
    data = _load_json('category_to_industry.json')
    if not data:
        return None
    return (data.get('mapping') or {}).get(category)


def _award_for_category(category: str | None) -> str | None:
    if not category:
        return None
    data = _load_json('category_to_award.json')
    if not data:
        return None
    return (data.get('mapping') or {}).get(category)


def _award_record(award_id: str | None) -> dict | None:
    if not award_id:
        return None
    awards = _load_json('awards.json')
    if not awards or not isinstance(awards, dict):
        return None
    return awards.get(award_id)


# ─── Postcode parsing ──────────────────────────────────────────────────────

# AU postcode is exactly 4 digits, 0200-9999 inclusive.
# We search across location + state + description because extractors
# inconsistently fill these. Standalone 4-digit numbers in description risk
# false positives ("3000 backpackers") so we prefer postcode-near-state matches.
_POSTCODE_RE = re.compile(r'(?<!\d)(\d{4})(?!\d)')
# State-anchored pattern: "VIC 3500", "NSW, 2031", "QLD 4870"
_POSTCODE_AFTER_STATE_RE = re.compile(
    r'\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*[,\s]\s*(\d{4})\b',
    re.IGNORECASE,
)


def parse_postcode(*texts: str | None) -> int | None:
    """Find the most plausible AU postcode in the given text fields.

    Searches in order:
      1. State-anchored "VIC 3500" pattern (highest confidence)
      2. Any standalone 4-digit number in 1000-9999 range (location field only)
    Returns the postcode as int, or None.
    """
    fields = [t for t in texts if t]
    # Pass 1: state-anchored
    for text in fields:
        m = _POSTCODE_AFTER_STATE_RE.search(text)
        if m:
            try:
                pc = int(m.group(1))
                if 200 <= pc <= 9999:
                    return pc
            except ValueError:
                pass
    # Pass 2: any 4-digit in plausible AU range (only first two fields — usually
    # location + state. Description has too many false positives.)
    for text in fields[:2]:
        for m in _POSTCODE_RE.finditer(text):
            try:
                pc = int(m.group(1))
                if 200 <= pc <= 9999:
                    return pc
            except ValueError:
                pass
    return None


# ─── Pay parsing ───────────────────────────────────────────────────────────

# Money number: matches "28", "28.50", "1,200", "80,000", "$24.95"
_MONEY_RE = re.compile(r'\$?\s*([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)')


def _to_float(money_str: str) -> float | None:
    try:
        return float(money_str.replace(',', '').replace('$', '').strip())
    except ValueError:
        return None


def parse_pay_to_hourly(pay: str | None, employment_type: str = 'casual') -> dict[str, Any]:
    """Parse a free-text pay string into a normalised hourly figure.

    Returns {value, kind, raw_value, status, note}:
      kind: 'hourly' | 'weekly' | 'annual' | 'monthly' | 'piece' | 'unknown'
      value: hourly equivalent (float) or None
      raw_value: original numeric in its native unit (e.g. weekly amount)
      status: 'parsed' | 'piece_rate' | 'unparseable' | 'empty'
      note: human-readable French explanation
    """
    if not pay or not pay.strip():
        return {'value': None, 'kind': 'unknown', 'raw_value': None,
                'status': 'empty', 'note': 'Pay vide'}

    p = pay.strip().lower()

    # Piece rate detection — common phrasings
    if any(kw in p for kw in ('piece rate', 'piecework', 'per bin', 'per kg', 'per kilo',
                               'per piece', 'per box', 'per tray', 'per tonne', 'per ton',
                               'au rendement', 'à la pièce', 'au kg', 'au bin')):
        return {'value': None, 'kind': 'piece', 'raw_value': None,
                'status': 'piece_rate',
                'note': 'Pay au piecework — vérifier manuellement vs taux Fair Work piecework'}

    # Pull the lowest numeric (handles ranges like "$25-30/hr" → take 25)
    matches = _MONEY_RE.findall(p)
    if not matches:
        return {'value': None, 'kind': 'unknown', 'raw_value': None,
                'status': 'unparseable', 'note': f'Pay non parseable: "{pay[:60]}"'}
    nums = [_to_float(m) for m in matches]
    nums = [n for n in nums if n is not None and n > 0]
    if not nums:
        return {'value': None, 'kind': 'unknown', 'raw_value': None,
                'status': 'unparseable', 'note': f'Pay non parseable: "{pay[:60]}"'}
    raw_value = min(nums)

    # Period detection
    if any(kw in p for kw in ('/hr', '/hour', 'per hour', 'an hour', 'p/h', 'ph ', 'hourly', 'de l\'heure', 'par heure')):
        kind = 'hourly'
        hourly = raw_value
    elif any(kw in p for kw in ('/wk', '/week', 'per week', 'weekly', 'a week', 'par semaine', 'semaine')):
        kind = 'weekly'
        hourly = raw_value / ORDINARY_HOURS_PER_WEEK
    elif any(kw in p for kw in ('/yr', '/year', 'per annum', 'p.a', 'pa ', 'per year', 'annual', 'année', 'par an')):
        kind = 'annual'
        hourly = raw_value / WEEKS_PER_YEAR / ORDINARY_HOURS_PER_WEEK
    elif any(kw in p for kw in ('/mo', '/month', 'per month', 'monthly', 'par mois')):
        kind = 'monthly'
        hourly = raw_value * 12 / WEEKS_PER_YEAR / ORDINARY_HOURS_PER_WEEK
    elif raw_value < 100:
        # Bare number under 100 — assume hourly (typical AU casual range $20-50)
        kind = 'hourly'
        hourly = raw_value
    elif raw_value < 5000:
        # 100-5000 — likely weekly
        kind = 'weekly'
        hourly = raw_value / ORDINARY_HOURS_PER_WEEK
    else:
        # > 5000 — likely annual
        kind = 'annual'
        hourly = raw_value / WEEKS_PER_YEAR / ORDINARY_HOURS_PER_WEEK

    note = f'Pay "{pay[:50]}" → {hourly:.2f}$/h ({kind})'
    return {'value': round(hourly, 2), 'kind': kind, 'raw_value': raw_value,
            'status': 'parsed', 'note': note}


# ─── 88-day eligibility ────────────────────────────────────────────────────

def compute_88day(category: str | None, postcode: int | None, state: str | None) -> dict[str, Any]:
    """Returns {eligible, reason, confidence, industry}.

    eligible: True | False | None  (None = cannot determine)
    confidence: 'high' | 'medium' | 'low'
    """
    industry = _industry_for_category(category)

    if industry is None:
        return {
            'eligible': False, 'industry': None, 'confidence': 'high',
            'reason': f'Catégorie "{category}" non éligible au 88 jours (pas de specified work)',
        }

    if industry == 'ambiguous':
        return {
            'eligible': None, 'industry': 'ambiguous', 'confidence': 'low',
            'reason': f'Catégorie "{category}" ambiguë — peut être éligible ou non selon le contexte (vérifier manuellement)',
        }

    if not postcode:
        return {
            'eligible': None, 'industry': industry, 'confidence': 'low',
            'reason': f'Postcode introuvable dans le texte — impossible de vérifier l\'éligibilité {industry}',
        }

    loaded = _load_postcodes(industry)
    if loaded is None:
        return {
            'eligible': None, 'industry': industry, 'confidence': 'low',
            'reason': f'Liste postcodes_{industry}.json non disponible — données de référence manquantes',
        }
    codes, all_state_codes = loaded
    if state and state.upper() in all_state_codes:
        return {
            'eligible': True, 'industry': industry, 'confidence': 'high',
            'reason': f'État {state} entièrement éligible pour {industry} (toutes zones)',
        }
    if postcode in codes:
        return {
            'eligible': True, 'industry': industry, 'confidence': 'high',
            'reason': f'Postcode {postcode} dans la liste officielle {industry}',
        }
    return {
        'eligible': False, 'industry': industry, 'confidence': 'high',
        'reason': f'Postcode {postcode} pas dans la liste officielle {industry} (zone non régionale au sens 88 jours)',
    }


# ─── Award lookup + comparison ─────────────────────────────────────────────

def compute_award(category: str | None, employment_type: str = 'casual') -> dict[str, Any]:
    """Returns {award_id, award_name, min_hourly, min_casual_hourly, status, note}."""
    award_id = _award_for_category(category)
    if not award_id:
        return {'award_id': None, 'award_name': None,
                'min_hourly': None, 'min_casual_hourly': None,
                'status': 'no_award', 'note': f'Aucun award mappé pour catégorie "{category}"'}
    record = _award_record(award_id)
    if not record:
        return {'award_id': award_id, 'award_name': None,
                'min_hourly': None, 'min_casual_hourly': None,
                'status': 'award_data_missing',
                'note': f'Award {award_id} mappé mais données absentes dans awards.json'}
    return {
        'award_id': award_id,
        'award_name': record.get('award_name'),
        'min_hourly': record.get('min_full_time_hourly'),
        'min_casual_hourly': record.get('min_casual_hourly'),
        'effective_from': record.get('effective_from'),
        'has_piecework': record.get('has_piecework', False),
        'status': 'ok',
        'note': '',
    }


def compare_pay(pay_parse: dict[str, Any], award: dict[str, Any], employment_type: str) -> dict[str, Any]:
    """Compare parsed pay against award minimum. Returns {status, gap, gap_pct, note}."""
    is_casual = (employment_type or '').lower() == 'casual'
    min_hourly = award.get('min_casual_hourly') if is_casual else award.get('min_hourly')

    if pay_parse.get('status') == 'piece_rate':
        return {'status': 'piece_rate', 'gap': None, 'gap_pct': None,
                'min_used': min_hourly,
                'note': 'Piecework — comparaison vs award impossible automatiquement'}

    actual = pay_parse.get('value')
    if actual is None or min_hourly is None:
        return {'status': 'unknown', 'gap': None, 'gap_pct': None,
                'min_used': min_hourly,
                'note': 'Comparaison impossible (pay ou minimum award absent)'}

    gap = round(actual - min_hourly, 2)
    gap_pct = round(gap / min_hourly * 100, 1) if min_hourly > 0 else None

    if actual < min_hourly - 0.01:
        status = 'below'
        note = f'⚠ Pay {actual}$/h < minimum award {min_hourly}$/h ({"casual" if is_casual else "FT"}) — écart {gap}$/h ({gap_pct}%)'
    elif actual <= min_hourly + 0.50:
        status = 'at'
        note = f'Pay {actual}$/h ≈ minimum award {min_hourly}$/h ({"casual" if is_casual else "FT"})'
    else:
        status = 'above'
        note = f'Pay {actual}$/h > minimum award {min_hourly}$/h (+{gap}$/h, +{gap_pct}%)'

    return {'status': status, 'gap': gap, 'gap_pct': gap_pct,
            'min_used': min_hourly, 'note': note}


# ─── Public entry point ────────────────────────────────────────────────────

def assess(raw: dict[str, Any]) -> dict[str, Any]:
    """Full deterministic assessment.

    Inputs the LLM-extracted dict, returns fields to merge into it:
      eligibility_88_days: bool | None
      eligibility_reason: str
      eligibility_confidence: 'high' | 'medium' | 'low'
      postcode: int | None
      industry: str | None
      award_id: str | None
      award_name: str | None
      award_min_hourly: float | None
      award_min_casual_hourly: float | None
      pay_parsed_hourly: float | None
      pay_kind: str
      pay_status: 'above' | 'at' | 'below' | 'piece_rate' | 'unknown'
      pay_gap: float | None
      extraction_notes: list[str]
    """
    notes: list[str] = []

    category = raw.get('category')
    state = raw.get('state')
    location = raw.get('location') or ''
    description = raw.get('description') or ''
    employment_type = raw.get('type') or 'casual'
    pay = raw.get('pay') or ''

    postcode = parse_postcode(location, state, description)
    if not postcode:
        notes.append(f'Aucun postcode détecté dans location/state — éligibilité 88 jours non vérifiable. Location="{location[:60]}"')

    elig = compute_88day(category, postcode, state)
    notes.append(f'88j: {elig["reason"]}')

    award = compute_award(category, employment_type)
    if award['status'] == 'no_award':
        notes.append(award['note'])
    elif award['status'] == 'award_data_missing':
        notes.append(f'⚠ {award["note"]} — données de référence manquantes, lance le seeding')

    pay_parse = parse_pay_to_hourly(pay, employment_type)
    if pay_parse['status'] == 'empty':
        notes.append('Pay non spécifié dans l\'annonce')
    elif pay_parse['status'] == 'unparseable':
        notes.append(pay_parse['note'])
    else:
        notes.append(pay_parse['note'])

    pay_cmp = compare_pay(pay_parse, award, employment_type)
    if pay_cmp['status'] != 'unknown':
        notes.append(pay_cmp['note'])

    if award.get('has_piecework') and pay_parse.get('kind') == 'piece':
        notes.append(f'Award {award.get("award_id")} a des taux piecework spécifiques — vérifier manuellement vs schedule officiel')

    return {
        'eligibility_88_days': elig['eligible'],
        'eligibility_reason': elig['reason'],
        'eligibility_confidence': elig['confidence'],
        'postcode': postcode,
        'industry': elig['industry'],
        'award_id': award.get('award_id'),
        'award_name': award.get('award_name'),
        'award_min_hourly': award.get('min_hourly'),
        'award_min_casual_hourly': award.get('min_casual_hourly'),
        'award_effective_from': award.get('effective_from'),
        'pay_parsed_hourly': pay_parse.get('value'),
        'pay_kind': pay_parse.get('kind'),
        'pay_status': pay_cmp['status'],
        'pay_gap': pay_cmp.get('gap'),
        'pay_gap_pct': pay_cmp.get('gap_pct'),
        'extraction_notes': notes,
    }


if __name__ == '__main__':
    # Smoke test
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
    except AttributeError:
        pass
    samples = [
        {'category': 'farm', 'state': 'VIC', 'location': 'Brunswick VIC 3056',
         'pay': '$28/hr', 'type': 'casual', 'description': ''},
        {'category': 'farm', 'state': 'VIC', 'location': 'Mildura VIC 3500',
         'pay': '$24.95/hr', 'type': 'casual', 'description': ''},
        {'category': 'hospitality', 'state': 'NT', 'location': 'Darwin NT 0800',
         'pay': '$1100 per week', 'type': 'full_time', 'description': ''},
        {'category': 'farm', 'state': 'QLD', 'location': 'Bundaberg QLD 4670',
         'pay': 'piece rate per bin', 'type': 'casual', 'description': ''},
        {'category': 'retail', 'state': 'NSW', 'location': 'Sydney NSW 2000',
         'pay': '$22/hr', 'type': 'casual', 'description': ''},
    ]
    for s in samples:
        print('---')
        print('Input:', s)
        print('Output:', json.dumps(assess(s), indent=2, ensure_ascii=False))
