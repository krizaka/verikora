import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import fr from "@/messages/fr.json";

const captured = vi.hoisted(() => ({ upload: null as null | ((file: File, o: object) => Promise<void>) }));
const start = vi.hoisted(() => vi.fn());
const sent = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("./start-check", () => ({ startIfSure: start }));
vi.mock("./upload", async (original) => ({ ...(await original<object>()), send: sent }));
vi.mock("@krizaka/ui/file-upload", async (original) => ({
  ...(await original<object>()),
  useUploadQueue: (options: { upload: typeof captured.upload }) => {
    captured.upload = options.upload;
    return { items: [], add() {}, retry() {} };
  },
}));

import { LibraryDrop } from "./LibraryDrop";

const render = (offered: readonly string[] | null) =>
  renderToStaticMarkup(
    <I18nProvider locale="fr" messages={{ fr: { console: fr.console } }.fr as never}>
      <KrizakaQueryProvider>
        <LibraryDrop jurisdictions={["QC"]} offeredRulesets={offered} />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("a file dropped on the library follows the rule of the task page (krizaka-internal#3979)", () => {
  beforeEach(() => {
    start.mockReset();
    sent.mockReset().mockResolvedValue({ duplicate: false, document: { id: "d1" } });
  });

  it("hands the account's offered rulesets to the check it starts, so a refused ruleset is never launched", async () => {
    render(["qc-invoice"]);
    await captured.upload!(new File(["x"], "facture.pdf"), { signal: undefined, onProgress() {} });
    expect(start).toHaveBeenCalledWith("d1", "auto", ["QC"], expect.any(Date), undefined, ["qc-invoice"]);
  });

  it("starts nothing for a duplicate", async () => {
    sent.mockResolvedValue({ duplicate: true, document: { id: "d1" } });
    render(["qc-invoice"]);
    await captured.upload!(new File(["x"], "facture.pdf"), { signal: undefined, onProgress() {} });
    expect(start).not.toHaveBeenCalled();
  });
});
