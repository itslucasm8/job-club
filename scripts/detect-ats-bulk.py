#!/usr/bin/env python3
"""Bulk ATS detection: probes every working JobSource via the Claude proxy
and regex-sniffs the HTML for embedded Greenhouse / Workable / Lever /
SmartRecruiters / Workday / BambooHR markers.

Run on the VPS as:
    python3 /tmp/detect-ats-bulk.py

Reads CLAUDE_PROXY_SECRET from /opt/jobclub-claude-proxy/.env, talks to the
local proxy at 127.0.0.1:8090, queries Postgres directly via docker exec.

Output: tab-separated `slug<TAB>verdict` lines for matches; summary at the
end. No DB writes — caller decides what to apply.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

PROXY_URL = "http://127.0.0.1:8090/fetch-html"

# Load proxy secret from the systemd unit's env file
SECRET = ""
try:
    with open("/opt/jobclub-claude-proxy/.env") as f:
        for line in f:
            if line.startswith("CLAUDE_PROXY_SECRET="):
                SECRET = line.split("=", 1)[1].strip()
                break
except Exception as e:
    print(f"failed to read secret: {e}", file=sys.stderr)
    sys.exit(1)

if not SECRET:
    print("CLAUDE_PROXY_SECRET not found", file=sys.stderr)
    sys.exit(1)

# Pull the list of working sources from Postgres via docker exec
SQL = (
    "SELECT slug || E'\\t' || (config->>'url') FROM \"JobSource\" "
    "WHERE \"healthStatus\" = 'working' AND adapter = 'generic_career_page' "
    "ORDER BY slug;"
)
out = subprocess.run(
    ["docker", "compose", "exec", "-T", "db", "psql", "-U", "jobclub", "-d", "jobclub", "-t", "-A", "-c", SQL],
    cwd="/data/job-club",
    capture_output=True,
    text=True,
)
if out.returncode != 0:
    print(f"psql failed: {out.stderr}", file=sys.stderr)
    sys.exit(1)

rows = []
for line in out.stdout.strip().splitlines():
    if "\t" in line:
        slug, url = line.split("\t", 1)
        if slug and url:
            rows.append((slug.strip(), url.strip()))

print(f"=== Probing {len(rows)} working sources for ATS markers ===\n")

# Detection patterns — same as src/app/api/admin/sources/detect-ats/route.ts
PATTERNS = [
    ("greenhouse_api", r"boards\.greenhouse\.io/embed/jobs\?for=([a-z0-9_-]+)", "Greenhouse iframe"),
    ("greenhouse_api", r"boards-api\.greenhouse\.io/v1/boards/([a-z0-9_-]+)/", "Greenhouse API URL"),
    ("greenhouse_api", r"boards\.greenhouse\.io/([a-z0-9_-]+)[/\"'\s]", "Greenhouse public board"),
    ("workable_api", r"apply\.workable\.com/api/v3/accounts/([a-z0-9_-]+)/", "Workable API"),
    ("workable_api", r"apply\.workable\.com/([a-z0-9_-]+)[/\"'\s]", "Workable public board"),
    ("lever_api", r"api\.lever\.co/v0/postings/([a-z0-9_-]+)", "Lever API"),
    ("lever_api", r"jobs\.lever\.co/([a-z0-9_-]+)[/\"'\s]", "Lever public board"),
    ("smartrecruiters", r"api\.smartrecruiters\.com/v1/companies/([a-z0-9_-]+)/postings", "SmartRecruiters"),
    ("workday",  r"([a-z0-9_-]+)\.myworkdayjobs\.com", "Workday"),
    ("bamboohr", r"([a-z0-9_-]+)\.bamboohr\.com/jobs", "BambooHR"),
]
SKIP = {"embed", "jobs", "careers", "vacancies", "v1", "v3", "api", "boards", "user",
        "accounts", "wp-content", "wp-includes", "static"}

print(f"{'slug':<32}{'adapter':<22}{'slug':<24}{'evidence'}")
print("-" * 100)

matches = []
for slug, url in rows:
    payload = json.dumps({"url": url}).encode()
    req = urllib.request.Request(
        PROXY_URL,
        data=payload,
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    html = ""
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
            html = data.get("html") or ""
    except Exception as e:
        print(f"{slug:<32}{'fetch error':<22}{str(e)[:50]}")
        continue

    found = None
    for adapter, pat, label in PATTERNS:
        m = re.search(pat, html, re.IGNORECASE)
        if not m:
            continue
        captured = m.group(1).lower()
        if captured in SKIP:
            continue
        found = (adapter, captured, label)
        break

    if found:
        adapter, captured, label = found
        print(f"{slug:<32}{adapter:<22}{captured:<24}{label}")
        matches.append((slug, adapter, captured, label))
    else:
        print(f"{slug:<32}{'no ATS detected':<22}—")

print()
print(f"=== Summary: {len(matches)} ATS matches found ===")
if matches:
    print()
    print("Recommended SQL patches:")
    for slug, adapter, board_slug, label in matches:
        print(
            f"UPDATE \"JobSource\" SET adapter = '{adapter}', "
            f"\"ingestionStrategy\" = 'structured_api', "
            f"config = '{{\"boardSlug\": \"{board_slug}\"}}'::jsonb, "
            f"\"healthStatus\" = 'working' "
            f"WHERE slug = '{slug}';  -- {label}"
        )
