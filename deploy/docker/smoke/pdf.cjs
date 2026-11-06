// The PDF reader inside the built image (verikora#21): pdf.js (unpdf) runs in a worker thread with its own heap limit, as
// lib/extraction/isolated.ts starts it. Run by scripts/ci-container-smoke.sh with the fixtures of deploy/docker/smoke at /smoke.
const path = require("node:path"),
  fs = require("node:fs");
const { Worker } = require("node:worker_threads");
const root = "/app/node_modules/.pnpm";
const unpdf = path.join(
  root,
  fs.readdirSync(root).find((d) => d.startsWith("unpdf@")),
  "node_modules",
  "unpdf",
);
const source = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { extractText, getDocumentProxy } = require(workerData.unpdf);
  const pdf = await getDocumentProxy(new Uint8Array(workerData.bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  parentPort.postMessage({ pages: totalPages, text });
})().catch((e) => parentPort.postMessage({ error: String(e) }));`;
const bytes = fs.readFileSync("/smoke/page.pdf");
const worker = new Worker(source, {
  eval: true,
  workerData: { unpdf, bytes },
  resourceLimits: { maxOldGenerationSizeMb: 384 },
});
const timer = setTimeout(() => {
  console.error("FAIL timeout");
  process.exit(1);
}, 10000);
worker.once("message", (m) => {
  clearTimeout(timer);
  if (m.error || !/BAIL DE LOGEMENT/.test(m.text) || m.pages !== 1) {
    console.error("FAIL", m);
    process.exit(1);
  }
  console.log("pdf ok", m.pages, "page", Math.round(process.memoryUsage().rss / 1e6), "MB rss");
  worker.terminate();
});
worker.once("error", (e) => {
  console.error("FAIL", e);
  process.exit(1);
});
