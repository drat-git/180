import fs from "node:fs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(
    "Set SUPABASE_ACCESS_TOKEN to run the rollback-only database integration suite. You can also execute supabase/tests/daily_record.sql and supabase/tests/tasks.sql through the Supabase SQL editor or connector.",
  );
  process.exit(1);
}
const ref = process.env.SUPABASE_PROJECT_REF || "xlkmnczbuzmdfchoqqbr";
for (const suite of ["daily_record", "tasks"]) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: fs.readFileSync(`supabase/tests/${suite}.sql`, "utf8"),
      }),
    },
  );
  if (!response.ok) {
    console.error("Database tests failed:", await response.text());
    process.exit(1);
  }
  console.log(suite, await response.json());
}
