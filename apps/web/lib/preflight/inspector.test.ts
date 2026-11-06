import { describe, expect, it } from "vitest";

import * as fx from "./fixtures";
import { archiveProblem, createInspector, sniff } from "./inspector";
import { VERIKORA_RULES } from "./rules";

const inspect = createInspector(VERIKORA_RULES).inspect;
const pdf = (name = "bail.pdf") => ({ name, type: "application/pdf" });
const why = async (bytes: Uint8Array, declared = pdf()) => {
  const r = await inspect(bytes, declared);
  return r.kind === "rejected" ? r.reason : r.kind;
};

describe("pre-flight: what the bytes are", () => {
  it("accepts a healthy PDF, with its hash, pages and cheap facts", async () => {
    const r = await inspect(await fx.cleanPdf(), pdf());
    expect(r).toMatchObject({
      kind: "accepted",
      fileKind: "pdf",
      pages: 1,
      facts: { producer: "Fixture", incrementalSaves: 0 },
    });
    expect(r.kind === "accepted" && r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("accepts UTF-8 text", async () => {
    expect(
      await why(new TextEncoder().encode("Loyer mensuel : 1 120 $"), { name: "bail.txt", type: "text/plain" }),
    ).toBe("accepted");
  });
  it("refuses an empty file and a file over the size limit", async () => {
    expect(await why(new Uint8Array())).toBe("EMPTY");
    expect(await why(new Uint8Array(VERIKORA_RULES.maxBytes + 1))).toBe("TOO_LARGE");
  });
  it("refuses an executable renamed to .pdf, by its magic bytes", async () => {
    expect(sniff(fx.windowsExecutable())).toBe("executable");
    expect(await why(fx.windowsExecutable(), pdf("facture.pdf"))).toBe("EXECUTABLE");
  });
  it("refuses a file whose name says one thing and bytes another", async () => {
    expect(await why(await fx.cleanPdf(), { name: "photo.png", type: "image/png" })).toBe("TYPE_MISMATCH");
    expect(await why(fx.pngBytes(), pdf("bail.pdf"))).toBe("TYPE_MISMATCH");
  });
  it("accepts photos by their bytes: PNG, JPEG and HEIC", async () => {
    expect(await why(await fx.imageOf("png"), { name: "scan.png", type: "image/png" })).toBe("accepted");
    expect(await why(await fx.imageOf("jpeg"), { name: "IMG_2041.JPG", type: "image/jpeg" })).toBe("accepted");
    expect(await why(fx.heicBytes(), { name: "IMG_2041.HEIC", type: "image/heic" })).toBe("accepted");
    expect(sniff(fx.heicBytes())).toBe("heic");
    // an iPhone sometimes names it .heif or declares nothing: the bytes decide
    expect(await why(fx.heicBytes(), { name: "photo.heif", type: "" })).toBe("accepted");
  });
  it("refuses a photo whose declared type is not what the bytes are, and one with too many pixels", async () => {
    expect(await why(await fx.imageOf("jpeg"), { name: "scan.png", type: "image/png" })).toBe("TYPE_MISMATCH");
    expect(await why(fx.pngWithSize(9000, 9000), { name: "huge.png", type: "image/png" })).toBe("IMAGE_TOO_LARGE");
  });
  it("recognises a Word file and accepts it (verikora#229); a workspace that allows no Word files still refuses it", async () => {
    expect(sniff(fx.docx())).toBe("docx");
    expect(await why(fx.docx(), { name: "bail.docx", type: "" })).toBe("accepted");
    expect(
      await createInspector({ ...VERIKORA_RULES, allowedKinds: ["pdf", "text"] }).inspect(fx.docx(), {
        name: "bail.docx",
        type: "",
      }),
    ).toMatchObject({ kind: "rejected", reason: "UNSUPPORTED_TYPE" });
  });
});

describe("pre-flight: integrity", () => {
  it("refuses a truncated PDF", async () => {
    expect(await why(await fx.truncatedPdf())).toBe("TRUNCATED");
  });
  it("refuses a corrupted PDF", async () => {
    expect(await why(await fx.corruptedPdf())).toBe("CORRUPT");
  });
  it("refuses an encrypted PDF, with its own reason", async () => {
    expect(await why(await fx.encryptedPdf())).toBe("ENCRYPTED");
  });
  it("reads incremental saves as a fact, not a refusal", async () => {
    const r = await inspect(await fx.incrementallySavedPdf(), pdf());
    expect(r.kind === "accepted" ? r.facts?.incrementalSaves : null).toBe(1);
  });
});

describe("pre-flight: safety — nothing is executed, active content is refused", () => {
  it("refuses a PDF that runs JavaScript on open", async () => {
    const r = await inspect(await fx.javascriptPdf(), pdf());
    expect(r).toMatchObject({ kind: "rejected", reason: "ACTIVE_CONTENT" });
  });
  it("refuses a PDF that launches a program from an annotation", async () => {
    expect(await why(await fx.launchPdf())).toBe("ACTIVE_CONTENT");
  });
  it("sees through #xx-obfuscated names", async () => {
    const js = Buffer.from(await fx.javascriptPdf())
      .toString("latin1")
      .replace("/JavaScript", "/J#61vaScript")
      .replace("/OpenAction", "/Op#65nAction");
    expect(await why(Buffer.from(js, "latin1"))).toBe("ACTIVE_CONTENT");
  });
  it("refuses a zip bomb from its directory alone, and macro-enabled Word files", async () => {
    expect(archiveProblem(fx.zipBomb(), VERIKORA_RULES)).toBe("ARCHIVE_BOMB");
    expect(await why(fx.zipBomb(), { name: "bail.docx", type: "" })).toBe("ARCHIVE_BOMB");
    expect(archiveProblem(fx.docx([{ name: "word/vbaProject.bin", data: Buffer.from("x") }]), VERIKORA_RULES)).toBe(
      "ACTIVE_CONTENT",
    );
    expect(archiveProblem(fx.docx(), VERIKORA_RULES)).toBeNull();
  });
});

describe("pre-flight: the rules are data", () => {
  it("a stricter rule set changes the outcome without a code change", async () => {
    const strict = createInspector({ ...VERIKORA_RULES, maxBytes: 100 });
    expect((await strict.inspect(await fx.cleanPdf(), pdf())).kind).toBe("rejected");
    const wide = createInspector({ ...VERIKORA_RULES, allowedKinds: ["pdf", "text", "png"] });
    expect((await wide.inspect(fx.pngBytes(), { name: "s.png", type: "image/png" })).kind).toBe("accepted");
  });
});
