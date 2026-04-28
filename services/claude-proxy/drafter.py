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

log = logging.getLogger('drafter')

CLAUDE_CMD = shutil.which('claude') or '/usr/local/bin/claude'

EXTRACT_MODEL = 'claude-haiku-4-5'
CLASSIFY_MODEL = 'claude-haiku-4-5'

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
    return data


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
