# verikora — agent contract

<!-- krizaka-agents-template v1: rendered from krizaka/.github docs/standards/agents-template.md (scripts/agents-md.mjs). Keep every heading; the conformance check « agents-template » reads them. Repository detail goes to docs/agents.md, not here. -->

Main product repository (Verikora).

## Profile

- Kind: `app` · team: `verikora` · registry entry: [repos.json](https://github.com/krizaka/.github/blob/main/repos.json)
- Org standards: [docs/standards](https://github.com/krizaka/.github/tree/main/docs/standards) of krizaka/.github

## Commands

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
```

## Read first

- **How we write code**: the [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md)
  — architecture, the library-first lookup, the « before you code » and « before you push » checklists. Its
  [packages reference](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/references/packages.md)
  lists what every `@krizaka/*` package exports: search it before writing anything generic.
- **This repository in detail**: [docs/agents.md](docs/agents.md) — read the section of what you touch.

## The 10 rules that matter (Anti-slop, ADR-015)

1. **Libraries first.** A size check, a date sum, a money format, a fetch, a retry, a rate limit, a validation regex
   come from `@krizaka/*`; a missing function goes into the package first, never a local copy.
2. **Ports and adapters.** Domain code reads no env, no ambient clock, no database client; services talk to ports;
   route handlers are thin (authenticate, parse, one service call, map the result).
3. **One job per function.** Cognitive complexity ≤ 15, nesting ≤ 2, a body under 60 lines; a form saves once.
4. **No duplication.** The same block twice is a function; in two repositories, a package function.
5. **Data before code.** Limits, prices, durations and flags are settings an administrator changes, not constants.
6. **A closed set is a type** (`as const` object, Java enum or sealed interface), never strings compared by hand.
7. **Errors are typed** with a stable code and mapped to HTTP once; user messages come from the catalogues.
8. **Names by function** (`media-store.ts`, never `postgres.ts`, `utils`, `helpers`, `manager`).
9. **A fix starts with a failing test**, and every bug gets its guard; the journey (end-to-end) proves the feature.
10. **The checks are the judge.** No `--no-verify`, no new `eslint-disable`, no raised ratchet or baseline.

## Before you push

- [ ] The « before you push » checklist of the skill holds for what changed.
- [ ] The commands above are green locally on what changed; CI runs the rest.
- [ ] README and generated docs still say what the code does.
