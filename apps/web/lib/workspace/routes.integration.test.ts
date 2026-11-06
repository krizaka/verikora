import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as adminConfigRoute, PUT as adminConfigPut } from "@/app/api/admin/organize/[kind]/config/route";
import { GET as configRoute } from "@/app/api/organize/[kind]/config/route";
import { POST as statusRoute } from "@/app/api/organize/[kind]/status/route";
import { DELETE as deleteTagRoute, PATCH as patchTagRoute } from "@/app/api/organize/[kind]/tags/[id]/route";
import { POST as applyRoute } from "@/app/api/organize/[kind]/tags/apply/route";
import { GET as tagsRoute, POST as createTagRoute } from "@/app/api/organize/[kind]/tags/route";
import { PUT as setRoute } from "@/app/api/organize/[kind]/tags/set/route";
import { DELETE as deleteViewRoute, PATCH as patchViewRoute } from "@/app/api/organize/[kind]/views/[id]/route";
import { GET as viewsRoute, POST as createViewRoute } from "@/app/api/organize/[kind]/views/route";

import { requestApplicantFile } from "../applicant-file";
import { migrate, pool, query } from "../db";
import { resetRateLimits } from "../limits";
import { createSession, SESSION_COOKIE } from "../session";
import { DECISION } from "./decl";
import { seedWorkspace } from "./service";

/** The workspace through its real routes (verikora#324): every route, the gate it shares, and what each refuses. Demo data only. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-25T12:00:00Z");

const as = (token: string | null, method: string, path: string, body?: object) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (kind: string, id = "") => ({ params: Promise.resolve({ kind, id }) });
const base = (kind: string) => `/api/organize/${kind}`;

describe.runIf(enabled)("the workspace over HTTP (verikora#324)", () => {
  const stamp = Date.now();
  let eric = "";
  let stranger = "";
  let admin = "";
  let token = "";
  let strangerToken = "";
  let adminToken = "";
  let seq = 0;

  const account = async (who: string, role = "USER") =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, role) VALUES ($1, 'x', $2) RETURNING id",
        [`${who}-${stamp}@verikora.test`, role],
      )
    )[0]!.id;
  const file = async (owner: string, email: string) =>
    (
      await requestApplicantFile(
        { id: owner, email },
        { candidateName: "Camille Fictif", candidateEmail: `c${++seq}-${stamp}@exemple.test`, types: ["pay-stub"] },
        NOW,
      )
    ).id;

  beforeAll(async () => {
    await migrate();
    await seedWorkspace({ now: () => NOW });
    [eric, stranger, admin] = [await account("eric"), await account("stranger"), await account("admin", "ADMIN")];
    [token, strangerToken, adminToken] = await Promise.all(
      [eric, stranger, admin].map(
        async (id) => (await createSession(id, { ip: "203.0.113.30", userAgent: "vitest" })).token,
      ),
    );
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[eric, stranger, admin]]);
    await pool().end();
  });

  it("answers 401 without a session, and 404 for a kind the layer does not organise", async () => {
    resetRateLimits();
    expect((await configRoute(as(null, "GET", `${base("applicant_file")}/config`), at("applicant_file"))).status).toBe(
      401,
    );
    expect(
      (
        await statusRoute(
          as(null, "POST", `${base("applicant_file")}/status`, { ids: ["x"], to: "retenu" }),
          at("applicant_file"),
        )
      ).status,
    ).toBe(401);
    expect((await configRoute(as(token, "GET", `${base("screening")}/config`), at("screening"))).status).toBe(404);
    expect((await tagsRoute(as(token, "GET", `${base("invoice")}/tags`), at("invoice"))).status).toBe(404);
  });

  it("reads the configuration the database holds: the decision set the screens draw their menus from", async () => {
    const res = await configRoute(as(token, "GET", `${base("applicant_file")}/config`), at("applicant_file"));
    expect(res.status).toBe(200);
    const { configuration } = await res.json();
    expect(configuration.config.status.states.map((s: { key: string }) => s.key)).toEqual([
      DECISION.toDecide,
      DECISION.selected,
      DECISION.notSelected,
    ]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("decides: { moved, skipped }, a stale expectation is 409 STALE, another account's file is 404, a body without ids is 400", async () => {
    const [a, b] = [await file(eric, "eric@verikora.test"), await file(eric, "eric@verikora.test")];
    const theirs = await file(stranger, "stranger@verikora.test");
    const post = (tokenOf: string, body: object) =>
      statusRoute(as(tokenOf, "POST", `${base("applicant_file")}/status`, body), at("applicant_file"));
    expect((await post(token, { ids: [], to: DECISION.selected })).status).toBe(400);
    expect((await post(token, { to: DECISION.selected })).status).toBe(400);
    expect((await post(token, { ids: [a], to: "inconnu" })).status).toBe(400);
    expect((await post(token, { ids: [theirs], to: DECISION.selected })).status).toBe(404);
    const done = await post(token, { ids: [a], to: DECISION.selected, expect: DECISION.toDecide });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({
      moved: [{ id: a, from: DECISION.toDecide, to: DECISION.selected, final: true }],
      skipped: [],
    });
    const stale = await post(token, { ids: [a], to: DECISION.notSelected, expect: DECISION.toDecide });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE");
    const mixed = await post(token, { ids: [a, b], to: DECISION.notSelected });
    expect((await mixed.json()).skipped).toEqual([{ id: a, code: "MOVE_NOT_ALLOWED" }]);
    expect((await post(strangerToken, { ids: [b], to: DECISION.selected })).status).toBe(404);
    const [row] = await query<{ closed_at: Date | null }>("SELECT closed_at FROM screenings WHERE id = $1", [theirs]);
    expect(row?.closed_at).toBeNull();
  });

  it("takes at most 200 ids a call: 201 is 400 TOO_MANY", async () => {
    const ids = Array.from({ length: 201 }, () => crypto.randomUUID());
    const res = await statusRoute(
      as(token, "POST", `${base("applicant_file")}/status`, { ids, to: DECISION.selected }),
      at("applicant_file"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("TOO_MANY");
    const tagged = await applyRoute(
      as(token, "POST", `${base("applicant_file")}/tags/apply`, { ids, add: [crypto.randomUUID()] }),
      at("applicant_file"),
    );
    expect(tagged.status).toBe(400);
    expect((await tagged.json()).code).toBe("TOO_MANY");
  });

  it("creates, lists, renames and deletes a tag with a marker; a marker outside the palette and a duplicate name are refused", async () => {
    const make = (name: string, marker: string, tokenOf = token) =>
      createTagRoute(as(tokenOf, "POST", `${base("applicant_file")}/tags`, { name, marker }), at("applicant_file"));
    const created = await make(`Garant ${stamp}`, "amber");
    expect(created.status).toBe(201);
    const { tag } = await created.json();
    expect(tag).toMatchObject({ name: `Garant ${stamp}`, marker: "amber", origin: "user" });
    expect((await make(`Autre ${stamp}`, "#ff0000")).status).toBe(400);
    const again = await make(`garant ${stamp}`, "blue");
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("NAME_TAKEN");
    expect(
      (
        await (await tagsRoute(as(token, "GET", `${base("applicant_file")}/tags`), at("applicant_file"))).json()
      ).tags.map((t: { id: string }) => t.id),
    ).toContain(tag.id);
    expect(
      (
        await (await tagsRoute(as(strangerToken, "GET", `${base("applicant_file")}/tags`), at("applicant_file"))).json()
      ).tags.map((t: { id: string }) => t.id),
    ).not.toContain(tag.id);
    const renamed = await patchTagRoute(
      as(token, "PATCH", `${base("applicant_file")}/tags/${tag.id}`, { name: `Garant 2 ${stamp}`, marker: "violet" }),
      at("applicant_file", tag.id),
    );
    expect((await renamed.json()).tag).toMatchObject({ name: `Garant 2 ${stamp}`, marker: "violet" });
    expect(
      (
        await patchTagRoute(
          as(strangerToken, "PATCH", `${base("applicant_file")}/tags/${tag.id}`, { name: "x" }),
          at("applicant_file", tag.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await deleteTagRoute(
          as(strangerToken, "DELETE", `${base("applicant_file")}/tags/${tag.id}`),
          at("applicant_file", tag.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await deleteTagRoute(
          as(token, "DELETE", `${base("applicant_file")}/tags/${tag.id}`),
          at("applicant_file", tag.id),
        )
      ).status,
    ).toBe(200);
  });

  it("tags in bulk and sets one entity's tags; a tag of another account is 404", async () => {
    const [a, b] = [await file(eric, "eric@verikora.test"), await file(eric, "eric@verikora.test")];
    const tag = async (tokenOf: string, name: string) =>
      (
        await (
          await createTagRoute(
            as(tokenOf, "POST", `${base("applicant_file")}/tags`, { name, marker: "green" }),
            at("applicant_file"),
          )
        ).json()
      ).tag as { id: string };
    const mine = await tag(token, `Mine ${stamp}`);
    const theirs = await tag(strangerToken, `Theirs ${stamp}`);
    const applied = await applyRoute(
      as(token, "POST", `${base("applicant_file")}/tags/apply`, { ids: [a, b], add: [mine.id] }),
      at("applicant_file"),
    );
    expect(await applied.json()).toEqual({ changed: 2 });
    expect(
      (
        await applyRoute(
          as(token, "POST", `${base("applicant_file")}/tags/apply`, { ids: [a], add: [theirs.id] }),
          at("applicant_file"),
        )
      ).status,
    ).toBe(404);
    const removed = await applyRoute(
      as(token, "POST", `${base("applicant_file")}/tags/apply`, { ids: [a], remove: [mine.id] }),
      at("applicant_file"),
    );
    expect(await removed.json()).toEqual({ changed: 1 });
    const set = await setRoute(
      as(token, "PUT", `${base("applicant_file")}/tags/set`, { id: b, tagIds: [] }),
      at("applicant_file"),
    );
    expect(await set.json()).toEqual({ changed: 1 });
    expect(
      (
        await setRoute(
          as(strangerToken, "PUT", `${base("applicant_file")}/tags/set`, { id: b, tagIds: [] }),
          at("applicant_file"),
        )
      ).status,
    ).toBe(404);
  });

  it("a document has tags and no status: the same routes tag it, and a decision on it is refused", async () => {
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 't', 'f.txt', 'text/plain', 1, $2, 'x') RETURNING id",
      [eric, `${stamp}-route-doc`],
    );
    const tag = (
      await (
        await createTagRoute(
          as(token, "POST", `${base("document")}/tags`, { name: `Bail ${stamp}`, marker: "gray" }),
          at("document"),
        )
      ).json()
    ).tag as { id: string };
    expect(
      await (
        await applyRoute(
          as(token, "POST", `${base("document")}/tags/apply`, { ids: [doc!.id], add: [tag.id] }),
          at("document"),
        )
      ).json(),
    ).toEqual({ changed: 1 });
    expect(
      (
        await statusRoute(
          as(token, "POST", `${base("document")}/status`, { ids: [doc!.id], to: DECISION.selected }),
          at("document"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await (await configRoute(as(token, "GET", `${base("document")}/config`), at("document"))).json()).configuration
        .config.status,
    ).toBeNull();
  });

  it("saves, lists, renames and deletes a view; only its author changes it; filters naming a state the set lacks are 400", async () => {
    const created = await createViewRoute(
      as(token, "POST", `${base("applicant_file")}/views`, {
        name: `Villeray ${stamp}`,
        filters: { status: [DECISION.toDecide], q: "villeray" },
      }),
      at("applicant_file"),
    );
    expect(created.status).toBe(201);
    const { view } = await created.json();
    expect(
      (
        await createViewRoute(
          as(token, "POST", `${base("applicant_file")}/views`, { name: "Mauvaise", filters: { status: ["nope"] } }),
          at("applicant_file"),
        )
      ).status,
    ).toBe(400);
    const listed = (
      await (await viewsRoute(as(token, "GET", `${base("applicant_file")}/views`), at("applicant_file"))).json()
    ).views;
    expect(listed.system.map((v: { key: string }) => v.key)).toEqual(["to_decide", "decided"]);
    expect(listed.mine.map((v: { id: string }) => v.id)).toContain(view.id);
    expect(
      (
        await patchViewRoute(
          as(strangerToken, "PATCH", `${base("applicant_file")}/views/${view.id}`, { name: "x" }),
          at("applicant_file", view.id),
        )
      ).status,
    ).toBe(404);
    const renamed = await patchViewRoute(
      as(token, "PATCH", `${base("applicant_file")}/views/${view.id}`, { name: `Villeray 2 ${stamp}`, shared: true }),
      at("applicant_file", view.id),
    );
    expect((await renamed.json()).view).toMatchObject({ name: `Villeray 2 ${stamp}`, shared: true });
    expect(
      (
        await (
          await viewsRoute(as(strangerToken, "GET", `${base("applicant_file")}/views`), at("applicant_file"))
        ).json()
      ).views.mine,
    ).toEqual([]);
    expect(
      (
        await deleteViewRoute(
          as(token, "DELETE", `${base("applicant_file")}/views/${view.id}`),
          at("applicant_file", view.id),
        )
      ).status,
    ).toBe(200);
  });

  it("lets only an administrator change the vocabulary: versioned (a stale editor is 409), checked by the layer, 404 for another kind", async () => {
    // The documents' configuration: nothing else reads it while this runs, and it is put back below.
    const path = "/api/admin/organize/document/config";
    const kind = at("document");
    expect((await adminConfigRoute(as(token, "GET", path), kind)).status).toBe(403);
    const { config, version } = (await (await adminConfigRoute(as(adminToken, "GET", path), kind)).json())
      .configuration;
    const wider = { ...config, tags: { ...config.tags, max: config.tags.max + 10 } };
    expect((await adminConfigPut(as(token, "PUT", path, { config: wider, expected: version }), kind)).status).toBe(403);
    const saved = await adminConfigPut(as(adminToken, "PUT", path, { config: wider, expected: version }), kind);
    expect(saved.status).toBe(200);
    expect((await saved.json()).configuration).toMatchObject({
      version: version + 1,
      config: { tags: { max: config.tags.max + 10 } },
    });
    const stale = await adminConfigPut(as(adminToken, "PUT", path, { config: wider, expected: version }), kind);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("CONFLICT");
    expect(
      (
        await adminConfigPut(
          as(adminToken, "PUT", path, { config: { ...wider, tags: { nope: true } }, expected: version + 1 }),
          kind,
        )
      ).status,
    ).toBe(400);
    expect((await adminConfigPut(as(adminToken, "PUT", path, { config, expected: version + 1 }), kind)).status).toBe(
      200,
    );
    expect(
      (await adminConfigRoute(as(adminToken, "GET", "/api/admin/organize/invoice/config"), at("invoice"))).status,
    ).toBe(404);
    expect(
      (await query("SELECT 1 FROM audit_log WHERE action = 'organize.config_changed' AND actor_id = $1", [admin]))
        .length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("keeps the kind's own route files thin: each calls the service, and none writes the layer's tables itself", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) =>
        statSync(`${dir}/${f}`).isDirectory() ? walk(`${dir}/${f}`) : f === "route.ts" ? [`${dir}/${f}`] : [],
      );
    const routes = walk(new URL("../../app/api/organize", import.meta.url).pathname);
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toContain("workspaceAct");
      expect(source, route).not.toMatch(/organize\./);
      expect(source, route).not.toMatch(/INSERT|UPDATE|DELETE FROM/);
    }
  });
});
