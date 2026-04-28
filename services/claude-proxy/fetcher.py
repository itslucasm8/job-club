"""
Headless-browser page fetcher.

Plain HTTP clients (`requests`, server-side `fetch`) get 403'd by Gumtree,
Seek, BPJB, etc. — they fingerprint the TLS handshake, not just headers.
Real Chromium via Playwright bypasses that because it IS a real browser.

We wait for the document to be ready, give the page 2-3s for client-side
content to render, then return the rendered HTML.
"""
import logging
import re
from dataclasses import dataclass
from typing import Optional

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

log = logging.getLogger('fetcher')

DEFAULT_TIMEOUT_MS = 25_000
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
)


@dataclass
class FetchResult:
    ok: bool
    status: int
    html: str
    text: str
    error: Optional[str] = None


def _html_to_text(html: str) -> str:
    text = re.sub(r'<script[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
    text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<noscript[\s\S]*?</noscript>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<!--[\s\S]*?-->', '', text)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</(p|div|li|h[1-6]|tr)>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = (text
            .replace('&nbsp;', ' ')
            .replace('&amp;', '&')
            .replace('&lt;', '<')
            .replace('&gt;', '>')
            .replace('&quot;', '"')
            .replace('&#39;', "'"))
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def fetch_page(url: str, wait_extra_ms: int = 2500) -> FetchResult:
    """Render the page in headless Chromium and return HTML + cleaned text."""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                ],
            )
            context = browser.new_context(
                user_agent=USER_AGENT,
                viewport={'width': 1366, 'height': 768},
                locale='en-AU',
                extra_http_headers={
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-AU,en;q=0.9',
                },
            )
            page = context.new_page()
            try:
                response = page.goto(url, timeout=DEFAULT_TIMEOUT_MS, wait_until='domcontentloaded')
            except PWTimeoutError:
                browser.close()
                return FetchResult(ok=False, status=0, html='', text='', error='timeout loading page')
            status = response.status if response else 0
            if status >= 400:
                browser.close()
                return FetchResult(ok=False, status=status, html='', text='',
                                   error=f'HTTP {status} from origin')
            try:
                page.wait_for_timeout(wait_extra_ms)
            except Exception:
                pass
            html = page.content()
            browser.close()
            text = _html_to_text(html)
            return FetchResult(ok=True, status=status, html=html, text=text)
    except Exception as e:
        log.exception('fetch_page failed for %s', url)
        return FetchResult(ok=False, status=0, html='', text='', error=str(e))
