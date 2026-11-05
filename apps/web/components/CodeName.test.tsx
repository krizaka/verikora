import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeNameProvider } from "@/components/CodeName";
import { SiteHeader } from "@/components/SiteChrome";
import { codeNameLine } from "@/lib/code-name";

const bar = (line: string | null) =>
  renderToStaticMarkup(
    <ThemeProvider>
      <CodeNameProvider line={line}>
        <SiteHeader locale="fr" current="home" />
      </CodeNameProvider>
    </ThemeProvider>,
  );

describe("the code name under the commercial name (dev only)", () => {
  it("is worded in the page's language and filled with the code name, on dev", () => {
    expect(codeNameLine("en", "dev")).toBe("code name: yomizaka");
    expect(codeNameLine("fr", "dev")).toBe("nom de code : yomizaka");
  });

  it("is never shown in production", () => {
    expect(codeNameLine("en", "prod")).toBeNull();
    expect(codeNameLine("fr", "prod")).toBeNull();
  });

  it("the bar's lockup carries it under the name on dev and not otherwise", () => {
    expect(bar("nom de code : yomizaka")).toContain('data-code-name="">nom de code : yomizaka</span>');
    expect(bar(null)).not.toContain('data-code-name=""');
  });

  it("waits for a wide bar (lg): at 768 px the line would push the bar past the screen (check:overflow)", () => {
    expect(bar("nom de code : yomizaka")).toContain(
      "[&amp;_[data-code-name]]:hidden lg:[&amp;_[data-code-name]]:inline",
    );
  });
});
