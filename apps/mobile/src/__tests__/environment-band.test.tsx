import { ThemeProvider } from "@krizaka/ui/native";
import { render, screen } from "@testing-library/react-native";
import * as React from "react";

import { I18nProvider } from "@/i18n";
import { EnvironmentBand } from "@/ui/EnvironmentBand";

const shown = (stage: string, locale: "fr" | "en" = "fr") =>
  render(
    <ThemeProvider>
      <I18nProvider locale={locale} setLocale={() => {}}>
        <EnvironmentBand stage={stage} />
      </I18nProvider>
    </ThemeProvider>,
  );

// yomizaka#364: the stage (EXPO_PUBLIC_APP_ENV) drives the notice on the phone.
describe("the development-version notice on the phone", () => {
  it("stage dev shows it, in French first", async () => {
    await shown("dev");
    expect(screen.getByLabelText("Version de développement")).toBeTruthy();
  });
  it("in English when chosen", async () => {
    await shown("dev", "en");
    expect(screen.getByLabelText("Development version")).toBeTruthy();
  });
  it("stage prod renders nothing", async () => {
    await shown("prod");
    expect(screen.queryByLabelText("Version de développement")).toBeNull();
  });
});
