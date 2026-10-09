import fs from "node:fs";
import { spawn } from "node:child_process";
if (
  !fs.existsSync(".cert/localhost.pem") ||
  !fs.existsSync(".cert/localhost-key.pem")
) {
  console.error("Run npm run setup:https first.");
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    ...(process.argv[2] === "preview" ? ["preview"] : []),
    "--host",
    "0.0.0.0",
  ],
  { env: { ...process.env, HTTPS: "1" }, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
