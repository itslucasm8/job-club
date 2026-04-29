-- Three more Seek search-URL sources for the À tester bucket.
-- Same shape as seek_fruit_picking + seek_hospitality (already productive):
--   - server-rendered HTML
--   - jobLinkPattern anchors to /job/<digits> (the corrected regex)
--   - per-search defaultCategory pre-set so admin doesn't need to re-tag
-- Three distinct categories: farm (broader than fruit picking),
-- hospitality entry-level (kitchenhand), cleaning (no source yet).

INSERT INTO "JobSource" (
  id, slug, label, category, "sheetTab", "ingestionStrategy",
  enabled, adapter, config, profile,
  "healthStatus", "consecutiveFailures", "totalSeen", "totalApproved", "totalRejected"
) VALUES
(
  'src_seed_seek_farm',
  'seek_farm',
  'Seek — Farm',
  'aggregator',
  'seek',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://www.seek.com.au/farm-jobs","jobLinkPattern":"/\\\\/job\\\\/\\\\d+/","defaultCategory":"farm"}'::jsonb,
  '{"expectedMinListings":15,"notes":"Seek search large catégorie farm — complète seek_fruit_picking. ~78 ancres /job/<id> sur la page de recherche. Fort recouvrement attendu avec fruit_picking; la dédupe par URL gère."}'::jsonb,
  'unverified', 0, 0, 0, 0
),
(
  'src_seed_seek_kitchenhand',
  'seek_kitchenhand',
  'Seek — Kitchenhand',
  'aggregator',
  'seek',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://www.seek.com.au/kitchenhand-jobs","jobLinkPattern":"/\\\\/job\\\\/\\\\d+/","defaultCategory":"hospitality"}'::jsonb,
  '{"expectedMinListings":15,"notes":"Seek search kitchenhand — entry-level hospo, idéal WHV (pas de qualif requise). ~74 ancres /job/<id>. Complète seek_hospitality (qui ratisse plus large mais inclut plus de bruit pro)."}'::jsonb,
  'unverified', 0, 0, 0, 0
),
(
  'src_seed_seek_cleaner',
  'seek_cleaner',
  'Seek — Cleaner',
  'aggregator',
  'seek',
  'generic_web',
  true,
  'generic_career_page',
  '{"url":"https://www.seek.com.au/cleaner-jobs","jobLinkPattern":"/\\\\/job\\\\/\\\\d+/","defaultCategory":"cleaning"}'::jsonb,
  '{"expectedMinListings":15,"notes":"Seek search cleaner — première source en catégorie cleaning. WHV friendly (peu de qualifs), revenus horaires. À vérifier avant le 1er run complet (pattern non testé encore mais Seek est uniforme)."}'::jsonb,
  'unverified', 0, 0, 0, 0
)
ON CONFLICT (slug) DO NOTHING;

SELECT slug, label, "healthStatus", enabled, config->>'url' AS url,
       config->>'jobLinkPattern' AS pattern, config->>'defaultCategory' AS cat
FROM "JobSource"
WHERE slug IN ('seek_farm', 'seek_kitchenhand', 'seek_cleaner')
ORDER BY slug;
