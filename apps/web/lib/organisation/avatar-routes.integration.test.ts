import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DELETE as removeRoute, GET as readRoute, POST as uploadRoute } from "@/app/api/collections/[id]/avatar/route";
import { PATCH as patchRoute } from "@/app/api/collections/[id]/route";
import { GET as configRoute } from "@/app/api/me/app/route";

import { migrate, pool, query } from "../db";
import { resetRateLimits } from "../limits";
import { createSession, SESSION_COOKIE } from "../session";
import { appSettings, resetAppSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import * as org from "./store";

/** The avatar through the real routes: a seed from the set, the administrator's switches and limits, and what happens with no storage configured. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const ADMIN = { id: null, label: "test" };

const as = (
  token: string,
  method: string,
  path: string,
  body?: BodyInit | object,
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.runIf(enabled)("collection avatars over HTTP", () => {
  let owner = "";
  let token = "";
  let collection = "";
  beforeAll(async () => {
    await migrate();
    owner = (
      await query<{ id: string }>("INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') RETURNING id", [
        `av-${Date.now()}@verikora.test`,
      ])
    )[0]!.id;
    token = (await createSession(owner, { ip: "203.0.113.20", userAgent: "vitest" })).token;
    collection = (await org.createCollection(query, owner, (await org.ensureLibrary(query, owner, "x")).id, "Baux")).id;
  });
  afterAll(async () => {
    for (const key of ["features.collectionAvatars", "features.avatarSet", "limits.avatarMaxKb"] as const)
      await appSettings().reset(ADMIN, GLOBAL, key, new Date());
    resetAppSettings();
    await query("DELETE FROM accounts WHERE id = $1", [owner]);
    await pool().end();
  });
  const avatar = async () =>
    (await query<{ avatar: unknown }>("SELECT avatar FROM collections WHERE id = $1", [collection]))[0]!.avatar;

  it("describes a collection through the same PATCH: trimmed, cleared by an empty text, refused when too long", async () => {
    const res = await patchRoute(
      as(token, "PATCH", `/api/collections/${collection}`, { description: "  Les baux de la rue Laurier  " }),
      params(collection),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).collection.description).toBe("Les baux de la rue Laurier");
    expect(
      (await query<{ description: string }>("SELECT description FROM collections WHERE id = $1", [collection]))[0]!
        .description,
    ).toBe("Les baux de la rue Laurier");
    expect(
      (
        await patchRoute(
          as(token, "PATCH", `/api/collections/${collection}`, { description: "x".repeat(501) }),
          params(collection),
        )
      ).status,
    ).toBe(400);
    expect(
      (await patchRoute(as(token, "PATCH", `/api/collections/${collection}`, { description: "" }), params(collection)))
        .status,
    ).toBe(200);
    expect(
      (
        await query<{ description: string | null }>("SELECT description FROM collections WHERE id = $1", [collection])
      )[0]!.description,
    ).toBeNull();
  });

  it("picks an avatar from the set and clears it, through the collection's PATCH", async () => {
    resetRateLimits();
    const set = await patchRoute(
      as(token, "PATCH", `/api/collections/${collection}`, { avatar: { kind: "set", seed: "v3" } }),
      params(collection),
    );
    expect(set.status).toBe(200);
    expect((await set.json()).collection.avatar).toEqual({ kind: "set", seed: "v3" });
    expect(await avatar()).toEqual({ kind: "set", seed: "v3" });
    expect(
      (
        await patchRoute(
          as(token, "PATCH", `/api/collections/${collection}`, { avatar: { kind: "set", seed: "nope" } }),
          params(collection),
        )
      ).status,
    ).toBe(400);
    expect(
      (await patchRoute(as(token, "PATCH", `/api/collections/${collection}`, { avatar: null }), params(collection)))
        .status,
    ).toBe(200);
    expect(await avatar()).toBeNull();
  });

  it("offers only the set the administrator allows, and the browser is told which", async () => {
    resetRateLimits();
    await appSettings().set(ADMIN, GLOBAL, "features.avatarSet", ["v1", "v2"], new Date());
    resetAppSettings();
    expect((await (await configRoute(as(token, "GET", "/api/me/app"))).json()).config.avatars).toMatchObject({
      enabled: true,
      seeds: ["v1", "v2"],
      maxBytes: 512 * 1024,
      canUpload: false,
    });
    expect(
      (
        await patchRoute(
          as(token, "PATCH", `/api/collections/${collection}`, { avatar: { kind: "set", seed: "v6" } }),
          params(collection),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await patchRoute(
          as(token, "PATCH", `/api/collections/${collection}`, { avatar: { kind: "set", seed: "v2" } }),
          params(collection),
        )
      ).status,
    ).toBe(200);
  });

  it("with no storage configured an image cannot be uploaded (503) and there is no image to read (404), but the set still works", async () => {
    resetRateLimits();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "a.jpg", { type: "image/jpeg" }));
    const res = await uploadRoute(as(token, "POST", `/api/collections/${collection}/avatar`, form), params(collection));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "AVATAR_STORAGE_OFF" });
    expect(
      (await readRoute(as(token, "GET", `/api/collections/${collection}/avatar`), params(collection))).status,
    ).toBe(404);
    expect(
      (await removeRoute(as(token, "DELETE", `/api/collections/${collection}/avatar`), params(collection))).status,
    ).toBe(200);
  });

  it("is switched off for everyone by the administrator: neither a seed nor an upload", async () => {
    resetRateLimits();
    await appSettings().set(ADMIN, GLOBAL, "features.collectionAvatars", false, new Date());
    resetAppSettings();
    expect(
      (
        await patchRoute(
          as(token, "PATCH", `/api/collections/${collection}`, { avatar: { kind: "set", seed: "v1" } }),
          params(collection),
        )
      ).status,
    ).toBe(403);
    expect((await (await configRoute(as(token, "GET", "/api/me/app"))).json()).config.avatars.enabled).toBe(false);
  });
});
