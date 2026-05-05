"""
Gumtree adapter — Phase 2 placeholder.

Will be filled in next: port src/lib/sourcing/adapters/gumtree-html.ts to
Scrapling's HTTP Fetcher (Gumtree doesn't need stealth — plain HTTP works).
"""
from typing import Any


async def scrape(url: str, params: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidates": [],
        "errors": ["gumtree adapter not yet implemented (Phase 2)"],
        "debug": {"url": url, "params": params},
    }
