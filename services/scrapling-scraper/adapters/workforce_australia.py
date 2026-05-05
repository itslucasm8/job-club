"""
Workforce Australia adapter — discovers detail-page URLs from a search page.

Replaces the TS `workforceAustraliaAdapter` and `harvestTrailAdapter`. Both
hit the same backend (workforceaustralia.gov.au) — only the keywords in the
search URL differ. We register one adapter and let the JobSource.baseUrl
carry the full search URL (keywords included).

Workforce Australia is a SPA: plain HTTP returns a shell. We use
StealthyFetcher (Playwright + stealth patches) to render the page before
extracting anchors. Cloudflare-friendly even when the IP is a datacenter.

Discover-only — the runner's existing LLM extraction path handles each
detail page after we hand it the URL list.
"""
import logging
import re
from typing import Any

from scrapling.fetchers import AsyncStealthySession

log = logging.getLogger("workforce_australia")

DETAIL_URL_RE = re.compile(r"/individuals/jobs/details/(\d+)", re.IGNORECASE)
BASE = "https://www.workforceaustralia.gov.au"


async def scrape(url: str, params: dict[str, Any]) -> dict[str, Any]:
    max_listings = int(params.get("maxListings", 30))

    async with AsyncStealthySession(headless=True) as session:
        page = await session.fetch(url, network_idle=True, timeout=90_000)

    if page.status >= 400:
        return {
            "listings": [],
            "errors": [f"HTTP {page.status} from origin"],
            "debug": {"url": url, "status": page.status},
        }

    seen: set[str] = set()
    listings: list[dict[str, Any]] = []
    for anchor in page.css("a[href]"):
        href = anchor.attrib.get("href", "")
        m = DETAIL_URL_RE.search(href)
        if not m:
            continue
        sid = m.group(1)
        if sid in seen:
            continue
        seen.add(sid)
        absolute = (
            href
            if href.startswith("http")
            else f"{BASE}{href if href.startswith('/') else '/' + href}"
        )
        title_text = anchor.css("::text").get()
        title = (title_text or anchor.attrib.get("aria-label", "")).strip() or None
        listings.append({"url": absolute, "sourceJobId": sid, "title": title})

    log.info("workforce_australia discovered=%d url=%s", len(listings), url)
    return {
        "listings": listings[:max_listings],
        "errors": [],
        "debug": {
            "discovered_total": len(listings),
            "returned": min(len(listings), max_listings),
        },
    }
