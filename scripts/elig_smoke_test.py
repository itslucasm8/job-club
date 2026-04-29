"""Smoke test for eligibility.assess() — runs on the proxy host."""
import sys
sys.path.insert(0, "/opt/jobclub-claude-proxy")
from eligibility import assess

cases = [
    ("Brunswick VIC ag (was false-positive)", {
        "category": "farm", "state": "VIC", "location": "Brunswick VIC 3056",
        "pay": "25/hr", "employmentType": "casual",
        "description": "Farm work in Brunswick VIC 3056"
    }, {"eligibility_88_days": False, "industry": "agriculture"}),
    ("Mildura VIC ag below-award casual", {
        "category": "farm", "state": "VIC", "location": "Mildura VIC 3500",
        "pay": "28/hr", "employmentType": "casual",
        "description": "Fruit picking Mildura"
    }, {"eligibility_88_days": True, "pay_status": "below"}),
    ("Bundaberg piecework", {
        "category": "farm", "state": "QLD", "location": "Bundaberg QLD 4670",
        "pay": "2 per kg, piece rate", "employmentType": "casual",
        "description": "Piece-rate fruit picking"
    }, {"eligibility_88_days": True, "pay_kind": "piece"}),
    ("Sydney CBD ag (NOT eligible)", {
        "category": "farm", "state": "NSW", "location": "Sydney NSW 2000",
        "pay": "30/hr", "employmentType": "casual",
        "description": "Urban farm Sydney"
    }, {"eligibility_88_days": False}),
    ("Hobart construction (TAS all-state)", {
        "category": "construction", "state": "TAS", "location": "Hobart TAS 7000",
        "pay": "32/hr", "employmentType": "casual",
        "description": "Builder Hobart"
    }, {"eligibility_88_days": True, "industry": "construction"}),
    ("Sydney retail (NOT 88-day)", {
        "category": "retail", "state": "NSW", "location": "Sydney NSW 2000",
        "pay": "26/hr", "employmentType": "casual",
        "description": "Shop assistant"
    }, {"eligibility_88_days": False}),
    ("Darwin hospitality (Northern AU - now $24.28 floor)", {
        "category": "hospitality", "state": "NT", "location": "Darwin NT 0800",
        "pay": "31/hr", "employmentType": "casual",
        "description": "Bartender Darwin"
    }, {"eligibility_88_days": True, "industry": "tourism", "pay_status": "above"}),
    ("Cairns hospitality at $25/hr (below new $30.35 casual floor)", {
        "category": "hospitality", "state": "QLD", "location": "Cairns QLD 4870",
        "pay": "25/hr", "employmentType": "casual",
        "description": "Bartender Cairns"
    }, {"eligibility_88_days": True, "industry": "tourism", "pay_status": "below"}),
]

passed = 0
failed = 0
for name, raw, expect in cases:
    v = assess(raw)
    fails = []
    for k, want in expect.items():
        got = v.get(k)
        if got != want:
            fails.append("%s=%r (wanted %r)" % (k, got, want))
    status = "PASS" if not fails else "FAIL"
    if fails:
        failed += 1
    else:
        passed += 1
    print("[%s] %s" % (status, name))
    print("  88j=%s ind=%s award=%s cas=$%s pay=$%s/%s status=%s" % (
        v.get("eligibility_88_days"),
        v.get("industry"),
        v.get("award_id"),
        v.get("award_min_casual_hourly"),
        v.get("pay_parsed_hourly"),
        v.get("pay_kind"),
        v.get("pay_status"),
    ))
    for f in fails:
        print("    !! %s" % f)

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
