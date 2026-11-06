import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../i18n";
import { StageNotice } from "./StageNotice";

const render = (stage: string, showcase = false) =>
  renderToStaticMarkup(
    <I18nProvider locale="fr" setLocale={() => undefined}>
      <StageNotice stage={stage} showcase={showcase} />
    </I18nProvider>,
  );

describe("the development-version notice of the Mac app (verikora#364)", () => {
  it("shows in the stage dev", () => {
    expect(render("dev")).toContain("Version de développement");
  });

  it("renders nothing in the filmed showcase build, whatever its stage (verikora#1968)", () => {
    expect(render("dev", true)).toBe("");
  });

  it("renders nothing in production", () => {
    expect(render("prod")).toBe("");
  });
});
