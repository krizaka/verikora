import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { describeVerikoraSettings } from "@/lib/settings/describe";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { SettingRow } from "./ConfigView";

type Tree = { [key: string]: Tree | string };
const sayIn = (messages: unknown) => (path: string) =>
  `console.${path}`.split(".").reduce<Tree | string>((node, part) => (node as Tree)[part], messages as Tree) as string;

const def = describeVerikoraSettings().find((d) => d.key === "signup.open");
const draw = (messages: unknown, value: boolean | undefined) =>
  renderToStaticMarkup(
    <ThemeProvider>
      <SettingRow
        def={def!}
        scope="global"
        override={value}
        effective={{ value: value ?? false, source: value === undefined ? "default" : "global" }}
        say={sayIn(messages)}
        onSet={async () => undefined}
        onReset={() => undefined}
      />
    </ThemeProvider>,
  );

describe("the « Sign-up open » switch of the administration", () => {
  it("is a labelled switch, off by default, in French and in English", () => {
    expect(def?.kind).toBe("flag");
    const french = draw(fr, undefined);
    const english = draw(en, undefined);
    expect(french).toContain("Inscription ouverte");
    expect(english).toContain("Sign-up open");
    for (const html of [french, english]) {
      expect(html).toMatch(/role="switch"/);
      expect(html).toMatch(/aria-checked="false"/);
    }
  });

  it("shows it on, and as modified, once an administrator opened it", () => {
    const html = draw(en, true);
    expect(html).toMatch(/aria-checked="true"/);
    expect(html).toContain('data-modified="true"');
  });
});
