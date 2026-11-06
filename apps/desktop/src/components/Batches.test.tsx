import { useQuery } from "@krizaka/query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { BatchesView } from "./Batches";

vi.mock("@krizaka/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krizaka/query")>()),
  useQuery: vi.fn(),
}));
vi.mock("../lib/config", () => ({ queries: { batches: () => ({ queryKey: ["verikora", "batches"] }) } }));

const OFFLINE = "Verikora ne répond pas. Vérifiez votre connexion.";
const EMPTY = /Aucun lot pour l'instant/;

/** The server state as the screen reads it (the query itself is @krizaka/query's, tested there). */
const answers = (state: { data?: unknown[]; isError: boolean; isPending: boolean }) =>
  vi.mocked(useQuery).mockReturnValue(state as never);
const wrap = (node: React.ReactElement) => <I18nProvider locale="fr">{node}</I18nProvider>;

describe("the batches", () => {
  it("shows the empty state when the account has no batch", () => {
    answers({ data: [], isError: false, isPending: false });
    render(wrap(<BatchesView go={() => {}} />));
    expect(screen.queryByText(EMPTY)).not.toBeNull();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it("says the Mac is offline when a refresh fails, even after an earlier empty answer", () => {
    // Query keeps the last answer (`[]`) beside the error: a failed refresh must not read as « no batch ».
    answers({ data: [], isError: true, isPending: false });
    render(wrap(<BatchesView go={() => {}} />));
    expect(screen.queryByText(OFFLINE)).not.toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});
