-- HorticultureJobs.com.au — Australia's horticulture job board.
-- WordPress + WP Job Manager. Server-rendered HTML.
-- Probe found 53 unique /job/<slug> permalinks on the homepage; multiple states
-- (TAS, QLD, SA, NSW, VIC, WA) baked into URL slugs. Adapter: generic_career_page.
-- jobLinkPattern = "/job/" filters detail pages cleanly (rejects /jobs/ index
-- and /job-locations/ taxonomy, both of which the heuristic would otherwise hit).

INSERT INTO "JobSource" (
  id, slug, label, category, "sheetTab", "ingestionStrategy",
  enabled, adapter, config, profile,
  "healthStatus", "consecutiveFailures",
  "totalSeen", "totalApproved", "totalRejected"
) VALUES (
  'src_seed_horticulturejobs_au',
  'horticulturejobs_au',
  'HorticultureJobs.com.au',
  'aggregator',
  'website',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://horticulturejobs.com.au/","jobLinkPattern":"/job/","defaultCategory":"farm"}'::jsonb,
  '{"expectedMinListings":10,"notes":"Job board national d''horticulture (WordPress + WP Job Manager). Plus de 50 annonces avec URLs propres /job/<slug>/. Plusieurs États (TAS, QLD, SA, NSW, VIC, WA) selon les annonces. Catégorie par défaut farm — beaucoup d''annonces sont arboriculture/golf/turf, à filtrer en revue selon le public WHV (88-day farm work)."}'::jsonb,
  'unverified',
  0,
  0, 0, 0
)
ON CONFLICT (slug) DO NOTHING;

SELECT slug, label, category, "sheetTab", "ingestionStrategy", adapter, enabled, "healthStatus",
       config->>'url' as url, profile->>'expectedMinListings' as min_expected
FROM "JobSource" WHERE slug = 'horticulturejobs_au';
