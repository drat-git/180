# Development and testing

[Back to the project](../README.md) · [Architecture](architecture.md)

## Demo setup

Use Node.js 22.12 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and choose **Try the demo mode**. No `.env` file is required. Samples, custom definitions, and answers are stored in IndexedDB; Reset demo clears that identity’s customization and restores its samples without changing other accounts. The timeline stays on Day 3, October 13, 2026.

For the installable production build and offline reload behavior:

```sh
npm run build
npm run preview
```

Open [localhost:4173](http://localhost:4173). Each origin has its own local database, so the development server and production preview do not share local edits. Service-worker caching is enabled only in production builds.

## Project commands

| Command                                       | Purpose                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `npm run dev`                                 | Development server with hot reload on port 3000 |
| `npm run build`                               | TypeScript checks and production bundle         |
| `npm run preview`                             | Serve the production build on port 4173         |
| `npm test`                                    | Unit, component, persistence, and sync tests    |
| `npm run test:watch`                          | Unit tests in watch mode                        |
| `npm run test:e2e`                            | Production-PWA browser workflows                |
| `npm run test:database`                       | Hosted rollback-only SQL integration suites     |
| `npm run setup:https`                         | Generate local HTTPS certificates using mkcert  |
| `npm run dev:https` / `npm run preview:https` | Serve with the generated certificates           |

## Testing

### Unit tests and build

```sh
npm test
npm run build
```

Tests cover logical dates and DST, generic completion predicates, conditional follow-ups, template parity, effective-date changes, answer generations, stale configuration revisions, controls, local transactions, failed writes, account partitioning, pending-patch merging, authentication expiry, task/activity history, and lost acknowledgements. Vitest uses JSDOM and fake IndexedDB. GitHub Actions runs these tests and the production build without private backend credentials.

### Browser workflows

```sh
npx playwright install chromium
npm run build
npm run test:e2e
```

Playwright uses the production preview on port 4173. It runs desktop and iPhone-sized Chromium contexts, including offline reloads, photo persistence, historical protections, calendar previews, theme settings, task workflows, checklist/list customization, and layout checks. Failure traces are retained in ignored test-output directories.

Phone-sized Chromium verifies responsive browser behavior. Physical iPhone Safari, Home Screen installation, notification permissions, and real push delivery require separate device checks. A dated record of previous checks is in [`VALIDATION.md`](../VALIDATION.md); its older sections describe the implementation at that time.

### Database integration

The suites in [`supabase/tests`](../supabase/tests) cover public profiles, starter setup, per-account ownership, daily records, tasks, options and deadlines, automatic daily work, customization, Anti-rot, food fields, push delivery, and Creatine. Each uses rollback-only fixtures to test validation, ownership, atomicity, and idempotent replay.

To run against a configured project, supply `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in the shell, then run:

```sh
npm run test:database
```

The target needs the repository’s migrations and any required push configuration. These checks are separate from CI and should run only against the intended project. A Supabase access token is a server-side credential; never place it in a `VITE_` variable or commit it.

The customization SQL helper runs the relevant migrations and rollback-only suites in an isolated PGlite database without a hosted project or credentials:

```sh
npm install --prefix /tmp/180-sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.9
PGLITE_MODULE=file:///tmp/180-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-customization-local.mjs
```

This helper checks tasks, options, deadlines, automatic daily work, food, Creatine, and customization. Its fixtures exercise configuration revisions, field patches, typed answers, linked work, ownership, and replay safety. It does not establish hosted migration status or replace real Auth, Storage, Edge Function, or push checks. The narrower [`test-task-daily-local.mjs`](../scripts/test-task-daily-local.mjs) helper remains available for the original task/daily boundary.

## Customization development

Use **Your space → Edit Daily Checklist** or **Edit To-Do lists** in either account or demo mode. Checklist saves apply today or the next logical day; list edits apply immediately. The preview uses the same evaluator as the daily page and calendar, and changing its sample answers does not save daily records.

Preserve stable IDs and original operation IDs when changing these workflows. Increment an item’s answer generation for an incompatible input or list-binding change; retain older answers. Test a scheduled tomorrow change followed by an unrelated today edit, stale editors on two clients, manual plus automatic task work with undo, transaction failure/retry, and demo reset. A configuration conflict must retain the draft and require explicit review before retrying against newer definitions.

## Private backend configuration

The public demo is self-contained. Connecting a separate deployment requires its own Supabase project, database migrations and Auth settings.

Copy [`.env.example`](../.env.example) to `.env` and supply your project URL and browser-safe publishable key:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Apply migrations in order. The public-account migration backfills the original owner profile and creates an administrator-only registration switch, initially closed. It does not modify saved records, receipt IDs or earlier migrations. `setup:account` prints setup guidance without reading passwords or calling administrative endpoints.

For a new deployment or public-account rollout:

1. Keep registration closed while applying migrations and deploying the compatible client and `push-settings` function.
2. In Supabase **Authentication → Sign In / Providers**, enable email/password signup and disable **Confirm email**. Retain a minimum password length of eight.
3. After verification, run `update private.registration_settings set enabled=true where singleton;` as an administrator. The trigger creates each account profile from the Auth creation timestamp and validated signup timezone. It cannot be initialized by client-supplied account IDs.
4. Smoke-test signup, onboarding, sign-out and sign-in with disposable accounts, then remove only those fixtures. To pause new registrations, set the switch back to false; existing sign-in and sync continue.

The starter catalog is [`src/lib/starterCatalog.json`](../src/lib/starterCatalog.json). A version is immutable once released; publish a new catalog version through an additive migration. Existing accounts retain frozen initial definitions. The SQL tests compare the client catalog to the server copy.

Configure the Auth Site URL and redirect allowlist for actual deployment and development origins. Password recovery is deferred: leave `VITE_PASSWORD_RECOVERY_ENABLED=false`. The recovery route and link are disabled until a working email sender and recovery redirect URLs are configured. Do not enable the flag alone. Administrator password resets remain outside the public interface. Migrations and generated types live in [`supabase/migrations`](../supabase/migrations) and [`src/lib/database.types.ts`](../src/lib/database.types.ts).

Private push reminders additionally require the Edge Functions in [`supabase/functions`](../supabase/functions), VAPID/scheduler secrets, and the Cron setup defined by the push migration. Server credentials, signing keys, and scheduler tokens must remain outside browser builds.

## Local HTTPS and iPhone checks

The [public deployment](https://180-vlfh.vercel.app) already uses HTTPS. For local device testing, install mkcert and run:

```sh
npm run setup:https
npm run cert:serve
```

Use the current LAN address and trust instructions printed by the setup script. On an iPhone on the same Wi-Fi network, download the public certificate, install its profile, and enable full certificate trust in Settings. Stop the certificate server afterward, build the app, and run `npm run preview:https`. Open the printed HTTPS address in Safari and use **Share → Add to Home Screen**.

Local certificates and authority keys stay in ignored `.cert/` files. The download server exposes only the public certificate. Regenerate certificates when the LAN address changes. Trust and installation are manual device steps; automated browser tests do not perform them.

## Screenshot conventions

The README images are captures of the live public demo, using synthetic samples and the app’s actual Appearance controls. Four of six use Classic Dark; the others show Blue Slate Light and Monochrome Dark on a phone-sized viewport. Completion colors are Forest & Rust and Anti-rot colors are Classic throughout. Images live in [`docs/images`](images).

## Public-account verification

`tests/public-accounts.spec.ts` tests signup UI and onboarding through deterministic API fixtures on desktop and phone, including dependency deselection, draft reload, retry and offline reopening. It does not replace a real Auth signup smoke test. `supabase/tests/public_accounts.sql` verifies the real database profile trigger, catalog, initialization transaction, receipts, list-linked work and two-account isolation using rollback-only fixtures.

An optional isolated PostgreSQL/WASM harness runs database suites without hosted credentials:

```sh
# Install @electric-sql/pglite in a temporary directory, not the app bundle.
PGLITE_MODULE=file:///absolute/path/to/pglite/dist/index.js node scripts/test-public-accounts-local.mjs
```

Hosted push functions additionally need a real token check; installation identity collisions are covered by the handler tests. Real device subscription and delivery checks remain separate.
