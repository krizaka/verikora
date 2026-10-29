// OpenDAL inside the built image (yomizaka#530, ADR-005): the cloud connections (Google Drive, OneDrive, Dropbox) and the admin kinds
// (Azure, GCS, B2, WebDAV) are opened by its native binary, which must be the musl build for this image. A write, a read and a delete on
// its in-memory service prove the binary loads and runs; Next's tracing keeps `opendal` external (serverExternalPackages) and carries it.
const path = require("path"), fs = require("fs");
const root = "/app/node_modules/.pnpm";
const find = (prefix) => path.join(root, fs.readdirSync(root).find((d) => d.startsWith(prefix)), "node_modules");
// Loaded as the app loads it: the package's ES entry (its `exports` has no CommonJS file in the traced copy).
(async () => {
  const { Operator } = await import(path.join(find("opendal@"), "opendal", "index.mjs"));
  const op = new Operator("memory", {});
  await op.write("smoke/hello.txt", Buffer.from("opendal in the image"));
  const back = (await op.read("smoke/hello.txt")).toString();
  if (back !== "opendal in the image") throw new Error("read back " + back);
  await op.delete("smoke/hello.txt");
  if (await op.exists("smoke/hello.txt")) throw new Error("the file is still there");
  console.log("opendal ok", Math.round(process.memoryUsage().rss / 1e6), "MB rss");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
