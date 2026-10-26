import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { EnvironmentBand } from "./EnvironmentBand";

// yomizaka#364: the stage (VITE_APP_ENV) drives the notice on the Mac.
describe("the development-version notice on the Mac", () => {
  it("stage dev shows it, in French first, and in English when chosen", () => {
    const fr = render(
      <I18nProvider locale="fr">
        <EnvironmentBand stage="dev" />
      </I18nProvider>,
    );
    expect(screen.getByRole("region", { name: "Version de développement" })).toBeTruthy();
    fr.unmount();
    render(
      <I18nProvider locale="en">
        <EnvironmentBand stage="dev" />
      </I18nProvider>,
    );
    expect(screen.getByRole("region", { name: "Development version" })).toBeTruthy();
  });
  it("stage prod renders nothing", () => {
    render(
      <I18nProvider locale="fr">
        <EnvironmentBand stage="prod" />
      </I18nProvider>,
    );
    expect(screen.queryByRole("region")).toBeNull();
  });
});
