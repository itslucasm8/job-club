"""
Wraps the `claude` CLI for one-shot, non-interactive prompts.

Job Club's two LLM tasks:
  1. extract_job — turn a fetched job page (text) into structured fields
  2. classify_candidate — score a candidate for backpacker-suitability,
     88-day signals, locals-only red flags, scam flags, etc.

Both use Haiku for cost efficiency. Sonnet/Opus would be overkill for
extraction/classification at this volume.
"""
import json
import logging
import re
import shutil
import subprocess
from typing import Any

import eligibility

log = logging.getLogger('drafter')

CLAUDE_CMD = shutil.which('claude') or '/usr/local/bin/claude'

EXTRACT_MODEL = 'claude-haiku-4-5'
CLASSIFY_MODEL = 'claude-haiku-4-5'
# Reference data parsing is one-off, not in the hot path; use Sonnet for higher
# fidelity since we're parsing dense regulatory pages (postcode ranges, pay
# tables) into a strict schema.
REFDATA_MODEL = 'claude-sonnet-4-6'

VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other']
VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']

EXTRACT_SYSTEM = """You extract structured job listing fields from raw page text scraped from a careers page or classified ad.

Target audience: Working Holiday Visa (WHV) backpackers in Australia. Job Club's schema:
- 9 categories: farm, hospitality, construction, retail, cleaning, events, animals, transport, other
- 8 states: QLD, NSW, VIC, SA, WA, TAS, NT, ACT
- type: casual | full_time | part_time | contract

Rules:
- Preserve the original wording of the description, but strip nav menus, footer boilerplate, cookie banners, "apply now" buttons.
- Keep contact info (email, phone, application instructions) in the description verbatim — backpackers reach out directly.
- If multiple jobs are on the page, return the FIRST clearly-defined job.
- If you cannot find a clear job listing, set extraction_failed=true and explain in failure_reason.
- For state, infer from location/postcode if not explicit.
- For category, pick the closest fit; "other" only as last resort.
- For type, default to "casual" if unclear.
- pay: capture amount + period if shown ("$28/hr", "piece rate", "$25-30/hr"); empty string if not stated.
- applyUrl: direct apply link if present, else empty string.

Respond with ONLY a JSON object — no preamble, no markdown fencing, no commentary. Use this exact shape:
{
  "extraction_failed": false,
  "failure_reason": "",
  "title": "...",
  "company": "...",
  "state": "QLD" | "NSW" | "VIC" | "SA" | "WA" | "TAS" | "NT" | "ACT" | null,
  "location": "...",
  "category": "farm" | "hospitality" | "construction" | "retail" | "cleaning" | "events" | "animals" | "transport" | "other" | null,
  "type": "casual" | "full_time" | "part_time" | "contract",
  "pay": "...",
  "description": "...",
  "applyUrl": "...",
  "eligible88Days": true | false
}"""

CLASSIFY_SYSTEM = """You are the curation gatekeeper for Job Club, a paid job board for French Working Holiday Visa (WHV) backpackers in Australia.

Score each candidate so the admin team only reviews high-quality listings.

## Audience
French (and other) backpackers on 417/462 WHV, ages 18-35, looking for casual/seasonal work, often farm/88-day eligible.

## Categories (must use one of these slugs)
- farm: agriculture, picking, packing, harvest, dairy, cattle station, vineyard, orchard
- hospitality: bar, restaurant, cafe, hotel, hostel, kitchen, waiter, barista, accommodation housekeeping
- construction: building sites, labourer, trades, carpenter, plumber, electrician, scaffold
- retail: shop, store, sales floor, cashier
- cleaning: domestic, commercial, laundry (non-hospitality), janitorial
- events: festivals, event staff, function, conference, weddings
- animals: stable hand, groom, pet care, kennels
- transport: driver (where licence allows), removalist, courier, warehouse drivers
- other: only as last resort

## States (must use one of these codes)
QLD, NSW, VIC, SA, WA, TAS, NT, ACT

## Signals
88-day signals: "88 days/jours", "specified work", "regional work", "second/2nd year visa", "subclass 417", "WHV friendly", "backpackers welcome", regional postcode + ag/farm/fishing/forestry/mining/construction.

Locals-only red flags: "Locals only", "Australian residents only", "permanent residents only", "must have own car / current state licence", "long-term commitment / min 12 months", "permanent role only", career-professional salary structures.

Scam red flags: asks for payment/fee/deposit/training cost, promises guaranteed unrealistic income, requires passport/visa scan upfront, no company name (only phone/email), vague "call for details" descriptions, generic "free accommodation" with no employer detail.

is_backpacker_suitable=true if: casual/short-term, WHV-eligible, real employer + location + contact path, plausibly legal pay, fits a category.
is_backpacker_suitable=false if: locals-only, scam, career-professional role, long-term/permanent only, requires AU residency.

Respond with ONLY a JSON object — no preamble, no markdown fencing. Exact shape:
{
  "is_backpacker_suitable": true | false,
  "has_88_day_signal": true | false,
  "has_locals_only_red_flag": true | false,
  "has_clear_pay": true | false,
  "has_scam_red_flags": true | false,
  "scam_reasons": ["..."],
  "suggested_category": "farm" | ... | null,
  "suggested_state": "QLD" | ... | null,
  "confidence": 0.0,
  "reasoning": "1-2 sentences"
}

When unclear, lean conservative on is_backpacker_suitable=false."""


def _call_claude(system: str, user: str, model: str, max_chars: int = 25000) -> str:
    """Run `claude -p` with the system + user prompts and return the assistant text."""
    user_clipped = user[:max_chars]
    full_prompt = f"<system>\n{system}\n</system>\n\n<user>\n{user_clipped}\n</user>"
    result = subprocess.run(
        [CLAUDE_CMD, '-p', '--model', model, '--output-format', 'json'],
        input=full_prompt,
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode != 0:
        raise RuntimeError(f'claude CLI failed (rc={result.returncode}): {result.stderr.strip()[:500]}')
    envelope = json.loads(result.stdout)
    if envelope.get('is_error'):
        raise RuntimeError(f'claude CLI error: {envelope.get("result")}')
    return envelope.get('result', '')


def _parse_json_response(text: str) -> dict:
    """Extract a JSON object from the model's response, tolerating fenced or wrapped output."""
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```[a-zA-Z]*\n', '', text)
        text = re.sub(r'\n```\s*$', '', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


def extract_job(url: str, page_text: str) -> dict[str, Any]:
    user = f"URL: {url}\n\nPage content (cleaned):\n{page_text}"
    response_text = _call_claude(EXTRACT_SYSTEM, user, EXTRACT_MODEL)
    data = _parse_json_response(response_text)
    if data.get('state') and data['state'] not in VALID_STATES:
        data['state'] = None
    if data.get('category') and data['category'] not in VALID_CATEGORIES:
        data['category'] = None
    if data.get('type') not in ('casual', 'full_time', 'part_time', 'contract'):
        data['type'] = 'casual'

    # If the LLM short-circuited the extraction, skip eligibility — there's
    # nothing to assess.
    if data.get('extraction_failed'):
        return data

    # Deterministic post-pass: postcode lookup + award comparison override the
    # LLM's eligible88Days and add structured eligibility/pay metadata + notes.
    try:
        verdict = eligibility.assess(data)
    except Exception as e:
        log.exception('eligibility assess failed; keeping raw LLM output')
        data.setdefault('extraction_notes', []).append(f'Eligibility module error: {e}')
        return data

    llm_88 = bool(data.get('eligible88Days'))
    deterministic_88 = verdict['eligibility_88_days']
    if deterministic_88 is not None and deterministic_88 != llm_88:
        verdict['extraction_notes'].insert(
            0,
            f'⚠ Override IA: extracteur LLM disait eligible88Days={llm_88}, '
            f'mais lookup déterministe = {deterministic_88}. La vérification postcode est autoritative.'
        )

    # Final eligible88Days = deterministic verdict if available, else fall back
    # to LLM (so we don't regress when reference data is missing).
    if deterministic_88 is None:
        data['eligible88Days'] = llm_88
    else:
        data['eligible88Days'] = deterministic_88

    # Merge verdict fields into the output. The LLM's original 88-day flag is
    # preserved in 'eligible88Days_llm' for audit.
    data['eligible88Days_llm'] = llm_88
    for k, v in verdict.items():
        data[k] = v

    return data


POSTCODE_PARSE_SYSTEM = """You parse Australian postcode lists from the Home Affairs "specified work" page for a single industry (agriculture, construction, or tourism/hospitality).

Input: raw text dump that may contain MULTIPLE industry sections (Plant and animal cultivation, Fishing/pearling, Tree farming, Mining, Construction, Bushfire recovery, Tourism/hospitality in Remote and Very Remote Australia, etc.). The user's intended INDUSTRY is provided in the user message — extract ONLY that one section, ignore the others.

Industry name mapping (Home Affairs heading → our slug):
- "Plant and animal cultivation" / "Agriculture" / "agricultural work" → agriculture
- "Construction" → construction
- "Tourism and hospitality" / "Remote and Very Remote Australia" → tourism

Rules:
- Locate the section matching the requested industry. If there are multiple tables under that heading, merge them.
- Detect each state/territory header (NSW / New South Wales, VIC / Victoria, QLD / Queensland, SA / South Australia, WA / Western Australia, TAS / Tasmania, NT / Northern Territory, ACT / Australian Capital Territory) and the postcodes listed under it. Always emit the 3-letter state code in the output.
- Convert "X to Y" syntax (e.g. "2832 to 2836") into "2832-2836" range strings. Preserve other ranges verbatim.
- Capture standalone 4-digit postcodes as strings.
- If the section says the entire state/territory is eligible (e.g. "All postcodes in the Northern Territory are eligible"), set "include_all_state": true and leave postcodes empty.
- Capture the effective_from date or amendment date if shown (e.g. "5 April 2025", "22 June 2021"), ISO format YYYY-MM-DD.
- If you cannot find the requested industry section in the input, set parse_failed=true with a clear failure_reason.

Respond with ONLY a JSON object — no markdown, no preamble. Exact shape:
{
  "parse_failed": false,
  "failure_reason": "",
  "industry": "agriculture" | "construction" | "tourism",
  "effective_from": "YYYY-MM-DD" | null,
  "states": {
    "NSW": { "include_all_state": false, "postcodes": ["2311", "2328-2411", ...] },
    "VIC": { "include_all_state": false, "postcodes": [...] },
    "QLD": { "include_all_state": false, "postcodes": [...] },
    "SA":  { "include_all_state": false, "postcodes": [...] },
    "WA":  { "include_all_state": false, "postcodes": [...] },
    "TAS": { "include_all_state": true,  "postcodes": [] },
    "NT":  { "include_all_state": true,  "postcodes": [] },
    "ACT": { "include_all_state": false, "postcodes": [] }
  },
  "notes": "anything unusual the reviewer should know"
}"""

AWARD_PARSE_SYSTEM = """You parse a Fair Work Australia "Pay Guide" page for ONE Modern Award into a strict JSON schema.

Input: raw text dump from fairwork.gov.au pay guide PDF/page (e.g. Horticulture Award MA000028, Pastoral Award MA000035).

Rules:
- Extract the award_id (MA-prefixed code), award_name, and effective_from date (ISO YYYY-MM-DD).
- For "min_full_time_hourly", capture the LOWEST adult full-time hourly rate (usually Level 1 / Grade 1 / Introductory). Adult, not junior. Hourly, not weekly.
- For "min_casual_hourly", capture the LOWEST adult casual hourly rate (Level 1 + 25% casual loading typically).
- Capture all classifications (Level/Grade name → full_time_hourly, casual_hourly, weekly) for the adult schedule. Skip junior/apprentice tables unless that's the only schedule shown.
- Capture casual_loading_pct (typically 25.0).
- "industry" is one of agriculture, construction, hospitality, cleaning, transport, retail, animals, events, other.
- "notes" should mention if piecework rates exist (esp. horticulture), if the award has unusual penalties, or if the page only had partial data.
- If you cannot locate a coherent pay schedule, set parse_failed=true.

Respond with ONLY a JSON object — no markdown, no preamble. Exact shape:
{
  "parse_failed": false,
  "failure_reason": "",
  "award_id": "MA000028",
  "award_name": "Horticulture Award 2020",
  "industry": "agriculture",
  "effective_from": "YYYY-MM-DD" | null,
  "min_full_time_hourly": 24.95,
  "min_casual_hourly": 31.19,
  "casual_loading_pct": 25.0,
  "classifications": [
    { "level": "Level 1", "full_time_hourly": 24.95, "casual_hourly": 31.19, "weekly": 948.05 }
  ],
  "has_piecework": false,
  "notes": "..."
}"""


def parse_reference_data(kind: str, page_text: str, industry: str | None = None) -> dict[str, Any]:
    """Parse a pasted regulatory page into a strict reference-data schema.

    kind: "postcodes" | "award"
    industry: only used for kind="postcodes" — tells the parser which section
              to extract from a page that may contain several. One of:
              "agriculture", "construction", "tourism".
    """
    if kind == 'postcodes':
        system = POSTCODE_PARSE_SYSTEM
        industry_hint = (industry or 'agriculture').strip()
        user = f"REQUESTED INDUSTRY: {industry_hint}\n\nExtract ONLY the {industry_hint} section. Ignore all other industries on the page.\n\nPage content (cleaned):\n{page_text}"
    elif kind == 'award':
        system = AWARD_PARSE_SYSTEM
        user = f"Page content (cleaned):\n{page_text}"
    else:
        raise ValueError(f'unknown kind: {kind}')
    response_text = _call_claude(system, user, REFDATA_MODEL, max_chars=80000)
    return _parse_json_response(response_text)


def classify_candidate(raw: dict[str, Any]) -> dict[str, Any]:
    user_lines = [
        f"Title: {raw.get('title', '')}",
        f"Company: {raw.get('company', '')}",
    ]
    for key, label in [('location', 'Location'), ('state', 'State'),
                       ('category', 'Category (extracted)'), ('type', 'Type'),
                       ('pay', 'Pay'), ('applyUrl', 'Apply URL')]:
        if raw.get(key):
            user_lines.append(f"{label}: {raw[key]}")
    user_lines.append('')
    user_lines.append('Description:')
    user_lines.append(str(raw.get('description', ''))[:6000])
    user = '\n'.join(user_lines)
    response_text = _call_claude(CLASSIFY_SYSTEM, user, CLASSIFY_MODEL)
    data = _parse_json_response(response_text)
    if data.get('suggested_category') and data['suggested_category'] not in VALID_CATEGORIES:
        data['suggested_category'] = None
    if data.get('suggested_state') and data['suggested_state'] not in VALID_STATES:
        data['suggested_state'] = None
    return data
