#!/usr/bin/env python3
"""Probe multiple candidate URLs in one shot. For each: HTML size, title,
heuristic-matching same-host anchor count, sample 5 anchors, framework
markers. Used to decide which to add as JobSources for Option B.
"""
import json
import re
import urllib.parse
import urllib.request

CANDIDATES = [
    ("hospitalityjobs",  "https://www.hospitalityjobs.com.au/"),
    ("fruitpickingjobs", "https://www.fruitpickingjobs.com.au/"),
    ("seek_fruit",       "https://www.seek.com.au/fruit-picking-jobs"),
    ("gumtree_farm",     "https://www.gumtree.com.au/s-farm-work/k0"),
    ("backpackerwork",   "https://backpackerjobboard.com.au/"),
    ("agrilabour",       "https://www.agrilabour.com.au/jobs/"),
]

HEUR = re.compile(r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b", re.I)

with open("/opt/jobclub-claude-proxy/.env") as f:
    for line in f:
        if line.startswith("CLAUDE_PROXY_SECRET="):
            SECRET = line.split("=", 1)[1].strip()
            break

print(f"{'name':<22}{'http':>6}  {'size':>8}  {'jobs':>6}  title / sample anchor")
print("-" * 130)

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
        print(f"{name:<22}{'ERR':>6}  {'-':>8}  {'-':>6}  {str(e)[:80]}")
        continue

    if not html:
        print(f"{name:<22}{status:>6}  {'EMPTY':>8}")
        continue

    title_match = re.search(r"<title>([^<]*)</title>", html, re.I)
    title = title_match.group(1).strip()[:50] if title_match else "(no title)"

    base_host = urllib.parse.urlparse(url).netloc
    anchors = re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I)
    seen = set()
    matches = []
    for href in anchors:
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        abs_url = urllib.parse.urljoin(url, href)
        parsed = urllib.parse.urlparse(abs_url)
        if parsed.netloc != base_host:
            continue
        if not HEUR.search(abs_url):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        matches.append(abs_url)

    sample = matches[0][:80] if matches else "(none)"
    print(f"{name:<22}{status:>6}  {len(html):>8}  {len(matches):>6}  {title}")
    print(f"{'':<38}{'':>6}  {sample}")

    # Framework markers
    fw = []
    if re.search(r"_next/static", html): fw.append("Next.js SPA")
    if re.search(r"wp-content/", html): fw.append("WordPress")
    if re.search(r"id=\"react-root\"|window\.__INITIAL_STATE__", html): fw.append("React SPA")
    if re.search(r"cloudflare|cf-ray", html, re.I): fw.append("Cloudflare")
    if re.search(r"please enable javascript|enable js", html, re.I): fw.append("JS-required")
    if fw:
        print(f"{'':<38}{'':>6}  fw: {', '.join(fw)}")
