#!/usr/bin/env python3
"""Probe horticulturejobs.com.au to see if generic_career_page can adapt it.

We need:
  - HTML loads via the Claude proxy (not behind a JS-only SPA)
  - Each job listing has its own URL (not a modal/JS-only)
  - URLs follow a pattern the heuristic or jobLinkPattern can match
  - Detail pages have title/company/description for Claude extraction

Outputs: HTML size, sample job-anchor URLs (same-host only), and what the
URL pattern looks like — informs whether we set jobLinkPattern.
"""
import json
import re
import urllib.parse
import urllib.request
from collections import Counter

URL = "https://horticulturejobs.com.au/"
HEUR = re.compile(r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b", re.I)

with open("/opt/jobclub-claude-proxy/.env") as f:
    for line in f:
        if line.startswith("CLAUDE_PROXY_SECRET="):
            SECRET = line.split("=", 1)[1].strip()
            break

req = urllib.request.Request(
    "http://127.0.0.1:8090/fetch-html",
    data=json.dumps({"url": URL}).encode(),
    headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as r:
    html = json.loads(r.read().decode("utf-8", "replace")).get("html") or ""

print(f"HTML length: {len(html)} chars")
print(f"Title tag: {re.search(r'<title>([^<]*)</title>', html, re.I).group(1) if re.search(r'<title>', html, re.I) else 'NONE'}")
print()

# All anchors
all_anchors = re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I)
base_host = urllib.parse.urlparse(URL).netloc

same_host_paths = []
for href in all_anchors:
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        continue
    abs_url = urllib.parse.urljoin(URL, href)
    parsed = urllib.parse.urlparse(abs_url)
    if parsed.netloc == base_host:
        same_host_paths.append(parsed.path)

print(f"Total anchors: {len(all_anchors)}, same-host: {len(same_host_paths)}")

# Path-prefix histogram (first 2 path segments)
prefix_counts = Counter()
for p in same_host_paths:
    parts = [s for s in p.split("/") if s]
    prefix = "/" + "/".join(parts[:2]) if parts else "/"
    prefix_counts[prefix] += 1

print("\n=== Top path prefixes (first 2 segments) ===")
for prefix, n in prefix_counts.most_common(15):
    print(f"  {n:>4}  {prefix}")

# Heuristic-matching anchors (same-host)
job_anchors = []
seen = set()
for href in all_anchors:
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        continue
    abs_url = urllib.parse.urljoin(URL, href)
    parsed = urllib.parse.urlparse(abs_url)
    if parsed.netloc != base_host:
        continue
    if not HEUR.search(abs_url):
        continue
    if abs_url in seen:
        continue
    seen.add(abs_url)
    job_anchors.append(abs_url)

print(f"\n=== Heuristic-matching same-host job anchors: {len(job_anchors)} ===")
for u in job_anchors[:20]:
    print(f"  {u}")

# Look for common job-board frameworks (often hint at adapter)
markers = {
    "WordPress (wp-content)": r"wp-content/",
    "Job Manager plugin (wpjobmanager)": r"wpjobmanager|job_listing",
    "WP Job Board": r"wpjobboard",
    "Greenhouse iframe": r"greenhouse\.io",
    "Workable": r"workable\.com",
    "Lever": r"lever\.co",
    "JS-only marker (next/_buildManifest)": r"_next/static",
}
print("\n=== Framework markers ===")
for label, pat in markers.items():
    if re.search(pat, html, re.I):
        print(f"  HIT: {label}")
