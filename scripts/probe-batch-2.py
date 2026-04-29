#!/usr/bin/env python3
"""Probe a batch of candidate sources for the À tester bucket.

Mix of: more Seek keyword searches, major AU aggregators (Jora, Indeed,
Adzuna), backpacker-focused boards. We're looking for: server-rendered HTML,
≥30 same-host job-ish anchors, and a clean URL pattern we can target.
"""
import json
import re
import urllib.parse
import urllib.request
from collections import Counter

CANDIDATES = [
    # More Seek keyword variants (already have fruit_picking + hospitality)
    ("seek_farm",        "https://www.seek.com.au/farm-jobs"),
    ("seek_harvest",     "https://www.seek.com.au/harvest-jobs"),
    ("seek_packing",     "https://www.seek.com.au/packing-jobs"),
    ("seek_kitchenhand", "https://www.seek.com.au/kitchenhand-jobs"),
    ("seek_cleaner",     "https://www.seek.com.au/cleaner-jobs"),
    ("seek_construction","https://www.seek.com.au/construction-labourer-jobs"),
    # AU aggregators
    ("jora_fruit",       "https://au.jora.com/jobs?q=fruit+picking&l=Australia"),
    ("jora_farm",        "https://au.jora.com/jobs?q=farm+work&l=Australia"),
    ("indeed_fruit",     "https://au.indeed.com/jobs?q=fruit+picking&l=Australia"),
    ("adzuna_farm",      "https://www.adzuna.com.au/search?q=farm+work"),
    # WHV-specific
    ("whvjobs",          "https://www.workingholidayjobs.com.au/"),
    ("travellers_jobs",  "https://www.travellersautobarn.com.au/jobs-board/"),
]

HEUR = re.compile(r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b", re.I)

with open("/opt/jobclub-claude-proxy/.env") as f:
    for line in f:
        if line.startswith("CLAUDE_PROXY_SECRET="):
            SECRET = line.split("=", 1)[1].strip()
            break

print(f"{'name':<22}{'http':>6}  {'size':>8}  {'jobs':>6}  title")
print("-" * 110)

for name, url in CANDIDATES:
    payload = json.dumps({"url": url}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:8090/fetch-html",
        data=payload,
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
            html = data.get("html") or ""
            status = data.get("status") or 200
    except Exception as e:
        print(f"{name:<22}{'ERR':>6}  {'-':>8}  {'-':>6}  {str(e)[:60]}")
        continue

    if not html:
        print(f"{name:<22}{status:>6}  {'EMPTY':>8}  {'-':>6}  (no html)")
        continue

    title_m = re.search(r"<title>([^<]*)</title>", html, re.I)
    title = (title_m.group(1).strip()[:55] if title_m else '(no title)')
    base_host = urllib.parse.urlparse(url).netloc
    seen = set()
    detail_pattern_counts: Counter = Counter()
    for href in re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I):
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")): continue
        abs_url = urllib.parse.urljoin(url, href)
        if urllib.parse.urlparse(abs_url).netloc != base_host: continue
        if not HEUR.search(abs_url): continue
        seen.add(abs_url)
        # Crude pattern signature: first 2 path segments
        parsed = urllib.parse.urlparse(abs_url)
        segs = [s for s in parsed.path.split('/') if s][:2]
        sig = '/' + '/'.join(segs) if segs else '/'
        detail_pattern_counts[sig] += 1

    print(f"{name:<22}{status:>6}  {len(html):>8}  {len(seen):>6}  {title}")
    if seen:
        # Print the top 2 path patterns to hint at URL shape
        top = detail_pattern_counts.most_common(2)
        sig_str = ', '.join(f'{s} ({n})' for s, n in top)
        print(f"{'':<22}{'':>6}  {'':>8}  {'':>6}  patterns: {sig_str}")
