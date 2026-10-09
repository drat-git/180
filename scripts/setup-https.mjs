import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const root = path.resolve(".cert/authority");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);
const env = { ...process.env, CAROOT: root };
try {
  execFileSync(
    "mkcert",
    [
      "-cert-file",
      ".cert/localhost.pem",
      "-key-file",
      ".cert/localhost-key.pem",
      "localhost",
      "127.0.0.1",
      "::1",
      ...ips,
    ],
    { env, stdio: "inherit" },
  );
} catch {
  console.error("Install mkcert first: brew install mkcert");
  process.exit(1);
}
execFileSync("openssl", [
  "x509",
  "-in",
  path.join(root, "rootCA.pem"),
  "-outform",
  "der",
  "-out",
  ".cert/local-root-ca.cer",
]);
fs.chmodSync(".cert/localhost-key.pem", 0o600);
fs.chmodSync(path.join(root, "rootCA-key.pem"), 0o600);
console.log(`\nCertificates prepared for localhost and ${ips.join(", ")}.`);
console.log(
  'Mac trust (you perform this step): CAROOT="' + root + '" mkcert -install',
);
console.log(
  "iPhone: npm run cert:serve; download http://" +
    (ips[0] || "YOUR_MAC_IP") +
    ":3001/local-root-ca.cer, install the profile, then enable its certificate trust.",
);
console.log(
  "Then run npm run preview:https and open https://" +
    (ips[0] || "YOUR_MAC_IP") +
    ":4173 in Safari.",
);
console.log(
  "Only the public root certificate is served. Keep .cert/authority/rootCA-key.pem private.",
);
