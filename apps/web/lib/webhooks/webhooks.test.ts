import { describe, expect, it } from "vitest";

import type { BatchView } from "../batch/run";
import { isPrivateAddress } from "./address";
import { eventsOfFinishedBatch, WEBHOOK_EVENT } from "./events";
import { sealer } from "./seal";
import { safeSend } from "./send";

describe("an endpoint's secret at rest (verikora#241)", () => {
  const { seal, open } = sealer("a-server-secret-of-at-least-thirty-two-characters");

  it("is sealed and opened again; the sealed text shows nothing of it and differs each time", () => {
    const sealed = seal("whsec_abc123");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("whsec");
    expect(open(sealed)).toBe("whsec_abc123");
    expect(seal("whsec_abc123")).not.toBe(sealed);
  });

  it("opens with the same server secret only, and refuses a changed or foreign text", () => {
    const sealed = seal("whsec_abc123");
    expect(() => sealer("another-server-secret-of-at-least-thirty-two")?.open(sealed)).toThrow();
    const [v, iv, tag, data] = sealed.split(".");
    const flipped = `${data![0] === "A" ? "B" : "A"}${data!.slice(1)}`;
    expect(() => open([v, iv, tag, flipped].join("."))).toThrow();
    expect(() => open("plain text")).toThrow();
  });
});

describe("addresses a webhook must never reach", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("%s is refused", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "172.15.255.255",
    "192.169.0.1",
    "100.63.255.255",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("the call itself", () => {
  const request = {
    url: "https://hooks.example.test/verikora",
    body: "{}",
    headers: { "x-krizaka-event": "batch.finished" },
  };

  it("refuses a name that resolves to the server's own network — checked at connect time, not when the endpoint was saved", async () => {
    const send = safeSend({ timeoutMs: 1000, lookup: async () => [{ address: "10.0.0.5", family: 4 }] });
    await expect(send(request)).rejects.toThrow(/private address/);
    const mixed = safeSend({
      timeoutMs: 1000,
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    });
    await expect(mixed(request)).rejects.toThrow(/private address/);
  });

  it("refuses anything but https, and an unresolvable name is a failure to retry", async () => {
    await expect(safeSend({ timeoutMs: 1000 })({ ...request, url: "http://hooks.example.test/x" })).rejects.toThrow(
      /https/,
    );
    await expect(
      safeSend({ timeoutMs: 1000, lookup: async () => Promise.reject(new Error("ENOTFOUND")) })(request),
    ).rejects.toThrow(/ENOTFOUND/);
  });
});

const batch = (items: BatchView["items"], patch: Partial<BatchView> = {}): BatchView => ({
  id: "b1",
  name: "Immeuble Laurier",
  createdAt: "2026-10-23T10:00:00.000Z",
  finishedAt: "2026-10-23T10:05:00.000Z",
  items,
  counts: { pending: 0, reused: 0, running: 0, done: 1, failed: 0, refused: 0 },
  pausedBy: null,
  ...patch,
});
const row = (patch: Partial<BatchView["items"][number]> = {}): BatchView["items"][number] => ({
  id: "i1",
  line: 2,
  file: "bail.pdf",
  reference: "LAURIER-101",
  state: "done",
  error: null,
  documentId: "d1",
  analysisId: "a1",
  ...patch,
});

describe("what a finished batch tells the customer's system", () => {
  it("a batch gives batch.finished with ids, counts and the customer's references — never a document or a report", () => {
    const events = eventsOfFinishedBatch(
      batch([row(), row({ line: 3, file: "talon.pdf", reference: null, state: "failed", error: "FAILED" })], {
        counts: { pending: 0, reused: 0, running: 0, done: 1, failed: 1, refused: 0 },
      }),
    );
    expect(events.map((e) => [e.id, e.type])).toEqual([["batch:b1", WEBHOOK_EVENT.batchFinished]]);
    expect(events[0]!.payload).toMatchObject({
      id: "b1",
      name: "Immeuble Laurier",
      counts: { done: 1, failed: 1 },
      rows: [
        { line: 2, reference: "LAURIER-101", state: "done" },
        { line: 3, state: "failed", error: "FAILED" },
      ],
    });
    const text = JSON.stringify(events);
    expect(text).not.toContain("d1");
    expect(text).not.toContain("a1");
    expect(text).not.toMatch(/report|quote|findings/);
  });

  it("a batch of one row (a check, from the API) also gives check.finished, with a stable id so emitting twice queues once", () => {
    const events = eventsOfFinishedBatch(batch([row()]));
    expect(events.map((e) => [e.id, e.type])).toEqual([
      ["batch:b1", "batch.finished"],
      ["check:b1", "check.finished"],
    ]);
    expect(events[1]!.payload).toEqual({
      id: "b1",
      state: "done",
      reference: "LAURIER-101",
      error: null,
      finishedAt: "2026-10-23T10:05:00.000Z",
    });
    expect(eventsOfFinishedBatch(batch([row()])).map((e) => e.id)).toEqual(events.map((e) => e.id));
  });
});
