"""
Generic HTML adapter — covers the long tail of "this is a careers / job
search page" sources via per-source config (selector + pattern + caps).

Replaces the TS generic_career_page adapter. Drives behaviour from params
the JobSource.config row carries:
  - jobLinkSelector (CSS): which anchors to consider
  - jobLinkPattern (substring or /regex/flags): which hrefs to keep
  - maxListings: cap

If neither selector nor pattern is set, falls back to a heuristic that
matches /jobs/, /careers/, /position/, /role/, etc. paths.

Used by all 21 generic_career_page-shaped sources (Seek slices,
small employer career pages, packhouse listings, etc.). One Python
file replaces a per-site adapter for each.
"""
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from scrapling.fetchers import AsyncStealthySession

log = logging.getLogger("generic_html")

# Match job-board-ish path segments. Applied to the URL PATH only — earlier
# we ran .search() on the full URL, which made every link on a host like
# "careers.compass-group.com.au" match (the regex hit "careers" in the
# hostname) and the adapter slurped /me/settings, /help-hub, /why-compass
# as if they were job listings. Using the parsed path scopes the heuristic
# to actual path segments like /careers/job/123.
HEURISTIC_RE = re.compile(
    r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b",
    re.IGNORECASE,
)


def matches_heuristic(absolute_url: str) -> bool:
    try:
        path = urlparse(absolute_url).path or "/"
    except Exception:
        return False
    return bool(HEURISTIC_RE.search(path))


def to_absolute(base: str, href: str) -> str | None:
    if not href:
        return None
    if href.startswith(("javascript:", "mailto:", "#")):
        return None
    try:
        return urljoin(base, href)
    except Exception:
        return None


def matches_pattern(href: str, pattern: str) -> bool:
    """Slash-delimited regex (/foo/i) — falls through to substring match."""
    if pattern.startswith("/") and pattern.rfind("/") > 0:
        last = pattern.rfind("/")
        body = pattern[1:last]
        flag_chars = pattern[last + 1 :]
        flags = re.IGNORECASE if "i" in flag_chars else 0
        try:
            return bool(re.search(body, href, flags))
        except re.error:
            # Bad regex — fall through to substring match.
            pass
    return pattern in href


async def scrape(url: str, params: dict[str, Any]) -> dict[str, Any]:
    job_link_selector: str | None = params.get("jobLinkSelector") or None
    job_link_pattern: str | None = params.get("jobLinkPattern") or None
    max_listings = int(params.get("maxListings", 30))

    async with AsyncStealthySession(headless=True) as session:
        page = await session.fetch(url, network_idle=True, timeout=90_000)

    if page.status >= 400:
        return {
            "listings": [],
            "errors": [f"HTTP {page.status} from origin"],
            "debug": {"url": url, "status": page.status},
        }

    selector = job_link_selector or "a[href]"
    seen: set[str] = set()
    listings: list[dict[str, Any]] = []

    for anchor in page.css(selector):
        href = anchor.attrib.get("href", "")
        absolute = to_absolute(url, href)
        if not absolute:
            continue

        if job_link_pattern:
            if not matches_pattern(absolute, job_link_pattern):
                continue
        elif not job_link_selector:
            # No explicit selector + no explicit pattern → heuristic, otherwise
            # we'd import every nav link on the page.
            if not matches_heuristic(absolute):
                continue

        if absolute in seen:
            continue
        seen.add(absolute)

        title_text = anchor.css("::text").get() or ""
        title = title_text.strip().replace("\n", " ")[:140] or None
        listings.append({"url": absolute, "title": title})

    log.info(
        "generic_html discovered=%d url=%s selector=%s pattern=%s",
        len(listings), url, selector, job_link_pattern,
    )
    return {
        "listings": listings[:max_listings],
        "errors": [],
        "debug": {
            "discovered_total": len(listings),
            "returned": min(len(listings), max_listings),
            "selector_used": selector,
            "pattern_filter": job_link_pattern,
            "heuristic_used": not (job_link_selector or job_link_pattern),
        },
    }
