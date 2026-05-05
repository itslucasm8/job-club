"""
Job Club Scrapling sidecar.

Unified non-FB scraping service. The Next.js app reaches us at
http://scraper:8091 (Docker network) for adapters whose
JobSource.adapter == 'scrapling'.

Each adapter is a small Python module under adapters/. They get a URL +
params and return a list of candidate dicts in the shape ingestCandidate
expects. We don't talk to the database — Next.js handles persistence.
"""
import hmac
import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from adapters import registry

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("scrapling-scraper")

SHARED_SECRET = os.environ.get("SCRAPER_SECRET", "").encode()
if not SHARED_SECRET:
    raise SystemExit("SCRAPER_SECRET env var is required")

app = FastAPI(
    title="Job Club Scrapling Scraper",
    description="Sidecar for non-FB job source scraping",
    version="0.1.0",
)


def authorized(request: Request) -> bool:
    """Constant-time bearer token compare."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return False
    presented = auth[len("Bearer ") :].encode()
    return hmac.compare_digest(presented, SHARED_SECRET)


class ScrapeRequest(BaseModel):
    adapter: str = Field(..., description="Registered adapter name, e.g. 'gumtree'")
    url: str = Field(..., description="Source URL to scrape")
    params: dict[str, Any] = Field(default_factory=dict)


class Candidate(BaseModel):
    sourceUrl: str
    sourceJobId: str | None = None
    raw: dict[str, Any]
    sourceText: str | None = None


class ScrapeResponse(BaseModel):
    ok: bool
    candidates: list[Candidate] = []
    errors: list[str] = []
    debug: dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "scrapling-scraper",
        "adapters": registry.list_adapters(),
    }


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape(req: ScrapeRequest, request: Request) -> ScrapeResponse:
    if not authorized(request):
        raise HTTPException(status_code=401, detail="unauthorized")

    impl = registry.get_adapter(req.adapter)
    if not impl:
        raise HTTPException(
            status_code=400,
            detail=f"unknown adapter '{req.adapter}'. registered={registry.list_adapters()}",
        )

    log.info("scrape adapter=%s url=%s", req.adapter, req.url)
    try:
        result = await impl.scrape(req.url, req.params)
        return ScrapeResponse(
            ok=True,
            candidates=result.get("candidates", []),
            errors=result.get("errors", []),
            debug=result.get("debug", {}),
        )
    except Exception as e:
        log.exception("scrape failed adapter=%s", req.adapter)
        return ScrapeResponse(ok=False, errors=[str(e)])
