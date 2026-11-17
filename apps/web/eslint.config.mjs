import { krizakaUi } from "@krizaka/config/eslint/krizaka-ui";
import { krizakaNext } from "@krizaka/config/eslint/next";
import { noLocaleTernary } from "@krizaka/config/eslint/no-locale-ternary";
import { krizakaStack } from "@krizaka/config/eslint/stack";

const config = [
  ...krizakaNext,
  // The four UI rules of the Krizaka platform (no raw palette, no `light:`, no `[var(--…)]`, no className template).
  ...krizakaUi(),
  // The stack rules (server state through @krizaka/query, tables and forms through @krizaka/ui) and the words in messages.
  ...krizakaStack({ complexity: "warn", sonar: "warn", codeRules: "off" }),
  // Tests compare locales to assert on both catalogues.
  ...noLocaleTernary({
    files: ["**/*.{js,jsx,ts,tsx}"],
    routing: [
      "**/proxy.ts",
      "**/middleware.ts",
      "**/i18n.ts",
      "**/seo.ts",
      "**/I18nProvider.tsx",
      "**/*.test.{ts,tsx}",
    ],
  }),
  { files: [".dependency-cruiser.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // The public export is generated (scripts/build-public.mjs): the staged project links the sources, which are linted where they are.
  { ignores: [".next/**", ".public-build/**", "out-public/**", "next-env.d.ts"] },
];

export default config;
