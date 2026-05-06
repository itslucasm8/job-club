# Candidates Page Backlog (2026-05-06)

17 active items from today's audit. Items #16 (keyboard shortcuts) and #17
(score breakdown tooltip) explicitly skipped per Lucas.

## Status legend
- 🔴 = data-integrity / production-launch blocker
- 🟠 = real polish, ship before promoting to all subscribers
- 🟡 = nice-to-have, post-launch
- ✅ = shipped

---

## Chunk 1 — must-fix before paid users (5 items)

🔴 **C-1. Transactional approve** *(`approve/route.ts:71-97`)*
Job creation + JobCandidate update + JobSource counter bump are 3 separate
writes. A crash between writes leaves a public Job with a `pending`
candidate → next click creates a duplicate Job.
**Fix:** wrap in `prisma.$transaction`, move the status check inside.

🔴 **C-2. Idempotency guard on parallel approve clicks**
Same root cause as C-1: pre-transaction status check is non-atomic. Two
near-simultaneous POSTs both pass the check and both create Jobs.
**Fix:** part of C-1's transaction; assert `candidate.status !== 'approved'`
inside the transaction.

🔴 **C-3. `Job.sourceUrl` needs unique partial index**
Even with C-1 fixed, two different candidate rows for the same URL
(extension + scraper) can produce duplicate Jobs.
**Fix:** Prisma migration adding a unique index on `sourceUrl` (where not
null) + handle the constraint inside the approve transaction (return 409
"déjà publié" instead of throwing).

🔴 **C-4. Surface bulk-action errors per row**
`bulkApprove` / `bulkReject` show count only ("3 failed"). Admin doesn't
know which rows or why. Mirror the fix shipped for Sources bulk-toggle.
**Fix:** collect failed IDs + reasons, display inline.

🔴 **C-5. Notification reliability after approve**
`createJobNotifications` runs fire-and-forget after `prisma.job.create`. If
it crashes (Resend down, DB blip), the Job is public but no subscribers
get notified — defeats the app's core function.
**Fix:** add `notificationsSent: bool` (+ `notificationsAttemptedAt`) on
Job. Cron re-attempts unsent rows. Approve route stays fast.

---

## Chunk 2 — production polish (9 items)

🟠 **C-6. Replace `alert()` with Toast** (5 call sites in `page.tsx`).
Use the existing `Toast` component from `src/components/`.

🟠 **C-7. Optimistic tab-count updates after bulk action**
Currently counts only refresh on full refetch. Decrement source-tab count
+ increment destination-tab count in-memory after each successful action.

🟠 **C-8. SSRF allowlist on `from-url` / `from-urls-bulk`**
Block private IP ranges, `localhost`, `host.docker.internal`. Admin-only,
but principled defense.

🟠 **C-9. Prefer `raw.eligibility_88_days` verdict over regex fallback**
*(`approve/route.ts:9-12`)* Current `detect88Days` regex matches "whv
eligible" everywhere. The deterministic verdict from the eligibility
module is in `raw.eligibility_88_days`; use it first, regex only as
last-resort fallback.

🟠 **C-10. Unsaved-changes guard on edit form**
Closing the expanded card mid-edit silently loses changes. Add inline
"unsaved changes" warning + a confirm before close.

🟠 **C-11. Smart-sort score visibility**
"Smart sort (best first)" reorders cards but admin has no idea why one
ranks above another. Show the computed score (small "+5" / "-2" badge).

🟠 **C-12. Styled bulk-action confirm modal**
Replace `window.confirm()` with a styled modal that previews the affected
candidates by title.

🟠 **C-13. Name `MAX_URLS` / `CONCURRENCY` constants**
In `from-urls-bulk/route.ts`. Add rationale comment near the top.

🟠 **C-14. Stronger warning when bulk-approving from `auto_rejected` tab**
Auto-rejected = classifier flagged red signals. Bulk-approving them
defeats the safety net. Require typed confirmation ("OUI" or similar).

---

## Chunk 3 — nice-to-haves (3 items)

🟡 **C-15. Preview-as-job-card** in expanded view
Render the candidate as the public-facing JobCard so admin sees what
subscribers will see. Catches "phone number lost in formatting" issues.

🟡 **C-18. Unify `approvalScore` (client) and `classifierScore` (server)**
Currently two parallel scoring systems. Compute server-side at extraction
time, store, surface client-side.

🟡 **C-19. Server-side reject reasons enum**
Currently hardcoded in `page.tsx` REJECT_REASONS. Move to a server-side
enum with French translations so changes don't need a deploy.

---

~~C-16. Keyboard shortcuts~~ — **skipped per Lucas (2026-05-06)**.
~~C-17. Approval-score breakdown tooltip~~ — **skipped per Lucas (2026-05-06)**.
