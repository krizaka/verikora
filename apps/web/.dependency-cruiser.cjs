// « Krizaka first », cycles, unresolvable imports, dev dependencies (@krizaka/config, krizaka/.github#232).
// Run from this workspace (`pnpm lint`); the recorded violations are in .dependency-cruiser-known-violations.json and only shrink.
const preset = require("@krizaka/config/dependency-cruiser");

// A contract suite (`*.contract.ts`, e.g. the DocumentFileStore contract every adapter runs) is test code: it may import vitest.
const withContractSuites = (rule) =>
  rule.name === "not-to-dev-dep"
    ? { ...rule, from: { ...rule.from, pathNot: [...[rule.from?.pathNot ?? []].flat(), "[.]contract[.]ts$"] } }
    : rule;

module.exports = {
  ...preset,
  forbidden: preset.forbidden.map(withContractSuites),
  options: { ...preset.options, tsConfig: { fileName: "tsconfig.json" } },
};
