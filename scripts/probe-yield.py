#!/usr/bin/env python3
"""Estimates per-source listing yield by replicating the generic_career_page
adapter's heuristic against the live HTML. For each working JobSource, fetch
its configured URL via the proxy and count unique anchor hrefs that match the
careers/jobs heuristic OR the source's configured jobLinkPattern.

This is the difference between "page loads" (which we already verified) and
"adapter finds links" (the actual signal that determines whether a scan run
will produce candidates).
"""
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request

# Same heuristic as src/lib/sourcing/adapters/generic-career-page.ts
HEURISTIC_RE = re.compile(r"/(jobs?|careers?|positions?|roles?|opportunities?|vacancies)\b", re.IGNORECASE)
ANCHOR_HREF_RE = re.compile(r"<a[^>]+href=[\"']([^\"']+)[\"']", re.IGNORECASE)

# Load proxy secret
SECRET = ""
with open("/opt/jobclub-claude-proxy/.env") as f:
    for line in f:
        if line.startswith("CLAUDE_PROXY_SECRET="):
            SECRET = line.split("=", 1)[1].strip()
            break
if not SECRET:
    print("CLAUDE_PROXY_SECRET missing", file=sys.stderr); sys.exit(1)

# Pull working sources + their custom config (jobLinkPattern if set)
SQL = (
    "SELECT slug || E'\\t' || (config->>'url') || E'\\t' || COALESCE(config->>'jobLinkPattern','') "
    "FROM \"JobSource\" "
    "WHERE \"healthStatus\" = 'working' AND adapter = 'generic_career_page' "
    "ORDER BY slug;"
)
out = subprocess.run(
    ["docker", "compose", "exec", "-T", "db", "psql", "-U", "jobclub", "-d", "jobclub", "-t", "-A", "-c", SQL],
    cwd="/data/job-club", capture_output=True, text=True,
)
if out.returncode != 0:
    print(f"psql failed: {out.stderr}", file=sys.stderr); sys.exit(1)

rows = []
for line in out.stdout.strip().splitlines():
    parts = line.split("\t")
    if len(parts) >= 2 and parts[0] and parts[1]:
        slug = parts[0].strip()
        url = parts[1].strip()
        pattern = parts[2].strip() if len(parts) > 2 else ""
        rows.append((slug, url, pattern))

print(f"=== Yield probe: {len(rows)} working sources ===\n")
print(f"{'slug':<32}{'url-host':<30}{'job_links':>10}  {'verdict'}")
print("-" * 95)

results = []
for slug, url, pattern in rows:
    payload = json.dumps({"url": url}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:8090/fetch-html",
        data=payload,
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
            html = data.get("html") or ""
    except Exception as e:
        print(f"{slug:<32}{'fetch error':<30}{'—':>10}  {str(e)[:30]}")
        results.append((slug, 0, "fetch_error"))
        continue

    base = url
    hrefs = ANCHOR_HREF_RE.findall(html)
    matching = set()
    for href in hrefs:
        if not href or href.startswith(("javascript:", "mailto:", "#", "tel:")):
            continue
        try:
            absolute = urllib.parse.urljoin(base, href)
        except Exception:
            continue
        # Filter: must be on same host (don't follow off-site links)
        try:
            parsed = urllib.parse.urlparse(absolute)
            base_host = urllib.parse.urlparse(base).netloc
            if parsed.netloc != base_host:
                continue
        except Exception:
            continue

        # Match using configured jobLinkPattern OR fallback to heuristic
        is_match = False
        if pattern:
            if pattern in absolute:
                is_match = True
            else:
                # Try regex if pattern looks like one
                try:
                    if re.search(pattern, absolute):
                        is_match = True
                except re.error:
                    pass
        if not is_match and HEURISTIC_RE.search(absolute):
            is_match = True
        if is_match:
            matching.add(absolute)

    count = len(matching)
    verdict = "OK" if count >= 3 else ("low" if count >= 1 else "ZERO — may need custom selector")
    host = urllib.parse.urlparse(url).netloc[:28]
    print(f"{slug:<32}{host:<30}{count:>10}  {verdict}")
    results.append((slug, count, verdict))

print()
ok = sum(1 for _, c, _ in results if c >= 3)
low = sum(1 for _, c, _ in results if 1 <= c < 3)
zero = sum(1 for _, c, _ in results if c == 0)
print(f"=== Summary ===")
print(f"  ≥3 links found (OK):   {ok}")
print(f"  1-2 links (low):       {low}")
print(f"  0 links (needs work):  {zero}")
