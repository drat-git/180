# Validation — October 9, 2026

- Production build: passed; generated application shell, manifest, icons, and a service worker precaching the full app, including offline HEIC-conversion code.
- Unit/component/sync tests: **23 passed**. Includes field thresholds, date boundaries, durable minimization and account-specific display preferences, atomic local saves, quota-failure retry, account partitioning, offline merge behavior, in-flight edits, expired sessions, lost acknowledgements, renewal failures retaining local access, explicit sign-out locking the app, travel keeping future edits queued, and photo deletion cleanup after interrupted uploads.
- Browser acceptance tests: **20 passed**, across desktop and iPhone-sized Chromium. Covers offline reloads, text/photo persistence, historical protections, rollover, counters, swipes, layout, food/cannabis descriptions, correct General/School/Career/Food/Body order and membership, weekend School omission, and minimized blocks/text surviving reloads, app reopening, and day changes until manually reopened. After adding School and Career, 18 passed initially; the two persistence checks passed on rerun after correcting an ambiguous test selector.
- Additional Day 1 screenshot checks: **2 passed**. Outputs: `test-results/180-desktop.png` and `test-results/180-phone.png`.
- Visual refinement: desktop and phone screenshots inspected after separating Food, Body, and General into cards beneath Daily check-in. Serif headings/journal text and distinct numeric controls preserve readable hierarchy without external font downloads. Build, 23 unit tests, and all 20 browser tests passed again.
- School and Career refinement: added matching cards with graduation-cap and briefcase icons; reordered cards to General, School, Career, Food, Body. Desktop and phone screenshots inspected. Build and 23 unit tests passed; all 20 browser scenarios passed, including preserved attendance/application answers and counts after minimizing, reopening, and navigating across a weekend.
- Live database integration suite: **passed**. Tests field patch merge/order, idempotency, validation, image tombstones, authenticated/anonymous isolation, private storage, and the registration gate. All fixtures were rolled back.
- Supabase security advisor: no database findings after the description migration. Auth has a warning for disabled leaked-password protection; see [Supabase password-security settings](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This migration changes only JSON field validation and leaves ownership policies and permissions intact.
- HTTPS certificate chain: **verified** with OpenSSL. Leaf certificate includes localhost and the Mac's current LAN IP.

## Do Stuff implementation — October 9, 2026

- Production build passed. **33 unit/component/sync tests** and **32 desktop/phone Chromium browser tests** passed.
- Tasks support School/Career/Life, one-level subtasks, derived parent completion, rename, hold/keyboard actions, confirmed group deletion, completion sorting, and 12-hour expiry with recheck resets. Completed children remain under unfinished parents. Task-card minimization is independent of daily School/Career minimization.
- Browser checks verify exact expiry, timer resets, hold cancellation during movement, weekend activity visibility, daily historical protections, multiple parent/child selections, retained reasons, persistent selected-list minimization, offline reload, and historical records remaining visible after archive or deletion.
- Sync tests verify remote-title/local-completion merge, pending edits over in-flight acknowledgements, completion history deduplication after lost acknowledgements, stale child creation after remote parent deletion, and task synchronization while future daily travel edits remain queued. Local-write failure tests verify atomic rollback and retry without losing task history.
- Live `daily_record.sql` and `tasks.sql` integration suites passed; all fixtures were rolled back. Both suites run through `npm run test:database` with server-side access credentials. No real-account entries or tasks were created by these tests.
- Additive task/history migrations were applied to the existing Supabase project; new local migration filenames match the versions assigned by the connector. Existing earlier migration history was preserved. Generated database types were refreshed.
- Security advisor: no database findings. The previously documented [disabled leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains. Performance advisor no longer reports missing foreign-key indexes; newly created indexes have informational unused-index notices until meaningful workload uses them.
- Desktop and phone screenshots inspected: `artifacts/180-do-stuff-desktop.png`, `artifacts/180-do-stuff-phone.png`, and matching `180-task-activity` screenshots. Their example tasks exist only in isolated test-browser preview databases.
- No public hosting, archive browser, Anti-Rotting, or calendar screen was added. Physical iPhone Safari/Home Screen installation and full real-account two-device sync remain unverified as described below.

## Answer color refinement — October 10, 2026

- Selected Yes answers use blue with white text; selected No answers use amber with dark text. Shared controls apply the colors to daily check-in and task questions. Unanswered controls retain their neutral styling and selection/clearing behavior.
- Removed the "Just a record. Not a score." footer text. The 2 AM reminder remains aligned to the right.
- Production build, all **33 unit tests**, and all **32 browser tests** passed. Mixed-answer desktop and phone screenshots inspected in isolated local preview contexts. Selected-text contrast is 5.89:1 for Yes and 7.56:1 for No.

## Checklist progress — October 10, 2026

- Added completed/total counts to every applicable block header and the Day header. Counts remain visible when minimized, recalculate with edits/navigation, exclude weekend attendance, and include task activity questions only when present. Unanswered and preserved hidden cannabis counts do not earn completion; cannabis No counts as zero uses.
- Added unit coverage for exact thresholds, zero/missing values, all block totals, weekend exclusions, and task question visibility. All **38 unit tests** and **36 browser tests** passed; browser tests cover live totals, clearing answers, collapsed blocks, task activity totals, navigation, and offline reload.
- Removed "Leave anything unanswered." Production build passed. Progress layouts checked on desktop, iPhone-sized, and 320-pixel-wide screens.

## Answer icons and completion colors — October 10, 2026

- Replaced visible Yes/No text with check/X icons while preserving accessible names, keyboard access, answer clearing, and saved data. Shared controls use dark cyan (`#187d95`) and muted magenta (`#9a5a82`), with white-icon contrast of 4.77:1 and 5.05:1 respectively.
- Cannabis uses the same completion helper for both its selected color and checklist count. No counts as zero uses even when an earlier hidden count is preserved. Yes is cyan at one/two uses and magenta at three or more; reducing the count updates both color and progress immediately.
- All **38 unit tests** and **38 desktop/phone browser tests** passed, along with the production build. New browser coverage verifies icons, exact colors, cannabis thresholds, preserved counts after switching answers, clearing, and reload persistence. Updated desktop and phone screenshots inspected.

## Time input completion borders — October 10, 2026

- Wake time and both screen-time boxes show cyan borders at or below their completion thresholds and muted magenta borders above them. Unanswered/cleared inputs remain neutral. Colors remain visible while inputs are focused, and both screen boxes reflect their combined duration.
- The **40 desktop/phone browser tests** passed, including exact thresholds, midnight/zero values, clearing, focus, and saved-border behavior after reload. After restoring the latest pushed baseline and rebuilding the change, source/test checksums matched that browser-verified version. All **38 unit tests** and the production build passed again.
- An additional isolated visual preview check was not executed because automatic approval review hit an account usage limit; this did not prevent the already-running browser suite from completing.

## Remaining device/account checks

- The owner created the real private account with their own password. After confirmation emails did not arrive, the owner explicitly approved activating only this account. Activation succeeded; the existing password was preserved.
- Full authenticated browser-to-cloud sync will be verified after the owner can sign in. Sync logic is covered by the unit suite and its server RPCs by the live database suite.
- Installing/trusting the development certificate on the Mac and iPhone, and physical Safari/Home Screen testing, require user/device participation. Certificates and instructions are prepared; trust settings have not been changed automatically.
- Reliable recovery-email delivery and final callback origins need SMTP/URL configuration before live hosting. Hosting is deferred by request.

There is no privileged bootstrap endpoint, and no service-role key in the frontend. The rejected endpoint deployment did not take place.
