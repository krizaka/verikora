import { readBatchManifest } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { readBatchForm, readCheckForm } from "./form";

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
const post = (form: FormData) => new Request("http://localhost/api/v1/checks", { method: "POST", body: form });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return (
      (error as { status: number; body: { code: string } }).status +
      " " +
      (error as { body: { code: string } }).body.code
    );
  }
};

describe("readCheckForm (verikora#202)", () => {
  it("reads one check as a batch of one row that the batch's own reader understands", async () => {
    const form = new FormData();
    form.set("file", pdf("bail A.pdf"));
    form.set("check", "compliance");
    form.set("reference", "R-12");
    const read = await readCheckForm(post(form));
    expect(read.files.map((f) => f.name)).toEqual(["bail A.pdf"]);
    expect(read.name).toBe("R-12");
    expect(readBatchManifest(read.manifest).rows).toMatchObject([
      { line: 2, file: "bail A.pdf", reference: "R-12", errors: [] },
    ]);
  });

  it("quotes what would break the CSV: a comma, a quote, a semicolon, a line break in a name or a reference", async () => {
    const form = new FormData();
    form.set("file", pdf('bail, "Laurier"; 2.pdf'));
    form.set("check", "authenticity");
    form.set("reference", 'A "1"\r\nB');
    const read = await readCheckForm(post(form));
    const [row] = readBatchManifest(read.manifest).rows;
    expect(row).toMatchObject({ file: 'bail, "Laurier"; 2.pdf', reference: 'A "1"\r\nB', errors: [] });
  });

  it("names the batch after the file when there is no reference", async () => {
    const form = new FormData();
    form.set("file", pdf("a.pdf"));
    form.set("check", "compliance");
    expect((await readCheckForm(post(form))).name).toBe("a.pdf");
  });

  it("refuses a request without a file or without a check, with BAD_REQUEST", async () => {
    const noFile = new FormData();
    noFile.set("check", "compliance");
    expect(await codeOf(readCheckForm(post(noFile)))).toBe("400 BAD_REQUEST");
    const noCheck = new FormData();
    noCheck.set("file", pdf("a.pdf"));
    expect(await codeOf(readCheckForm(post(noCheck)))).toBe("400 BAD_REQUEST");
    expect(await codeOf(readCheckForm(new Request("http://localhost/x", { method: "POST", body: "not a form" })))).toBe(
      "400 BAD_REQUEST",
    );
  });

  it("an unknown check word is the row's own refusal (UNKNOWN_CHECK), not a crash", async () => {
    const form = new FormData();
    form.set("file", pdf("a.pdf"));
    form.set("check", "magic");
    expect(readBatchManifest((await readCheckForm(post(form))).manifest).rows[0]?.errors).toEqual(["UNKNOWN_CHECK"]);
  });
});

describe("readBatchForm", () => {
  it("reads the CSV as a file or as text, and the documents it names", async () => {
    const form = new FormData();
    form.set("manifest", new File(["file,check\na.pdf,compliance"], "Immeuble Laurier.csv", { type: "text/csv" }));
    form.append("files", pdf("a.pdf"));
    const read = await readBatchForm(post(form));
    expect(read).toMatchObject({ name: "Immeuble Laurier", manifest: "file,check\na.pdf,compliance" });
    expect(read.files).toHaveLength(1);
    const text = new FormData();
    text.set("manifest", "file,check");
    text.set("name", "Lot 1");
    expect(await readBatchForm(post(text))).toMatchObject({ name: "Lot 1", manifest: "file,check", files: [] });
  });

  it("refuses a request without a CSV", async () => {
    expect(await codeOf(readBatchForm(post(new FormData())))).toBe("400 BAD_REQUEST");
  });
});
