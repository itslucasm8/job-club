#!/usr/bin/env python3
"""Probe a real Seek /job/<id> detail page through the proxy to see if it
renders server-side or is a JS-only SPA. If it's JS-only, the proxy can't
extract — that's the root cause of the 80% extraction failure.
"""
import json
import re
import urllib.parse
import urllib.request

# Real Seek job permalink from the search page (sampled live)
DETAIL = "https://www.seek.com.au/job/85842342"   # placeholder - we'll grab a real one first
SEARCH = "https://www.seek.com.au/fruit-picking-jobs"

with open("/opt/jobclub-claude-proxy/.env") as f:
    for line in f:
        if line.startswith("CLAUDE_PROXY_SECRET="):
            SECRET = line.split("=", 1)[1].strip()
            break

def fetch(url):
    req = urllib.request.Request(
        "http://127.0.0.1:8090/fetch-html",
        data=json.dumps({"url": url}).encode(),
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

# Step 1: get the search page and find a real /job/<id> URL
print("=== Step 1: search page anchors ===")
data = fetch(SEARCH)
html = data.get("html") or ""
anchors = re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I)
job_id_re = re.compile(r"/job/(\d+)")
seek_jobs = []
for href in anchors:
    abs_url = urllib.parse.urljoin(SEARCH, href)
    m = job_id_re.search(abs_url)
    if m:
        seek_jobs.append(abs_url)

print(f"Anchors with /job/<id>: {len(seek_jobs)}")
for u in seek_jobs[:5]:
    print(f"  {u}")

print("\n=== Counter-example: anchors hitting heuristic but NOT a real job ===")
heur = re.compile(r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b", re.I)
non_detail = []
for href in anchors:
    abs_url = urllib.parse.urljoin(SEARCH, href)
    if urllib.parse.urlparse(abs_url).netloc != "www.seek.com.au":
        continue
    if not heur.search(abs_url):
        continue
    if job_id_re.search(abs_url):
        continue
    non_detail.append(abs_url)

# dedupe
non_detail = list(dict.fromkeys(non_detail))
print(f"{len(non_detail)} 'job-ish' but not detail URLs:")
for u in non_detail[:8]:
    print(f"  {u}")

# Step 2: probe a real detail URL
if seek_jobs:
    detail = seek_jobs[0]
    print(f"\n=== Step 2: probing detail URL {detail} ===")
    d = fetch(detail)
    dh = d.get("html") or ""
    title = re.search(r"<title>([^<]*)</title>", dh, re.I)
    print(f"HTML size: {len(dh)} chars")
    print(f"Title: {title.group(1)[:100] if title else 'NONE'}")
    print(f"Has 'enable javascript': {bool(re.search(r'enable javascript', dh, re.I))}")
    print(f"Has react-root marker: {bool(re.search(r'id=\"react-root\"|window\\.__INITIAL_STATE__|_next/static', dh))}")
    print(f"Body text (first 300 chars):")
    body = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", dh)
    body = re.sub(r"\s+", " ", body).strip()
    print(f"  {body[:400]}")
