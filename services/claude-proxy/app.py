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
import logging
import os
from hashlib import sha256

from flask import Flask, jsonify, request

import drafter
import fetcher

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
        return jsonify(result)
    except Exception as e:
        log.exception('extract-from-url failed')
        return jsonify({'error': str(e)}), 500


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


if __name__ == '__main__':
    port = int(os.environ.get('CLAUDE_PROXY_PORT', '8090'))
    app.run(host='0.0.0.0', port=port)
