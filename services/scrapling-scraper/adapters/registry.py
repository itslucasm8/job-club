"""Lightweight adapter registry. Keeps adapter modules decoupled from app.py."""
from typing import Protocol, Any


class Adapter(Protocol):
    async def scrape(self, url: str, params: dict[str, Any]) -> dict[str, Any]: ...


_adapters: dict[str, Adapter] = {}


def register(name: str, impl: Adapter) -> None:
    _adapters[name] = impl


def get_adapter(name: str) -> Adapter | None:
    return _adapters.get(name)


def list_adapters() -> list[str]:
    return sorted(_adapters.keys())
