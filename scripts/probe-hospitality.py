#!/usr/bin/env python3
"""Find a workable hospitality job board candidate."""
import json
import re
import urllib.parse
import urllib.request

CANDIDATES = [
    ("hospo_world",       "https://www.hospoworld.com.au/jobs"),
    ("hospitality_online","https://hospitalityonline.com.au/jobs"),
    ("frontline_hospo",   "https://www.frontlinehospitality.com.au/job-seeker/all-jobs"),
    ("scout_hospo",       "https://www.scouttalent.com.au/jobs?industry=hospitality"),
    ("seek_hospo",        "https://www.seek.com.au/hospitality-jobs"),
    ("seek_kitchen",      "https://www.seek.com.au/kitchenhand-jobs"),
    ("seek_farm",         "https://www.seek.com.au/farm-jobs"),
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

    title = (re.search(r"<title>([^<]*)</title>", html, re.I) or [None,"(no title)"]).__getitem__(1) if isinstance(re.search(r"<title>([^<]*)</title>", html, re.I), re.Match) else "(no title)"
    if isinstance(title, str): title = title.strip()[:50]

    base_host = urllib.parse.urlparse(url).netloc
    seen = set()
    for href in re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I):
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")): continue
        abs_url = urllib.parse.urljoin(url, href)
        if urllib.parse.urlparse(abs_url).netloc != base_host: continue
        if not HEUR.search(abs_url): continue
        seen.add(abs_url)

    print(f"{name:<22}{status:>6}  {len(html):>8}  {len(seen):>6}  {title}")
