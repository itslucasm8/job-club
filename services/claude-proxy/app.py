"""
Job Club Claude proxy.

A small Flask service that sits between the Job Club Next.js app and the
`claude` CLI on the host. The CLI is OAuth-authenticated against Lucas's
Claude Max subscription; this proxy lets the (containerised) Next.js app
shell out to it without holding any credentials itself.

Mirrors the Sales Koala pattern. Bind to localhost only; clients are
trusted (the Next.js Docker container reaches us via host.docker.internal).
"""
import hmac
import json
import logging
import os
import re
from hashlib import sha256
from pathlib import Path

from flask import Flask, jsonify, request

import drafter
import eligibility
import fetcher

DATA_DIR = Path(__file__).resolve().parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
ALLOWED_FILES = {
    'postcodes_agriculture.json',
    'postcodes_construction.json',
    'postcodes_tourism.json',
    'awards.json',
    'category_to_industry.json',
    'category_to_award.json',
}

app = Flask(__name__)

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(name)s: %(message)s',
)
log = logging.getLogger('claude-proxy')

SHARED_SECRET = os.environ.get('CLAUDE_PROXY_SECRET', '').encode()
if not SHARED_SECRET:
    raise SystemExit('CLAUDE_PROXY_SECRET env var is required')


def authorized(req) -> bool:
    """Compare bearer token in constant time."""
    auth = req.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return False
    presented = auth[len('Bearer '):].encode()
    return hmac.compare_digest(presented, SHARED_SECRET)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'claude_cli': drafter.CLAUDE_CMD})


@app.route('/extract', methods=['POST'])
def extract_endpoint():
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    page_text = body.get('page_text') or ''
    if not url or not page_text:
        return jsonify({'error': 'url and page_text required'}), 400
    try:
        result = drafter.extract_job(url=url, page_text=page_text)
        return jsonify(result)
    except Exception as e:
        log.exception('extract failed')
        return jsonify({'error': str(e)}), 500


@app.route('/extract-from-url', methods=['POST'])
def extract_from_url_endpoint():
    """Fetch via headless Chromium + extract in one call.
    Use this for sites that 403 plain HTTP fetches (Gumtree, Seek, BPJB, ...).
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    if not url or not url.startswith(('http://', 'https://')):
        return jsonify({'error': 'valid url required'}), 400
    try:
        fetch_result = fetcher.fetch_page(url)
        if not fetch_result.ok:
            return jsonify({
                'extraction_failed': True,
                'failure_reason': f'fetch failed: {fetch_result.error}',
                'fetch_status': fetch_result.status,
            }), 200
        text = fetch_result.text[:25000]
        if len(text) < 200:
            return jsonify({
                'extraction_failed': True,
                'failure_reason': 'page returned almost no text after rendering',
                'fetch_status': fetch_result.status,
            }), 200
        result = drafter.extract_job(url=url, page_text=text)
        result['fetch_status'] = fetch_result.status
        # Echo back the cleaned source text (truncated) so callers can persist it
        # for admin's source-vs-extracted audit. Same 8000-char ceiling we use in
        # ingest.ts to keep DB rows reasonable.
        result['page_text'] = text[:8000]
        return jsonify(result)
    except Exception as e:
        log.exception('extract-from-url failed')
        return jsonify({'error': str(e)}), 500


@app.route('/reassess-eligibility', methods=['POST'])
def reassess_eligibility_endpoint():
    """Re-run deterministic 88-day + award assessment on already-extracted job data.
    No LLM call. Used by scripts/reassess-eligibility.ts to backfill historical
    JobCandidate rows after reference data (postcodes/awards) is corrected.

    Request: {"raw": <full rawData object>}
    Response: the input merged with verdict fields (eligibility_88_days, postcode,
    industry, award_*, pay_*, extraction_notes, ...).
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    raw = body.get('raw') or {}
    if not isinstance(raw, dict):
        return jsonify({'error': 'raw must be an object'}), 400
    try:
        verdict = eligibility.assess(raw)
    except Exception as e:
        log.exception('reassess failed')
        return jsonify({'error': str(e)}), 500
    merged = dict(raw)
    llm_88 = bool(raw.get('eligible88Days_llm', raw.get('eligible88Days')))
    deterministic_88 = verdict.get('eligibility_88_days')
    if deterministic_88 is None:
        merged['eligible88Days'] = llm_88
    else:
        merged['eligible88Days'] = deterministic_88
    merged['eligible88Days_llm'] = llm_88
    for k, v in verdict.items():
        merged[k] = v
    return jsonify(merged)


@app.route('/fetch-html', methods=['POST'])
def fetch_html_endpoint():
    """Fetch a URL through headless Chromium and return its rendered HTML.
    Used by the source-runner to scan list pages for new listings before
    paying for per-listing Claude extracts.

    Body: {"url": "https://..."}
    Response: {"ok": bool, "status": int, "html": str, "text": str, "error"?: str}
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    if not url or not url.startswith(('http://', 'https://')):
        return jsonify({'error': 'valid url required'}), 400
    try:
        result = fetcher.fetch_page(url)
        return jsonify({
            'ok': result.ok,
            'status': result.status,
            'html': result.html if result.ok else '',
            'text': result.text if result.ok else '',
            'error': result.error,
        })
    except Exception as e:
        log.exception('fetch-html failed')
        return jsonify({'ok': False, 'status': 0, 'html': '', 'text': '', 'error': str(e)}), 500


@app.route('/classify', methods=['POST'])
def classify_endpoint():
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    raw = body.get('raw') or {}
    if not raw.get('title') or not raw.get('description'):
        return jsonify({'error': 'raw.title and raw.description required'}), 400
    try:
        result = drafter.classify_candidate(raw)
        return jsonify(result)
    except Exception as e:
        log.exception('classify failed')
        return jsonify({'error': str(e)}), 500


@app.route('/parse-reference', methods=['POST'])
def parse_reference_endpoint():
    """Parse a pasted regulatory page (Home Affairs postcodes or Fair Work pay guide)
    into the strict reference-data schema. Does NOT save — caller reviews then calls /save-reference-data.
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    kind = (body.get('kind') or '').strip()
    page_text = body.get('page_text') or ''
    industry = (body.get('industry') or '').strip() or None
    if kind not in ('postcodes', 'award'):
        return jsonify({'error': 'kind must be "postcodes" or "award"'}), 400
    if len(page_text) < 200:
        return jsonify({'error': 'page_text too short (min 200 chars)'}), 400
    try:
        result = drafter.parse_reference_data(kind=kind, page_text=page_text[:80000], industry=industry)
        return jsonify(result)
    except Exception as e:
        log.exception('parse-reference failed')
        return jsonify({'error': str(e)}), 500


@app.route('/parse-all-postcodes', methods=['POST'])
def parse_all_postcodes_endpoint():
    """Parse Home Affairs page text into all 3 industry postcode lists in one
    Sonnet call. Returns {agriculture: {...}, construction: {...}, tourism: {...}}.
    Caller reviews then calls /save-all-postcodes to persist all 3 files.
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    page_text = body.get('page_text') or ''
    if len(page_text) < 200:
        return jsonify({'error': 'page_text too short (min 200 chars)'}), 400
    try:
        result = drafter.parse_all_postcodes(page_text=page_text[:80000])
        return jsonify(result)
    except Exception as e:
        log.exception('parse-all-postcodes failed')
        return jsonify({'error': str(e)}), 500


@app.route('/save-all-postcodes', methods=['POST'])
def save_all_postcodes_endpoint():
    """Atomically save all 3 industry postcode files. Body shape:
    {
      "agriculture": {<full schema>} | null,
      "construction": {<full schema>} | null,
      "tourism": {<full schema>} | null
    }
    Sections set to null are skipped (not overwritten). Sections with parse_failed=true are also skipped.
    Returns per-file write results.
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    industries = ('agriculture', 'construction', 'tourism')
    results: dict[str, Any] = {}
    any_written = False
    for industry in industries:
        data = body.get(industry)
        if data is None:
            results[industry] = {'skipped': True, 'reason': 'not provided'}
            continue
        if not isinstance(data, dict):
            results[industry] = {'skipped': True, 'reason': 'not an object'}
            continue
        if data.get('parse_failed'):
            results[industry] = {'skipped': True, 'reason': f'parse_failed: {data.get("failure_reason", "?")}'}
            continue
        target = DATA_DIR / f'postcodes_{industry}.json'
        try:
            tmp = target.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
            tmp.replace(target)
            results[industry] = {'ok': True, 'bytes': target.stat().st_size}
            any_written = True
        except Exception as e:
            log.exception('save %s failed', industry)
            results[industry] = {'ok': False, 'error': str(e)}
    if any_written:
        eligibility.reload_data()
    return jsonify({'results': results, 'any_written': any_written})


@app.route('/save-reference-data', methods=['POST'])
def save_reference_data_endpoint():
    """Persist a parsed reference-data object to services/claude-proxy/data/<filename>.

    Modes:
      - "replace": overwrite the entire file with `data`.
      - "upsert": treat the file as an object keyed by `key`, set data[key] = data.

    Whitelisted filenames only — no path traversal, no arbitrary filesystem writes.
    """
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    filename = (body.get('filename') or '').strip()
    mode = (body.get('mode') or 'replace').strip()
    data = body.get('data')
    key = body.get('key')

    if filename not in ALLOWED_FILES:
        return jsonify({'error': f'filename must be one of {sorted(ALLOWED_FILES)}'}), 400
    if data is None:
        return jsonify({'error': 'data required'}), 400
    if mode not in ('replace', 'upsert'):
        return jsonify({'error': 'mode must be "replace" or "upsert"'}), 400
    if mode == 'upsert' and not key:
        return jsonify({'error': 'key required when mode=upsert'}), 400

    target = DATA_DIR / filename
    try:
        if mode == 'replace':
            payload = data
        else:
            existing = {}
            if target.exists():
                try:
                    existing = json.loads(target.read_text(encoding='utf-8'))
                    if not isinstance(existing, dict):
                        existing = {}
                except json.JSONDecodeError:
                    existing = {}
            existing[key] = data
            payload = existing

        tmp = target.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
        tmp.replace(target)
        # Bust the eligibility module cache so the next extract picks up the
        # newly seeded reference data without a service restart.
        eligibility.reload_data()
        return jsonify({'ok': True, 'filename': filename, 'mode': mode, 'bytes': target.stat().st_size})
    except Exception as e:
        log.exception('save-reference-data failed')
        return jsonify({'error': str(e)}), 500


@app.route('/list-reference-data', methods=['GET'])
def list_reference_data_endpoint():
    """Return current state of all whitelisted reference-data files."""
    if not authorized(request):
        return jsonify({'error': 'unauthorized'}), 401
    out = {}
    for name in sorted(ALLOWED_FILES):
        f = DATA_DIR / name
        if f.exists():
            try:
                out[name] = {
                    'exists': True,
                    'bytes': f.stat().st_size,
                    'mtime': int(f.stat().st_mtime),
                    'data': json.loads(f.read_text(encoding='utf-8')),
                }
            except Exception as e:
                out[name] = {'exists': True, 'error': str(e)}
        else:
            out[name] = {'exists': False}
    return jsonify(out)


if __name__ == '__main__':
    port = int(os.environ.get('CLAUDE_PROXY_PORT', '8090'))
    app.run(host='0.0.0.0', port=port)
