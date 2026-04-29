-- Fix two issues from add-3-seek-variants.sql:
-- 1. Pattern was over-escaped — jsonb stored "/\\/job\\/\\d+/" (two
--    backslashes) instead of "/\/job\/\d+/" (one). Adapter's matchesPattern
--    parses backslash, so two backslashes is wrong (looks for literal \ in URL).
-- 2. seek_farm already existed as an inventory row (Lucas's sheet import had
--    it). The INSERT ... ON CONFLICT DO NOTHING was a no-op; we need UPDATE.

-- Fix the pattern on seek_kitchenhand and seek_cleaner (correct ones halved)
UPDATE "JobSource"
SET config = jsonb_set(config, '{jobLinkPattern}', '"/\\/job\\/\\d+/"'::jsonb)
WHERE slug IN ('seek_kitchenhand', 'seek_cleaner');

-- Configure the existing seek_farm inventory row in place
UPDATE "JobSource"
SET
  label = 'Seek — Farm',
  category = 'aggregator',
  "ingestionStrategy" = 'generic_web',
  enabled = true,
  adapter = 'generic_career_page',
  config = jsonb_build_object(
    'url', 'https://www.seek.com.au/farm-jobs',
    'jobLinkPattern', '/\/job\/\d+/',
    'defaultCategory', 'farm'
  ),
  profile = jsonb_build_object(
    'expectedMinListings', 15,
    'notes', 'Seek search large catégorie farm — complète seek_fruit_picking. ~78 ancres /job/<id>. Fort recouvrement attendu avec fruit_picking; la dédupe par URL gère.'
  ),
  "healthStatus" = 'unverified',
  "consecutiveFailures" = 0
WHERE slug = 'seek_farm';

SELECT slug, label, "healthStatus", enabled,
       config->>'url' AS url,
       config->>'jobLinkPattern' AS pattern,
       config->>'defaultCategory' AS cat
FROM "JobSource"
WHERE slug IN ('seek_farm', 'seek_kitchenhand', 'seek_cleaner')
ORDER BY slug;
