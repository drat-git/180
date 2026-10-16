// Isolated PostgreSQL WASM. Never uses hosted credentials or changes a live account.
import fs from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const database = new PGlite();
try {
  await database.exec(`create role anon; create role authenticated;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,created_at timestamptz not null default now(),raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',updated_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
 grant usage on schema auth,storage to anon,authenticated;
 grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
 `);
  const migrations = fs
    .readdirSync("supabase/migrations")
    .filter(
      (n) =>
        n.endsWith(".sql") &&
        !/daily_push_reminders|push_owner_index|public_accounts/.test(n),
    )
    .sort();
  for (const name of migrations)
    await database.exec(fs.readFileSync("supabase/migrations/" + name, "utf8"));
  await database.exec(
    `insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','dratgit@gmail.com');`,
  );
  for (const name of fs
    .readdirSync("supabase/migrations")
    .filter((n) => n.endsWith("_public_accounts.sql")))
    await database.exec(fs.readFileSync("supabase/migrations/" + name, "utf8"));
  await database.exec(`do $$ declare blocked boolean:=false; begin
    begin insert into auth.users(id,email) values(gen_random_uuid(),'closed@example.invalid'); exception when insufficient_privilege then blocked:=true; end;
    assert blocked,'Registration opened before release';
  end; $$;`);
  const catalog = (
    await database.query("select data from private.starter_catalog order by id")
  ).rows.map((r) => r.data);
  assert.deepEqual(
    catalog,
    JSON.parse(fs.readFileSync("src/lib/starterCatalog.json", "utf8")).sort(
      (a, b) => a.id.localeCompare(b.id),
    ),
  );
  for (const suite of process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        "daily_record",
        "tasks",
        "task_options",
        "task_deadlines",
        "task_daily",
        "food",
        "creatine",
        "customization",
        "anti_rotting",
        "public_accounts",
      ]) {
    const result = await database.exec(
      fs.readFileSync("supabase/tests/" + suite + ".sql", "utf8"),
    );
    console.log(suite, result.at(-1).rows);
  }
} catch (error) {
  console.error(error.message, error.where || "", error.detail || "");
  process.exitCode = 1;
} finally {
  await database.close();
}
