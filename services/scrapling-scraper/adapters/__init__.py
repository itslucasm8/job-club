"""Adapter registry — each adapter module exposes an async scrape(url, params)."""
from . import gumtree, registry

# Wire built-in adapters into the registry on import.
registry.register("gumtree", gumtree)
