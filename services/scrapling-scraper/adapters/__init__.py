"""Adapter registry — each module exposes async scrape(url, params) -> dict."""
from . import registry, workforce_australia

# Workforce Australia and Harvest Trail share the same backend; register
# both names against the same implementation. The JobSource.baseUrl carries
# the keyword-specific search URL (keywords=farm vs keywords=harvest+picking).
registry.register("workforce_australia", workforce_australia)
registry.register("harvest_trail", workforce_australia)
