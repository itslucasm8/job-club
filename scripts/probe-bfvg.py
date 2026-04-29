#!/usr/bin/env python3
"""Inspect what anchors the bfvg_seasonal source surfaces — i.e. what URLs
the runner is handing to Claude extraction. If they're third-party career
pages (not single job postings), that explains the 100% extraction failure.
"""
import json
import re
import urllib.parse
import urllib.request

URL = "https://bfvg.com.au/careers-in-horticulture/working-in-the-horticulture-industry/where-to-find-work/"
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

print(f"HTML length: {len(html)} chars\n")

links = re.findall(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>([\s\S]{0,200}?)</a>", html, re.I)
base_host = urllib.parse.urlparse(URL).netloc

same_host = []
off_host = []
for href, text in links:
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        continue
    abs_url = urllib.parse.urljoin(URL, href)
    parsed = urllib.parse.urlparse(abs_url)
    if not HEUR.search(abs_url):
        continue
    label = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text)).strip()
    bucket = same_host if parsed.netloc == base_host else off_host
    bucket.append((abs_url, parsed.netloc, label))

print(f"=== Same-host job-ish anchors ({len(same_host)}) ===")
for u, h, t in same_host[:20]:
    print(f"  [{h}]")
    print(f"    {u[:110]}")
    print(f"    label: {t[:80]}")
    print()

print(f"=== Off-host job-ish anchors ({len(off_host)}) ===")
for u, h, t in off_host[:20]:
    print(f"  [{h}]")
    print(f"    {u[:110]}")
    print(f"    label: {t[:80]}")
    print()
