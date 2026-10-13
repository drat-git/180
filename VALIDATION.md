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

## Anti Rotting and past-day recap — October 10, 2026

- Added your own reusable and one-time ideas, optional expandable notes, edit/hold/delete options, one daily log per activity, and a minimizable Did today list. Completion automatically logs work; same-day reopening removes automatic logging while preserving manual work. One-time completion expires from the active list after 12 elapsed hours and resets on rechecking.
- Past daily screens show read-only Worked on / Completed snapshots after the next 2 AM logical-day boundary. Today's and empty recaps stay hidden. Later editing, deletion, archive, and reopening do not rewrite an ended day's snapshots; late offline sync can fill in historical activity. Recaps do not affect checklist progress or become editable when a past entry is unlocked.
- All **56 unit/sync tests**, **54 desktop/phone browser tests**, the production build, and all **three rollback-only live database suites** passed. Coverage includes logical-day rollover, same/later-day undo, archive timer reset, type conversion, deleted-item log removal, hold cancellation, offline reload, lost acknowledgements, stale edits/logs after remote deletion, two-device logging convergence, pagination, additive Dexie upgrade, failed local write recovery, travel, and delayed cloud history.
- Desktop and phone activity/recap screenshots were inspected. The additive Anti Rotting migration is applied to the existing Supabase project; generated types match it. RLS/permission tests pass. Database advisors report no new security warnings or missing indexes; the previously documented Auth leaked-password warning remains. Real authenticated multi-device browser and physical iPhone testing remain unverified.

## Input, task hierarchy, and Anti Rotting refinements — October 10, 2026

- Compact underlined inputs and auto-growing note/journal textareas keep questions prominent. Daily labels are darker, semibold, and larger. Parent tasks use a stronger title, subtle background, progress count, and connected indented subtasks; completed tasks remain muted and struck through.
- Removed task and activity ellipsis buttons. Long press, context menu, and keyboard options (Shift+F10 or Enter on a focused row) remain available. Anti Rotting has a lavender background, no type captions or extra empty-state prompt, and no separate Did today section. Its per-activity log buttons and historical recaps remain; one-time activities sort before reusable ideas, with completed one-time activities below active one-time activities.
- Production build, all **56 unit/sync tests**, and all **58 desktop/phone browser tests** passed. Browser coverage verifies compact textarea expansion, clearing and resizing after navigation, long-press cancellation, keyboard menus, activity ordering after completion/type conversion, absence of redundant UI, offline persistence, and preserved historical recaps. Updated desktop and phone screenshots inspected. JSDOM's missing ResizeObserver is stubbed in unit setup; real resizing is verified in browser tests.

## Remaining device/account checks

- The owner created the real private account with their own password. After confirmation emails did not arrive, the owner explicitly approved activating only this account. Activation succeeded; the existing password was preserved.
- Full authenticated browser-to-cloud sync will be verified after the owner can sign in. Sync logic is covered by the unit suite and its server RPCs by the live database suite.
- Installing/trusting the development certificate on the Mac and iPhone, and physical Safari/Home Screen testing, require user/device participation. Certificates and instructions are prepared; trust settings have not been changed automatically.
- Production hosting is connected to GitHub through the existing Vercel projects. Reliable recovery-email delivery and callback configuration still require a real recovery-flow check.

There is no privileged bootstrap endpoint, and no service-role key in the frontend. The rejected endpoint deployment did not take place.


## Task question applicability — October 11, 2026

- Restored the latest pushed application baseline (`42a8677`) before implementing the replacement. Removed the discarded daily eligibility capture effects and flags from the application. The already applied experimental migration remains as an audit record; a compensating migration removes its trigger/function without deleting saved data. Legacy flags remain valid input for older queued patches and are ignored by the new calculation.
- Questions and totals now share a calculation using retained tasks/events and saved daily content. Today requires an unfinished task, a parent/child completion today not undone today, or saved content. Earlier completed tasks in their 12-hour display window do not create a new requirement. Past days use unfinished roots at the local 2 AM boundary, qualifying completions that day, or saved content. Same-day deletion removes unanswered requirements; later deletion preserves earlier unfinished days. No daily snapshots or background writes are added.
- **76 unit tests**, **70 desktop/phone browser tests**, and the production build passed. Coverage includes older completion carryover, completed tasks remaining selectable, completion archive, same-day creation/deletion and undo, child completion with parent deletion, automatic parent transitions, saved Yes/No/reasons/title snapshots, weekend counts, unopened days, offline reload, 2 AM and DST boundaries, late cloud history pulls, retired flags, and loading readiness.
- All three rollback-only live database suites passed. They verify hierarchy/history, snapshots, retry idempotency, owner/access isolation, and legacy queued updates with preserved answers. Confirmed the retired trigger/function are absent. Generated database types are unchanged. React review confirmed no capture effects or conditional hooks were introduced.


## Day 4 Food checklist — October 11, 2026

- The cutoff is the stored logical date `2026-10-12` (Day 4), not the device's current day. Days 1–3 retain their original food controls and five-item completion rules. A browser check records all five Day 3 answers and a Snack 2 description, crosses the date boundary, and confirms the earlier stored entry is identical after viewing Day 4 and navigating back. Historical editing protection remains active.
- Day 4 onward has AM Shake/Calorie-Dense Breakfast, Lunch, Dinner, PM Shake, and Snack with its helper text. Required AM shake/meal selection controls its label and completion; clicking the selected Yes resets its answer and choice. No also clears the choice. Optional meal descriptions and reasons remain saved while hidden; shake has no description. Block/text minimization persists, including after offline reload. Renamed meal fields reuse both saved data and existing display preference keys.
- **79 unit/sync tests** and the production build passed. The **74 desktop/phone browser scenarios** passed across the full run and a focused rerun: initially 71 passed; two new tests used a radio-check assertion after the chooser had unmounted, and one existing offline test went offline before cache readiness. Corrected the test actions/readiness wait, then all six focused desktop/phone cases passed. New Food screenshots inspected on desktop and phone; browser checks confirm no horizontal overflow.
- Applied additive migration `20261012034639_day_four_food`. Its only application-schema change is replacing the existing JSON validator function to accept the new fields. It does not delete or rewrite daily records, alter columns, or change ownership policies. The AM answer and choice are stored as one field so concurrent field patches cannot split them. Generated database types remain unchanged because existing JSONB columns and RPC signatures are unchanged.
- All **four rollback-only live database suites** passed, covering daily records/photos, tasks, Anti Rotting, and food. The food suite verifies pending required choice, invalid values, legacy fields, preserved hidden descriptions, different-field merge, and acknowledgement-loss retries. All test mutations were rolled back. Security advisor found no database issues; the previously documented Auth leaked-password setting remains unchanged.


## Tabs, appearance, and reminders — October 12, 2026

- Navigation is Today / To-do / Anti Rotting. Anti Rotting has its own tab, and existing daily recaps/history remain. Daily check-in is labeled Daily checklist. Panels stay mounted so tab changes preserve task drafts; unsaved-write guards remain.
- Your space contains a clear Light/Dark Appearance choice with selected states. Theme persists on the device and is applied before rendering. Dark uses soft charcoal cards, readable controls, and distinct lavender Anti Rotting surfaces. Desktop/phone screenshots are in `artifacts/180-dark-*` and `180-your-space-dark-*`.
- Deployed authenticated notification settings and private reminder-dispatch functions plus one minute-based cron job. Verified real scheduler HTTP 200 responses, private Vault key initialization, rejection of missing/invalid user tokens and invalid scheduler credentials, and isolation of subscription/key data. Existing data was preserved; all database test fixtures roll back.
- 88 unit tests and 78 desktop/phone browser cases passed, including navigation/drafts, theme selection and offline reload, reminder navigation, permission denial, orphan subscription cleanup, failed/offline saves, timezone/DST boundaries, and trusted endpoint validation. All five database suites passed. The production build and formatting checks passed. Generated database types include the additive push schema; reviewed React hooks/accessibility and service-worker cache/update handling.
- Physical iPhone notification permission, test delivery, and scheduled delivery remain a user-device acceptance check. Reminders remain off until explicitly enabled. Default is one reminder at 9 PM every day regardless of daily answers.


## Diet label and Creatine — October 13, 2026

- Renamed Food to Diet, preserving the existing `Food` display-preference key so previously minimized blocks stay minimized. Existing saved values and internal data keys are unchanged.
- Added Creatine after Lifted, beginning with Day 5 (`2026-10-13`). Earlier days retain their three-item Body block and previous totals. New days have four Body checks; Yes counts as complete, No offers an optional Why, and selecting the active answer clears it. Hidden reasons and minimization remain saved. Visibility and counting share the same cutoff constant.
- All **90 unit/sync tests**, **10 focused desktop/phone browser scenarios**, and the production build passed. The new boundary test initially expected an obsolete period in the Day heading; correcting that selector made both reruns pass. Coverage includes the 2 AM cutoff with the old entry retained, navigation to Day 5 and back, old totals, current totals, answer colors/clearing, offline reload, block/reason minimization, and historical unlocking. Desktop/phone Creatine screenshots inspected.
- Applied additive migration `20261013055335_creatine_check`. It extends the existing validator with boolean/null `creatineStatus` and text `creatineReason`, preserving its other fields, signature, permissions, and search path. No saved daily records are rewritten or deleted. Generated database types are unchanged because the data remains in existing JSONB columns.
- The rollback-only daily-record, food, and Creatine database suites passed. They verify ownership/access restrictions, existing fields, new validation, preserved hidden reasons, field merging, clearing, and idempotent acknowledgement-loss retries. All fixture edits were rolled back. Existing [push-table RLS information](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and the previously documented Auth setting remain outside this change; no policies were altered.


## Daily and To-do quotes — October 13, 2026

- Today shows the supplied Aristotle quote beneath the Day header; yesterday retains its editing reminder, now at weight 500 with readable orange colors in light/dark themes. Older days show neither of these notices. The To-do heading uses the supplied James Clear quote.
- Production build and four focused desktop/phone browser checks passed. Existing navigation and theme workflows verify quote visibility by date, the To-do text, yesterday styling in both themes, and unchanged historical editing behavior. Updated dark-theme screenshots retained. No persistence or cloud changes were needed.


## Anti Rotting expansion — October 13, 2026

- Removed the block-level Minimize/Maximize control from the Anti Rotting list and past-day recaps. Both stay expanded even if an older browser preference stored them as minimized. Individual note disclosure controls remain available, and other checklist/task blocks retain their normal minimization behavior.
- Production build, four control/component tests, and four focused desktop/phone browser workflows passed. Regression coverage seeds old minimized preferences and verifies activities/recaps stay accessible without a block toggle; the existing cross-day/reload test verifies other blocks still minimize persistently. Updated Anti Rotting screenshots retained. No cloud or saved-record changes were needed.


## Chevron-only block controls — October 13, 2026

- Daily checklist and To-do card headers now use icon-only up/down chevrons. Buttons are 38 pixels square with 18-pixel icons, while accessible Minimize/Maximize labels, expanded-state semantics, keyboard focus, and stored preferences remain unchanged. Individual text-box disclosure buttons retain their text; Anti Rotting remains non-collapsible.
- Production build, four component/control tests, and four focused desktop/phone browser workflows passed. Checks verify persistent minimization across navigation/reloads and task/daily layouts; updated screenshots retained and phone To-do layout inspected.


## Anti-rot wording — October 13, 2026

- The switcher tab is labeled Anti-rot. Its activity-card heading is "Things to do instead of scrolling", followed by "Topics to explore, skills to learn, specific media, activities, places to go, etc". Existing purple styling, stored activities, note preferences, and non-collapsible behavior are preserved. Past-day recap content remains unchanged.
- Production build and six focused desktop/phone browser scenarios passed, covering the exact new copy, tab navigation, retained styling, layout width, activity ordering/history, and dark mode. Updated screenshots retained; phone activity-card layout inspected. No cloud or data changes were needed.
