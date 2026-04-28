# 88-day Eligibility + Award Rate Detection

> **For Claude:** This is a code + data plan. Build deterministic Python helpers in the Claude proxy and JSON reference files versioned in the repo. The LLM's job is to extract structured signals; the deterministic layer is the source of truth for eligibility and award compliance.

**Goal:** Replace the LLM's loose "eligible88Days" judgment (currently false-positive on metro Brunswick warehouse roles) with a deterministic verdict that is 100% explainable. As a related win, detect listings that pay below their relevant Modern Award minimum so scams/exploitation auto-flag.

**Why this matters:**
- A false 88-day badge on a Melbourne warehouse role kills user trust the moment a backpacker realises it doesn't count.
- Mohammed's $15.62/hr nanny ad showed the gap: scams hide in plain sight on Gumtree. An award-rate check turns "is this exploitative?" from a judgment call into a deterministic comparison.
- Both belong to one architectural pattern (LLM extracts → Python looks up → Classifier confirms), so build them together.

---

## Decisions locked (2026-04-29)

| Decision | Choice | Notes |
|---|---|---|
| Scope | Phase A + B together | 88-day fix + award rate detection in one push |
| Strictness | **Strict** — eligible only if 100% confident | False negatives OK; false positives unacceptable |
| Data location | JSON files in `services/claude-proxy/data/` | Static, version-controlled, restart-to-update |
| Update cadence | Manual, annual (every July 1 + when Home Affairs amends) | Phase C cron auto-update deferred |
| Visa classes covered | Subclass 417 only (your French audience) | 462 list is per-nationality and France isn't on it |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Extractor (Haiku via /extract)                                 │
│   In:  url, page_text                                          │
│   Out: title, company, location, postcode (4-digit), category, │
│        type, pay_text, description                             │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────┐
│ eligibility.py (NEW, deterministic Python on the proxy)        │
│                                                                 │
│  parse_postcode(location, description) → 4-digit | None        │
│  parse_pay_to_hourly(pay_text, type) → float | "award" | None  │
│                                                                 │
│  compute_88day(category, postcode, description)                │
│    → {eligible: bool, reason: str, industry_tag: str}          │
│                                                                 │
│  compute_award(category, description)                          │
│    → {award_id, name, min_hourly, source_url}                  │
│                                                                 │
│  compare_pay(pay_hourly, min_hourly)                           │
│    → {status: "above"|"at"|"below"|"unknown", gap: float|None} │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────┐
│ Classifier (Haiku via /classify)                               │
│   - Receives the deterministic verdicts as system context      │
│   - Confirms / overrides for genuine edge cases                │
│   - Sets final has_88_day_signal, pay_below_award flags        │
└────────────────────────────────────────────────────────────────┘
```

**Key principle:** the deterministic layer is authoritative for eligibility/award questions. The LLM cannot override "postcode 3056 is not in the regional construction list" — that's a fact, not a judgment.

---

## Reference data — files to create

```
services/claude-proxy/data/
├── postcodes_agriculture.json     # ag/horticulture/livestock — anywhere in Australia
├── postcodes_construction.json    # regional construction/mining postcodes
├── postcodes_tourism.json         # Northern AU + Remote/Very Remote postcodes
├── awards.json                    # Modern Award min hourly rates
├── category_to_industry.json      # Job Club 9 → Specified Work industry tag
└── category_to_award.json         # Job Club 9 → primary Modern Award ID
```

### `postcodes_*.json` shape

```json
{
  "industry": "construction_mining",
  "as_of": "2025-07-01",
  "source_url": "https://immi.homeaffairs.gov.au/...",
  "ranges": [
    [2250, 2263], [2311, 2312], [2328, 2333],
    ...
  ],
  "individual": [4825, 4849, 6701]
}
```

Postcode list lives as a mix of ranges + singletons (matches how Home Affairs publishes it). Lookup function checks ranges + set membership.

### `awards.json` shape

```json
{
  "as_of": "2025-07-01",
  "next_review": "2026-07-01",
  "casual_loading_default": 0.25,
  "awards": {
    "MA000028": {
      "name": "Horticulture Award",
      "min_hourly_adult_l1": 26.73,
      "min_hourly_casual_l1": 33.41,
      "source_url": "https://www.fairwork.gov.au/employment-conditions/awards/list-of-awards"
    },
    "MA000035": {
      "name": "Pastoral Award",
      "min_hourly_adult_l1": 24.95,
      "min_hourly_casual_l1": 31.19,
      "source_url": "..."
    },
    "MA000009": { "name": "Hospitality (General)", "min_hourly_adult_l1": 23.58, "min_hourly_casual_l1": 29.48, "source_url": "..." },
    "MA000020": { "name": "Building & Construction General On-Site", "min_hourly_adult_l1": 28.00, "min_hourly_casual_l1": 35.00, "source_url": "..." },
    "MA000022": { "name": "Cleaning Services", "min_hourly_adult_l1": 25.40, "min_hourly_casual_l1": 31.75, "source_url": "..." },
    "MA000004": { "name": "General Retail", "min_hourly_adult_l1": 23.58, "min_hourly_casual_l1": 29.48, "source_url": "..." },
    "MA000084": { "name": "Storage Services", "min_hourly_adult_l1": 25.30, "min_hourly_casual_l1": 31.63, "source_url": "..." },
    "MA000081": { "name": "Live Performance", "min_hourly_adult_l1": 24.20, "min_hourly_casual_l1": 30.25, "source_url": "..." }
  }
}
```

> Rates above are placeholders — must be verified against the most recent FWC decision before deploying.

### `category_to_industry.json`

```json
{
  "farm":         { "industry_88": "agriculture",        "notes": "Plant/animal cultivation; eligible anywhere in AU" },
  "animals":      { "industry_88": "agriculture",        "notes": "Pastoral / livestock — same as farm for 88-day" },
  "construction": { "industry_88": "construction",       "notes": "Eligible only in regional postcodes" },
  "hospitality":  { "industry_88": "tourism_north",      "notes": "Eligible only in Northern/Remote postcodes" },
  "cleaning":     { "industry_88": "tourism_north_maybe", "notes": "Cleaning in a hostel/hotel in Northern AU may count as tourism — edge case" },
  "transport":    { "industry_88": "none",               "notes": "Warehouse/logistics is not on Specified Work list" },
  "retail":       { "industry_88": "none" },
  "events":       { "industry_88": "none" },
  "other":        { "industry_88": "none" }
}
```

### `category_to_award.json`

```json
{
  "farm":         { "primary": "MA000028", "alt_if_livestock_keywords": "MA000035" },
  "animals":      { "primary": "MA000035" },
  "hospitality":  { "primary": "MA000009" },
  "construction": { "primary": "MA000020" },
  "cleaning":     { "primary": "MA000022" },
  "retail":       { "primary": "MA000004" },
  "transport":    { "primary": "MA000084" },
  "events":       { "primary": "MA000081" },
  "other":        { "primary": "MA000009" }
}
```

`alt_if_livestock_keywords`: switch from Horticulture (MA000028) to Pastoral (MA000035) when the description contains "cattle", "sheep", "station", "livestock", "drover", etc. Keeps the picking/packing path on the more common award.

---

## Deterministic eligibility logic

```python
def compute_88day(category, postcode, description=""):
    industry = CATEGORY_TO_INDUSTRY[category]["industry_88"]

    if industry == "none":
        return {"eligible": False,
                "reason": f"Category '{category}' is not on the Specified Work list",
                "industry_tag": "none"}

    if industry == "agriculture":
        return {"eligible": True,
                "reason": "Plant/animal cultivation is 88-day eligible nationwide",
                "industry_tag": "agriculture"}

    if not postcode:
        return {"eligible": False,
                "reason": "Postcode could not be determined; strict policy requires explicit postcode",
                "industry_tag": industry}

    if industry == "construction":
        if postcode_in(postcode, "construction_mining"):
            return {"eligible": True,
                    "reason": f"Construction in regional postcode {postcode}",
                    "industry_tag": industry}
        return {"eligible": False,
                "reason": f"Postcode {postcode} not on the regional construction list",
                "industry_tag": industry}

    if industry == "tourism_north":
        if postcode_in(postcode, "tourism"):
            return {"eligible": True,
                    "reason": f"Tourism/hospitality in Northern/Remote postcode {postcode}",
                    "industry_tag": industry}
        return {"eligible": False,
                "reason": f"Postcode {postcode} not in Northern AU or Remote area",
                "industry_tag": industry}

    if industry == "tourism_north_maybe":
        # Cleaning in a hostel/hotel in Northern AU — only eligible if (a) Northern postcode AND
        # (b) accommodation context. Strict default = false.
        if postcode_in(postcode, "tourism") and any(
            kw in description.lower() for kw in ["hostel", "hotel", "resort", "motel", "lodge"]
        ):
            return {"eligible": True,
                    "reason": f"Cleaning at accommodation in Northern/Remote postcode {postcode}",
                    "industry_tag": "tourism_north"}
        return {"eligible": False,
                "reason": f"Cleaning is only 88-day eligible in tourist accommodation in Northern/Remote AU",
                "industry_tag": industry}

    return {"eligible": False, "reason": "Unrecognized industry tag", "industry_tag": industry}
```

---

## Pay parsing

```python
def parse_pay_to_hourly(pay_text, type_hint="casual"):
    """Return float hourly equivalent, "award" sentinel, or None for unknown."""
    if not pay_text:
        return None
    text = pay_text.lower().strip()

    # Common "we'll use the Award" cases
    if any(s in text for s in ["award wage", "award rate", "as per award", "modern award"]):
        return "award"

    # Piece rate — cannot reliably compare without volume assumptions
    if "piece" in text:
        return None

    # Negotiable / TBC
    if any(s in text for s in ["negotiable", "tbc", "to be confirmed", "doe"]):
        return None

    # $X/hr | $X per hour | $X /h
    m = re.search(r'\$?\s*(\d+(?:\.\d+)?)\s*(?:/|per)?\s*(?:hr|hour|h)\b', text)
    if m: return float(m.group(1))

    # $X/day - assume 8hr workday
    m = re.search(r'\$?\s*(\d+(?:\.\d+)?)\s*(?:/|per)\s*day\b', text)
    if m: return float(m.group(1)) / 8

    # $X/week - assume 38hr week (FWC standard)
    m = re.search(r'\$?\s*(\d+(?:\.\d+)?)\s*(?:/|per)\s*(?:wk|week|w)\b', text)
    if m: return float(m.group(1)) / 38

    # $X/year or $X p.a. - assume 1976 hr/year (52 × 38)
    m = re.search(r'\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:k|/yr|p\.?a\.?|per annum)', text)
    if m:
        v = float(m.group(1).replace(',', ''))
        if 'k' in text: v *= 1000
        return v / 1976

    return None
```

Edge cases worth flagging in the admin UI rather than silently failing:
- `"piece"` rate → mark `pay_status: "piece_rate_uncomparable"` and let admin judge
- `"award"` → assume at-minimum, no flag
- `None` → mark `pay_status: "unknown"` and surface as a yellow badge

---

## Award comparison

```python
def compare_pay(pay_hourly, min_hourly, type_hint="casual"):
    if pay_hourly is None:
        return {"status": "unknown", "gap": None}
    if pay_hourly == "award":
        return {"status": "at", "gap": 0.0}
    gap = pay_hourly - min_hourly
    if gap >= -0.50:   # within 50c is "at" (rounding tolerance)
        return {"status": "above" if gap > 0.50 else "at", "gap": round(gap, 2)}
    return {"status": "below", "gap": round(gap, 2)}
```

---

## Wiring into the existing pipeline

### `services/claude-proxy/drafter.py`

- Add `extract_postcode(location)` regex helper (4-digit AU postcode pattern)
- Have the extractor prompt explicitly extract `postcode` as a top-level field (currently buried in `location`)
- After extraction, call `eligibility.compute_88day(...)` and `eligibility.compute_award(...)`
- Override `eligible88Days` with the deterministic verdict
- Add fields to the response: `compute_88day_reason`, `award_id`, `award_min_hourly`, `pay_hourly_equiv`, `pay_status`

### `src/lib/sourcing/extractor.ts`

- New optional fields on `ProxyExtractResult`: `eligibility_reason`, `award_id`, `award_min_hourly`, `pay_status`
- Map them onto `CandidateRaw` (extend the type) so they end up in `JobCandidate.rawData`

### `prisma/schema.prisma`

- No schema change needed — extra fields ride in `rawData` JSON

### Admin UI: `/admin/candidates`

- New badges:
  - 🟢 88-day eligible (with hover showing reason: "Plant/animal cultivation eligible nationwide")
  - 🟡 Postcode missing (eligibility couldn't be determined)
  - 🔴 Below award (with delta: "$15.62 — $7.96 below Hospitality Award")
  - ⚪ Pay unknown / piece rate

### Classifier prompt update

Add a new section telling the classifier:
> The eligibility verdict has already been computed deterministically and is in the user message under `deterministic_88day` and `deterministic_award`. Trust those for the final `has_88_day_signal` and `pay_below_award` flags unless the listing's text is genuinely ambiguous in a way the deterministic check missed. Your `reasoning` field should explain any disagreement.

---

## Open questions to resolve while building

1. **Post-2024 ag eligibility:** the 2024 reforms changed some rules. Need to verify whether plant/animal cultivation truly is "anywhere in AU" or if some narrow regional restrictions came back. Check Home Affairs current page.
2. **Disaster/bushfire recovery zones:** rare for Job Club but technically a 4th eligibility category. Defer.
3. **Cleaning in non-accommodation Northern AU:** if a backpacker cleans an office in Darwin, does that count? Strict reading: no (must be in accommodation/tourism context). Lenient reading: hospitality industry as a whole. Recommend strict.
4. **Pieceworker minimum (horticulture):** since 2022, the Horticulture Award has a piece-rate minimum equivalent to 17.5% above the minimum hourly. Skipping for v1 — too complex. Mark piece-rate listings as "uncomparable".
5. **Apprentice / junior rates:** awards have Level 2/3 and apprentice/junior rates. We're using Level 1 adult casual as the floor, which is the strictest interpretation. A 16-year-old may have a lower legal minimum, but no one on a WHV is under 18, so this is fine.

---

## Phasing within the build

| Step | Output | Time |
|---|---|---|
| 1 | Postcode JSON files seeded from Home Affairs (manual transcription) | 60 min |
| 2 | Awards JSON file seeded from FWC | 45 min |
| 3 | `category_to_*.json` mapping files | 15 min |
| 4 | `eligibility.py` with full logic + pay parser | 90 min |
| 5 | Wire into `drafter.py` extract flow | 30 min |
| 6 | Update `extractor.ts` to surface new fields | 30 min |
| 7 | Admin UI: new badges + tooltips | 60 min |
| 8 | Update classifier prompt to consume deterministic verdicts | 20 min |
| 9 | End-to-end test: re-run Ken Hands + Mohammed + new fixtures | 30 min |
| **Total** | | **~6 hours** |

Steps 1-2 are the biggest unknowns — accuracy depends on getting the source data right. I'd want to cross-reference at least two sources for each postcode list to catch transcription errors.

---

## Maintenance plan

- **July 1 each year:** refresh `awards.json` from latest FWC annual wage review decision. Single PR, version bumped.
- **Whenever Home Affairs amends the postcode list:** update the relevant `postcodes_*.json`. They publish notices.
- **Quarterly sanity check:** spot-check 5 known postcodes against the official Home Affairs tool. Catches drift.
- **Phase C trigger:** if Lucas misses an annual update once and a stale rate causes a wrong-flag in production, that's the cue to build the auto-pull cron.

---

## Out of scope (call out explicitly)

- Subclass 462 visa logic (different industry list per nationality; not relevant for the French Podia cohort)
- Bushfire/disaster recovery work (rare, declared zones, defer)
- Pieceworker minimum precise calculation (complex, defer; mark as uncomparable)
- Apprentice/junior rates (WHV holders are all 18-35 adults)
- Live auto-pull from official sources (Phase C, deferred until proven need)
