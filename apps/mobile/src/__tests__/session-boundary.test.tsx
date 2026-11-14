import { createQueryClient, KrizakaQueryProvider, type QueryClient } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/native";
import { act, render, screen } from "@testing-library/react-native";
import * as React from "react";

import { I18nProvider } from "@/i18n";
import { SessionBoundary } from "@/session-boundary";
import { TabHeader } from "@/ui/TabHeader";

jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/fr/app",
}));
// The account the server answers, read through the real query client: what the header shows is what the cache holds.
jest.mock("@/config", () => {
  const fetchMe = jest.fn();
  return { fetchMe, queries: { me: () => ({ queryKey: ["verikora", "me"], queryFn: fetchMe }) } };
});
const { fetchMe } = jest.requireMock("@/config") as { fetchMe: jest.Mock };

/** A session store as the boundary sees it: who listens, and a change to announce (a sign-out, a sign-in, a 401). */
function fakeSession() {
  const listeners = new Set<() => void>();
  return {
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    change() {
      listeners.forEach((listener) => listener());
    },
  };
}

const wrap = (client: QueryClient, session: ReturnType<typeof fakeSession>, node: React.ReactElement) => (
  <ThemeProvider>
    <I18nProvider locale="fr">
      <KrizakaQueryProvider client={client}>
        <SessionBoundary session={session}>{node}</SessionBoundary>
      </KrizakaQueryProvider>
    </I18nProvider>
  </ThemeProvider>
);

describe("one account's data never shows to the next", () => {
  it("drops the previous account from the header when the session changes, even when the next account's refresh fails", async () => {
    // The root layout's client: errors stay in the query (`throwOnError={false}`), nothing is retried here, nothing is fresh.
    // `gcTime: Infinity`: no garbage-collection timer (5 min by default), which would keep the Jest worker alive after the run
    // and the pre-push hook waiting.
    const client = createQueryClient({ staleTime: 0, maxRetries: 0, throwOnError: false, gcTime: Infinity });
    const session = fakeSession();
    // Alice's identity is cached; every refresh fails (the phone is offline): Query keeps her beside the error.
    client.setQueryData(["verikora", "me"], { name: "Alice Tremblay", email: "alice@example.test", avatarSeed: null });
    fetchMe.mockRejectedValue(new Error("offline"));
    await render(wrap(client, session, <TabHeader title="Aujourd'hui" />));
    expect(await screen.findByRole("button", { name: "Votre compte : Alice Tremblay" })).toBeTruthy();

    // Alice signs out and Benoît signs in; his `/api/me` fails too. Nothing of Alice may remain on his screen.
    await act(async () => {
      session.change();
    });
    expect(await screen.findByRole("button", { name: "Votre compte" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
    expect(fetchMe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
