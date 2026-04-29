-- Fix the jobLinkPattern bug on Seek sources.
--
-- The adapter's matchesPattern() in src/lib/sourcing/adapters/generic-career-page.ts
-- treats any pattern starting with '/' that has a second '/' inside as a regex.
-- The previous pattern "/job/" was therefore parsed as regex /job/ — body=`job`,
-- empty flags — which matches the literal string "job" *anywhere* in the URL.
-- Result: it matched detail pages (correct) but also matched
-- /career-advice, /jobs?advertiserid=..., /fruit-picking-jobs-in-government-defence
-- etc., causing 80% of Seek extractions to fail (Claude can't extract a job
-- from a category-search page).
--
-- Fix: use a regex that anchors to /job/ followed by one-or-more digits — the
-- exact shape of a real Seek job permalink (/job/91741939).
--
-- Note: pattern is still passed via matchesPattern's regex branch; the literal
-- backslashes in the JSON string become \\/job\\/\\d+ which Postgres jsonb
-- stores as \/job\/\d+, which the JS adapter parses as the regex /\/job\/\d+/.

UPDATE "JobSource"
SET config = jsonb_set(
  config,
  '{jobLinkPattern}',
  '"/\\/job\\/\\d+/"'::jsonb
)
WHERE slug IN ('seek_fruit_picking', 'seek_hospitality');

SELECT slug, config->>'jobLinkPattern' AS pattern, config->>'url' AS url
FROM "JobSource"
WHERE slug IN ('seek_fruit_picking', 'seek_hospitality');
