import { DiscoveryProvider } from "@krizaka/discovery/react";
import { KrizakaQueryProvider } from "@krizaka/query";
import { brands } from "@krizaka/tokens/native";
import { ThemeProvider } from "@krizaka/ui/native";
import { Stack } from "expo-router";
import * as React from "react";
import { AppState } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthProvider } from "@/auth";
import { discovery, session } from "@/config";
import { I18nProvider } from "@/i18n";
import { SessionBoundary } from "@/session-boundary";
import { StageNotice } from "@/ui/StageNotice";
import { useLocale } from "@/use-locale";

/** A refresh of the signed manifest each time the app comes back to the foreground. */
const onForeground = (callback: () => void) => {
  const subscription = AppState.addEventListener("change", (state) => state === "active" && callback());
  return () => subscription.remove();
};

/** The app's root: Yomizaka's indigo on the Krizaka native theme (dark and light), the backend found by discovery, the session. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Themed>
        <DiscoveryProvider discovery={discovery} subscribeForeground={onForeground}>
          <KrizakaQueryProvider throwOnError={false}>
            <SessionBoundary session={session}>
              <Localised />
            </SessionBoundary>
          </KrizakaQueryProvider>
        </DiscoveryProvider>
      </Themed>
    </SafeAreaProvider>
  );
}

/** The theme keeps its bars and buttons clear of the notch and the home indicator: it needs the safe-area insets. */
function Themed({ children }: Readonly<{ children: React.ReactNode }>) {
  const insets = useSafeAreaInsets();
  return (
    <ThemeProvider overrides={brands.yomizaka} insets={insets}>
      {children}
    </ThemeProvider>
  );
}

function Localised() {
  const { locale, setLocale } = useLocale();
  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      <AuthProvider>
        <StageNotice />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </I18nProvider>
  );
}
