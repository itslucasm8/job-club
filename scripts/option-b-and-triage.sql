-- =============================================================
-- Option B: add 3 high-yield sources + triage broken/partial
-- =============================================================

BEGIN;

-- ---- New sources ----------------------------------------------

-- 1. Seek — Fruit Picking. Server-rendered search page, ~105 unique /job/N
--    permalinks, multi-state. The de-facto anchor source for WHV farm work.
INSERT INTO "JobSource" (
  id, slug, label, category, "sheetTab", "ingestionStrategy",
  enabled, adapter, config, profile,
  "healthStatus", "consecutiveFailures", "totalSeen", "totalApproved", "totalRejected"
) VALUES (
  'src_seed_seek_fruit_picking',
  'seek_fruit_picking',
  'Seek — Fruit Picking',
  'aggregator',
  'seek',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://www.seek.com.au/fruit-picking-jobs","jobLinkPattern":"/job/","defaultCategory":"farm"}'::jsonb,
  '{"expectedMinListings":15,"notes":"Seek search filtré sur fruit picking. ~100 annonces fraîches par scan, multi-États (NSW/VIC/QLD/SA/WA/TAS). Source à fort volume — la dédupe par URL gère les chevauchements avec d''autres recherches Seek."}'::jsonb,
  'unverified', 0, 0, 0, 0
) ON CONFLICT (slug) DO NOTHING;

-- 2. Seek — Hospitality. ~104 anchors, covers post-88-day work
--    (restaurants, cafes, bars) — useful for the second half of WHV.
INSERT INTO "JobSource" (
  id, slug, label, category, "sheetTab", "ingestionStrategy",
  enabled, adapter, config, profile,
  "healthStatus", "consecutiveFailures", "totalSeen", "totalApproved", "totalRejected"
) VALUES (
  'src_seed_seek_hospitality',
  'seek_hospitality',
  'Seek — Hospitality',
  'aggregator',
  'seek',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://www.seek.com.au/hospitality-jobs","jobLinkPattern":"/job/","defaultCategory":"hospitality"}'::jsonb,
  '{"expectedMinListings":15,"notes":"Seek search hospitality. ~100 annonces fraîches par scan. Cible: WHV après les 88 jours, ou ceux qui font de la salle / cuisine en ville."}'::jsonb,
  'unverified', 0, 0, 0, 0
) ON CONFLICT (slug) DO NOTHING;

-- 3. Backpacker Job Board (BPJB) — direct competitor with broad WHV coverage.
--    Server-rendered, 138 anchors. Category=competitor so it can be filtered
--    out of dashboards if/when Lucas wants to stop scraping it.
INSERT INTO "JobSource" (
  id, slug, label, category, "sheetTab", "ingestionStrategy",
  enabled, adapter, config, profile,
  "healthStatus", "consecutiveFailures", "totalSeen", "totalApproved", "totalRejected"
) VALUES (
  'src_seed_backpacker_job_board',
  'backpacker_job_board',
  'Backpacker Job Board (BPJB)',
  'competitor',
  'website',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://backpackerjobboard.com.au/","jobLinkPattern":"/jobs/","defaultCategory":"farm"}'::jsonb,
  '{"expectedMinListings":20,"notes":"Concurrent direct (210k visits/mo, 15+ ans SEO). 138 ancres détectées sur la home. Catégorie=competitor — Lucas peut désactiver si la stratégie change. Voir memory project_competitor_bpjb.md pour le contexte stratégique."}'::jsonb,
  'unverified', 0, 0, 0, 0
) ON CONFLICT (slug) DO NOTHING;

-- ---- Disable 4 broken small farms (no public listings page) ----

-- These are all small farms whose careers page is a static info blurb,
-- not a job listings index. Same pattern as bfvg_seasonal: discover()
-- finds zero or only navigation anchors, extraction fails on every one.
-- Better to disable cleanly than to keep retrying the proxy on each scan.

UPDATE "JobSource" SET
  enabled = false,
  "lastRunError" = 'Pas d''index public d''offres — page careers statique sans listings individuels',
  profile = jsonb_set(
    COALESCE(profile, '{}'::jsonb),
    '{notes}',
    to_jsonb('Désactivé 2026-04-30: petite ferme sans page publique d''offres scannable. Soit la page careers est un blurb statique sans annonces, soit le site n''expose rien sous forme de liens individuels. À reconsidérer si le site change de structure ou si on a un contact direct.'::text)
  )
WHERE slug IN ('kalfresh', 'montague', 'pinata_farms', 'simpson_farms');

-- ---- Reset macadamias_australia (mis-marked broken) ------------
-- adapter='extension' means manual / browser-extension territory, not
-- a generic_career_page scrape. Runner shouldn't have been touching it.
-- Clear the broken flag.

UPDATE "JobSource" SET
  "healthStatus" = NULL,
  "consecutiveFailures" = 0,
  "lastRunError" = NULL,
  profile = jsonb_set(
    COALESCE(profile, '{}'::jsonb),
    '{notes}',
    to_jsonb('Adapter=extension — entrée manuelle uniquement, pas de scan automatique. Health reset 2026-04-30 (était broken par erreur, le runner ne devrait pas le toucher).'::text)
  )
WHERE slug = 'macadamias_australia';

-- ---- Lower expectedMinListings on small-yield-by-design partials ----
-- Cattle stations + small farm employers: 1-3 jobs at a time is the
-- *real* yield, not drift. Setting expectedMinListings=1 stops the runner
-- from flagging them as 'partial' on every scan. They'll flip to 'working'
-- on their next discover that returns ≥1.
--
-- Job agencies (sheetTab='job_agency') deliberately excluded — those
-- *should* have 10-50 listings; if partial there it's selector drift.

UPDATE "JobSource" SET
  profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{expectedMinListings}', '1'::jsonb)
WHERE "healthStatus" = 'partial'
  AND "sheetTab" IN ('station', 'website', 'packhouse');

-- ---- Flag job agencies with selector-drift hint ----
-- Keep them partial (real signal) but record the hypothesis so the
-- next person looking knows where to start.

UPDATE "JobSource" SET
  profile = jsonb_set(
    COALESCE(profile, '{}'::jsonb),
    '{notes}',
    to_jsonb('Agence d''emploi: yield attendu 10-50 annonces. Statut partial = drift de sélecteur probable. Action: ouvrir la page, identifier le conteneur d''annonces, ajouter jobLinkSelector ou jobLinkPattern dans config. À traiter en lot quand Lucas voudra creuser le yield.'::text)
  )
WHERE "healthStatus" = 'partial' AND "sheetTab" = 'job_agency';

COMMIT;

-- ---- Verification queries ------------------------------------

SELECT '== New sources ==' AS section;
SELECT slug, label, category, enabled, "healthStatus", config->>'url' AS url
FROM "JobSource"
WHERE slug IN ('seek_fruit_picking', 'seek_hospitality', 'backpacker_job_board');

SELECT '== Disabled broken small farms ==' AS section;
SELECT slug, enabled, "healthStatus"
FROM "JobSource"
WHERE slug IN ('kalfresh', 'montague', 'pinata_farms', 'simpson_farms');

SELECT '== Macadamia reset ==' AS section;
SELECT slug, enabled, "healthStatus", adapter FROM "JobSource" WHERE slug = 'macadamias_australia';

SELECT '== Bucket counts after triage ==' AS section;
SELECT
  CASE
    WHEN adapter IS NULL THEN 'inventory'
    WHEN "healthStatus" = 'broken' THEN 'broken'
    WHEN "healthStatus" = 'partial' THEN 'partial'
    WHEN enabled = false THEN 'configured_off'
    WHEN "healthStatus" = 'working' THEN 'productive'
    WHEN "healthStatus" = 'unverified' THEN 'attention'
    ELSE 'attention_legacy'
  END AS bucket,
  COUNT(*)
FROM "JobSource"
GROUP BY 1
ORDER BY 2 DESC;
