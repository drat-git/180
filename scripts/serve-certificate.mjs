import http from "node:http";
import fs from "node:fs";
import os from "node:os";
if (!fs.existsSync(".cert/local-root-ca.cer")) {
  console.error("Run npm run setup:https first.");
  process.exit(1);
}
http
  .createServer((request, response) => {
    if (request.url !== "/local-root-ca.cer") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="180-local-root-ca.cer"',
      "Cache-Control": "no-store",
    });
    response.end(fs.readFileSync(".cert/local-root-ca.cer"));
  })
  .listen(3001, "0.0.0.0", () => {
    const ip = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    console.log(
      `Certificate download: http://${ip || "localhost"}:3001/local-root-ca.cer\nStop this server after installing the certificate.`,
    );
  });
