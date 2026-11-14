import { ThemeProvider } from "@krizaka/ui/native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as React from "react";

import { I18nProvider } from "@/i18n";
import { TabHeader } from "@/ui/TabHeader";

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate, replace: jest.fn() }),
  usePathname: () => "/fr/app",
}));
jest.mock("@/config", () => ({ queries: { me: () => ({ queryKey: ["verikora", "me"] }) } }));
// The server state is @krizaka/query's (tested there); here, the account it answers.
jest.mock(
  "@krizaka/query",
  () => ({ useQuery: () => ({ data: { name: "Éric Gagnon", email: "eric@example.test", avatarSeed: null } }) }),
  { virtual: true },
);

const wrap = (node: React.ReactElement) => (
  <ThemeProvider>
    <I18nProvider locale="fr">{node}</I18nProvider>
  </ThemeProvider>
);

describe("a tab's header", () => {
  it("shows the screen's title and the signed-in account, which opens the account and settings", async () => {
    await render(wrap(<TabHeader title="Aujourd'hui" />));
    expect(screen.getAllByText("Aujourd'hui").length).toBeGreaterThan(0);
    const account = await screen.findByRole("button", { name: "Votre compte : Éric Gagnon" });
    await fireEvent.press(account);
    expect(mockNavigate).toHaveBeenCalledWith("/fr/app/settings");
  });

  it("holds « Vérifier un document » as its « + », the one action of every tab (verikora#319)", async () => {
    await render(wrap(<TabHeader title="Bibliothèque" />));
    await fireEvent.press(await screen.findByRole("button", { name: "Vérifier un document" }));
    expect(mockNavigate).toHaveBeenCalledWith("/fr/app/check");
  });
});
