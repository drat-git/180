// Isolated PostgreSQL WASM check; never connects to Supabase or reads credentials.
// Install the optional runtime outside the repo:
// npm install --prefix /tmp/180-sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.9
// PGLITE_MODULE=file:///tmp/180-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-task-daily-local.mjs
import fs from "node:fs";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  const migrations = [
    "20261009062208_daily_record",
    "20261009182317_cannabis_use_descriptions",
    "20261010033717_do_stuff",
    "20261010033850_task_history_context",
    "20261010033914_task_parent_variable",
    "20261010034151_task_history_indexes",
    "20261011053154_daily_task_eligibility",
    "20261011162033_retire_daily_task_eligibility",
    "20261012034639_day_four_food",
    "20261013055335_creatine_check",
    "20261014035821_task_options",
    "20261014042751_task_daily_completion",
  ];
  for (const migration of migrations) {
    let sql = fs.readFileSync(`supabase/migrations/${migration}.sql`, "utf8");
    if (migration.endsWith("daily_record"))
      sql = sql.split("insert into storage.buckets")[0];
    await db.exec(sql);
  }
  await db.exec(`
    insert into auth.users values('11111111-1111-4111-8111-111111111111');
    insert into public.app_owner(user_id) values('11111111-1111-4111-8111-111111111111');
  `);
  for (const suite of [
    "tasks",
    "task_options",
    "task_daily",
    "food",
    "creatine",
  ]) {
    const result = await db.exec(
      fs.readFileSync(`supabase/tests/${suite}.sql`, "utf8"),
    );
    console.log(suite, result.at(-1).rows);
  }
} catch (error) {
  console.error(error.message, error.where || "", error.detail || "");
  process.exitCode = 1;
} finally {
  await db.close();
}
