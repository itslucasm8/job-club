"""Adapter registry — each module exposes async scrape(url, params) -> dict."""
from . import generic_html, registry, workforce_australia

# Workforce Australia and Harvest Trail share the same backend; register
# both names against the same implementation. The JobSource.baseUrl carries
# the keyword-specific search URL (keywords=farm vs keywords=harvest+picking).
registry.register("workforce_australia", workforce_australia)
registry.register("harvest_trail", workforce_australia)

# Generic HTML adapter — covers the long tail of careers / job-search pages
# driven by per-source config (selector + pattern). Powers the 21
# generic_career_page-shaped JobSource rows.
registry.register("generic_html", generic_html)
