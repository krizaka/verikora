import { storedAvatarKey } from "@krizaka/organize";
import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { photoOfPage } from "../images/fixtures";
import { memoryStore } from "../storage/memory";
import type { DocumentStore } from "../storage/port";
import { readAvatar, removeAvatar, setSetAvatar, uploadAvatar } from "./avatar";
import { legacyAvatarKey } from "./organize";

const avatarKey = (owner: string, id: string, version: number) => storedAvatarKey("collection", owner, id, version);
import * as org from "./store";

/** A collection's avatar (krizaka/verikora#206) against a real PostgreSQL: one from the set, or an uploaded image kept behind the storage port. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

const RULES = { allowedSeeds: ["person", "plain-1", "plain-2"], maxBytes: 200 * 1024, size: 256 };
const memory = () => memoryStore({ kind: "bunny", devOnly: true, owner: "krizaka", residency: "elsewhere" });

describe.runIf(enabled)("a collection's avatar", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`a-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
  const collection = async (owner: string) =>
    (
      await org.createCollection(
        query,
        owner,
        (await org.ensureLibrary(query, owner, "x")).id,
        `C${Math.random().toString(36).slice(2, 6)}`,
      )
    ).id;
  const avatarOf = async (id: string) =>
    (await query<{ avatar: unknown }>("SELECT avatar FROM collections WHERE id = $1", [id]))[0]!.avatar;
  const photo = async (over = {}) => ({ name: "logo.jpg", type: "image/jpeg", bytes: await photoOfPage(over) });

  it("takes one from the set, only a seed the administrator allows, and can go back to none", async () => {
    const owner = await account();
    const id = await collection(owner);
    await setSetAvatar(query, owner, id, "plain-2", RULES.allowedSeeds);
    expect(await avatarOf(id)).toEqual({ kind: "set", seed: "plain-2" });
    await expect(setSetAvatar(query, owner, id, "plain-6", RULES.allowedSeeds)).rejects.toMatchObject({
      body: { code: "AVATAR_NOT_ALLOWED" },
    });
    await expect(setSetAvatar(query, owner, id, "../../etc", RULES.allowedSeeds)).rejects.toMatchObject({
      body: { code: "AVATAR_NOT_ALLOWED" },
    });
    await setSetAvatar(query, owner, id, null, RULES.allowedSeeds);
    expect(await avatarOf(id)).toBeNull();
  });

  it("an uploaded image is checked, made square without metadata, kept under its own prefix, and served back", async () => {
    const owner = await account();
    const id = await collection(owner);
    const store = memory();
    const out = await uploadAvatar(query, owner, id, await photo({ editor: "Adobe Photoshop" }), { ...RULES, store });
    expect(out).toEqual({ kind: "image", version: 1 });
    expect(await avatarOf(id)).toEqual({ kind: "image", version: 1 });
    const stored = await store.get(avatarKey(owner, id, 1));
    expect(stored?.contentType).toBe("image/jpeg");
    expect(Buffer.from(stored!.bytes).includes(Buffer.from("Photoshop"))).toBe(false);
    const served = await readAvatar(query, owner, id, store);
    expect(served?.contentType).toBe("image/jpeg");
    expect([...served!.bytes]).toEqual([...stored!.bytes]);
    // a new image is a new version (the old object goes, the address changes so no cache keeps the old picture)
    expect(await uploadAvatar(query, owner, id, await photo({ degrees: 5 }), { ...RULES, store })).toEqual({
      kind: "image",
      version: 2,
    });
    expect(await store.get(avatarKey(owner, id, 1))).toBeNull();
    expect(await store.get(avatarKey(owner, id, 2))).not.toBeNull();
  });

  it("an image kept before the package (the older key) is still read; a new one is written under the package's key only; removing deletes both", async () => {
    const owner = await account();
    const id = await collection(owner);
    const store = memory();
    await store.put(legacyAvatarKey("collection", owner, id, 3), new Uint8Array([1, 2]), { contentType: "image/jpeg" });
    await query("UPDATE collections SET avatar = $2 WHERE id = $1", [
      id,
      JSON.stringify({ kind: "image", version: 3 }),
    ]);
    expect([...(await readAvatar(query, owner, id, store))!.bytes]).toEqual([1, 2]);
    expect(await uploadAvatar(query, owner, id, await photo(), { ...RULES, store })).toEqual({
      kind: "image",
      version: 4,
    });
    expect(await store.get(legacyAvatarKey("collection", owner, id, 4))).toBeNull();
    expect(await store.get(avatarKey(owner, id, 4))).not.toBeNull();
    await store.put(legacyAvatarKey("collection", owner, id, 4), new Uint8Array([9]), { contentType: "image/jpeg" });
    await removeAvatar(query, owner, id, store);
    expect(await store.get(legacyAvatarKey("collection", owner, id, 4))).toBeNull();
    expect(await store.get(avatarKey(owner, id, 4))).toBeNull();
  });

  it("refuses what is not a small image: another type, too heavy, a lie about the type, a corrupt image — and keeps what was there", async () => {
    const owner = await account();
    const id = await collection(owner);
    const store = memory();
    const text = { name: "a.png", type: "image/png", bytes: new TextEncoder().encode("not an image at all") };
    await expect(uploadAvatar(query, owner, id, text, { ...RULES, store })).rejects.toMatchObject({ status: 415 });
    await expect(
      uploadAvatar(query, owner, id, await photo(), { ...RULES, maxBytes: 100, store }),
    ).rejects.toMatchObject({ body: { code: "AVATAR_TOO_LARGE" } });
    await expect(
      uploadAvatar(query, owner, id, { ...(await photo()), name: "a.png", type: "image/png" }, { ...RULES, store }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      uploadAvatar(
        query,
        owner,
        id,
        { name: "x.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9, 9, 9, 9, 9]) },
        { ...RULES, store },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await avatarOf(id)).toBeNull();
  });

  it("is the owner's alone: another account gets « not found », and a failing store leaves the collection as it was", async () => {
    const owner = await account();
    const id = await collection(owner);
    const stranger = await account();
    await expect(uploadAvatar(query, stranger, id, await photo(), { ...RULES, store: memory() })).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(setSetAvatar(query, stranger, id, "person", RULES.allowedSeeds)).rejects.toMatchObject({
      status: 404,
    });
    const broken: DocumentStore = { ...memory(), put: async () => Promise.reject(new Error("down")) };
    await expect(uploadAvatar(query, owner, id, await photo(), { ...RULES, store: broken })).rejects.toMatchObject({
      body: { code: "AVATAR_STORAGE_UNAVAILABLE" },
    });
    expect(await avatarOf(id)).toBeNull();
  });

  it("removing the image deletes the stored object and clears the avatar; a set avatar needs no store", async () => {
    const owner = await account();
    const id = await collection(owner);
    const store = memory();
    await uploadAvatar(query, owner, id, await photo(), { ...RULES, store });
    await removeAvatar(query, owner, id, store);
    expect(await avatarOf(id)).toBeNull();
    expect(await store.get(avatarKey(owner, id, 1))).toBeNull();
    await setSetAvatar(query, owner, id, "person", RULES.allowedSeeds);
    await removeAvatar(query, owner, id, store);
    expect(await avatarOf(id)).toBeNull();
    expect(await readAvatar(query, owner, id, store)).toBeNull();
  });

  it("is in the overview, so the library, the breadcrumb and the pickers can draw it", async () => {
    const owner = await account();
    const id = await collection(owner);
    await setSetAvatar(query, owner, id, "plain-1", RULES.allowedSeeds);
    const mine = (await org.overview(query, owner)).flatMap((l) => l.collections).find((c) => c.id === id);
    expect(mine?.avatar).toEqual({ kind: "set", seed: "plain-1" });
  });
});
