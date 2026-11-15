// Shared by the record-*.mjs scripts: the Sovkora client (key from the environment, never printed) and one compliance run.
const FINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const STUDIO_PATH = /^\/api\/v1\/studios\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&-]*)?$/;
const RUN_ID = /^[A-Za-z0-9_-]+$/;
const SOVKORA_HOST = /^(?:[a-z0-9-]+\.)*sovkora\.com$/;

/** The Studio API root, refused unless it is an https address on sovkora.com: the key is never sent anywhere else. */
export function sovkoraRoot(address) {
  const url = new URL(address);
  if (url.protocol !== "https:" || !SOVKORA_HOST.test(url.hostname)) {
    throw new Error("the recording only talks to Sovkora (https, sovkora.com)");
  }
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

/** `call(path, init)` against a Studio API at `root` with a bearer key: the parsed JSON, a refusal when the answer is not ok. */
const sovkoraCall =
  (root, key) =>
  async (path, init = {}) => {
    if (!STUDIO_PATH.test(path) || path.includes("..")) throw new Error(`not a Studio path: ${path.split("?")[0]}`);
    const url = new URL(`${sovkoraRoot(root)}${path}`);
    if (url.origin !== new URL(root).origin) throw new Error("the recording only goes to Sovkora's engine");
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) throw new Error(`Sovkora answered ${res.status} on ${init.method ?? "GET"} ${path.split("?")[0]}`);
    return res.json();
  };

/** The client of the Studio API: `base`, the `studio` key and `call(path, init)` returning the parsed JSON. */
export function sovkoraClient(env = process.env) {
  const base = sovkoraRoot(env.AI_API_URL ?? "https://dev.sovkora.com/edge");
  const key = env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY is not set");
  const studio = "compliance-check";
  return { base, studio, call: sovkoraCall(base, key) };
}

/** Starts a run of the Studio with `inputs`, polls it to its end and returns it; throws unless it SUCCEEDED (`label` names it). */
export async function runToEnd(client, inputs, label) {
  let run = await client.call(`/api/v1/studios/${client.studio}/runs`, { method: "POST", body: { inputs } });
  for (let i = 0; i < 90 && !FINAL.has(run.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const id = RUN_ID.exec(String(run.id))?.[0];
    if (!id) throw new Error(`${label}: Sovkora answered an unusable run id`);
    run = await client.call(`/api/v1/studios/runs/${encodeURIComponent(id)}`);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`${label}: the run ${run.id} ended ${run.status}`);
  return run;
}
