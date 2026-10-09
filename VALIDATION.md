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

## Remaining device/account checks

- The owner created the real private account with their own password. After confirmation emails did not arrive, the owner explicitly approved activating only this account. Activation succeeded; the existing password was preserved.
- Full authenticated browser-to-cloud sync will be verified after the owner can sign in. Sync logic is covered by the unit suite and its server RPCs by the live database suite.
- Installing/trusting the development certificate on the Mac and iPhone, and physical Safari/Home Screen testing, require user/device participation. Certificates and instructions are prepared; trust settings have not been changed automatically.
- Reliable recovery-email delivery and final callback origins need SMTP/URL configuration before live hosting. Hosting is deferred by request.

There is no privileged bootstrap endpoint, and no service-role key in the frontend. The rejected endpoint deployment did not take place.
