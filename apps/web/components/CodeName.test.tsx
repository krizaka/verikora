import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeNameProvider } from "@/components/CodeName";
import { SiteHeader } from "@/components/SiteChrome";
import { codeNameLine } from "@/lib/code-name";
import { envSchema } from "@/lib/env";

const bar = (line: string | null) =>
  renderToStaticMarkup(
    <ThemeProvider>
      <CodeNameProvider line={line}>
        <SiteHeader locale="fr" current="home" />
      </CodeNameProvider>
    </ThemeProvider>,
  );

describe("the code name under the commercial name (dev only)", () => {
  it("is worded in the page's language and filled with the code name, behind the dev-only flag", () => {
    expect(codeNameLine("en", true)).toBe("code name: yomizaka");
    expect(codeNameLine("fr", true)).toBe("nom de code : yomizaka");
  });

  it("is never shown on the public face: without the flag, nothing", () => {
    expect(codeNameLine("en", false)).toBeNull();
    expect(codeNameLine("fr", false)).toBeNull();
    expect(envSchema.parse({}).APP_SHOW_CODE_NAME).toBe(false);
    expect(envSchema.parse({ APP_SHOW_CODE_NAME: "true" }).APP_SHOW_CODE_NAME).toBe(true);
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
