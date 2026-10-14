# Development and testing

[Back to the project](../README.md) · [Architecture](architecture.md)

## Demo setup

Use Node.js 22.12 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and choose **Try the demo mode**. No `.env` file is required. Samples and edits are stored in IndexedDB; Reset demo restores the samples for that demo identity. The timeline stays on Day 3, October 13, 2026.

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

Tests cover logical dates and DST, completion thresholds, controls, local transactions, failed writes, account partitioning, pending-patch merging, authentication expiry, task/activity history, and lost acknowledgements. Vitest uses JSDOM and fake IndexedDB. GitHub Actions runs these tests and the production build without private backend credentials.

### Browser workflows

```sh
npx playwright install chromium
npm run build
npm run test:e2e
```

Playwright uses the production preview on port 4173. It runs desktop and iPhone-sized Chromium contexts, including offline reloads, photo persistence, historical protections, calendar previews, theme settings, task workflows, and layout checks. Failure traces are retained in ignored test-output directories.

Phone-sized Chromium verifies responsive browser behavior. Physical iPhone Safari, Home Screen installation, notification permissions, and real push delivery require separate device checks. A dated record of previous checks is in [`VALIDATION.md`](../VALIDATION.md); its older sections describe the implementation at that time.

### Database integration

The eight suites in [`supabase/tests`](../supabase/tests) cover daily records, tasks, task options, automatic daily work, Anti-rot, food fields, push delivery, and Creatine. Each uses rollback-only fixtures to test validation, ownership, atomicity, and idempotent replay.

To run against a configured project, supply `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in the shell, then run:

```sh
npm run test:database
```

The target needs the repository’s migrations and any required push configuration. These checks are separate from CI and should run only against the intended project. A Supabase access token is a server-side credential; never place it in a `VITE_` variable or commit it.

A subset of task-related SQL can run without a hosted project using the PGlite helper:

```sh
npm install --prefix /tmp/180-sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.9
PGLITE_MODULE=file:///tmp/180-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-task-daily-local.mjs
```

This helper checks task, task-options, task-daily, food, and Creatine suites. It does not replace hosted storage, Auth, Edge Function, or push checks.

## Private backend configuration

The public demo is self-contained. Connecting a separate private deployment requires its own Supabase project, database migrations, account ownership configuration, and Auth settings.

Copy [`.env.example`](../.env.example) to `.env` and supply your project URL and browser-safe publishable key:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

The registration gate in the migrations is intentionally limited to a designated owner. Review and adapt that configuration before provisioning an independent instance; this repository does not provide an unrestricted signup service. `setup:account` is an informational helper for the existing deployment, not a provisioning script.

Configure the Auth Site URL and redirect allowlist for actual deployment and development origins. Recovery email delivery requires a working sender configuration. Migrations and generated types live in [`supabase/migrations`](../supabase/migrations) and [`src/lib/database.types.ts`](../src/lib/database.types.ts).

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
