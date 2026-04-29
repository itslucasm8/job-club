-- BFVG (Bundaberg Fruit & Vegetable Growers) - Seasonal:
-- The configured URL is a referral/info page, not a job board. BFVG is a
-- regional industry body whose listings flow through an Expression-of-Interest
-- form (private, employer-initiated contact). The 11 anchors discovered are
-- internal info pages and external referrals — extraction failed for all 11.
-- Disable rather than try to reconfigure: there is no public BFVG jobs URL.
-- Better replacement source for the same audience: horticulturejobs.com.au.

UPDATE "JobSource"
SET
  enabled = false,
  "healthStatus" = 'broken',
  "lastRunError" = 'Source URL is a referral directory, not a job board (BFVG has no public listings page; jobs flow via Expression of Interest form)',
  profile = jsonb_set(
    COALESCE(profile, '{}'::jsonb),
    '{notes}',
    to_jsonb('Désactivé 2026-04-29: l''URL pointe sur une page de référence (où trouver du travail), pas sur des annonces individuelles. BFVG est un organisme régional qui ne publie pas d''offres publiquement — elles passent par un formulaire d''Expression of Interest. Remplacement recommandé: horticulturejobs.com.au (vrai job board national).'::text)
  )
WHERE slug = 'bfvg_seasonal';

SELECT slug, enabled, "healthStatus", "lastRunError", profile->>'notes' as notes
FROM "JobSource" WHERE slug = 'bfvg_seasonal';
