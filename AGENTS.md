# verikora — agent contract

<!-- krizaka-agents-template v2: rendered from krizaka/.github docs/standards/agents-template.md (scripts/agents-md.mjs). The one AGENTS.md standard: six sections in this order, at most 150 lines, bullets and imperatives. The conformance check « agents-template » reads the headings, the length and CLAUDE.md. Detail goes to docs/ via References, not here. -->

## Project context

- Main product repository (Verikora): web app (`apps/web`), mobile (`apps/mobile`), desktop (`apps/desktop`), shared `packages/client` and `packages/core`.
- Kind: `app` · team: `verikora` · registry entry: [repos.json](https://github.com/krizaka/.github/blob/main/repos.json).
- Read this file first, then the section of [docs/agents.md](docs/agents.md) for what you touch.
- `CLAUDE.md` is the one line `@AGENTS.md` (or a symlink to this file): never a second copy of it.

## Essential commands

pnpm workspace (`pnpm@10.34.6`), driven by turbo; `pnpm install` also points git at `.githooks` (`prepare`).

```bash
pnpm run format        # prettier --write
pnpm run lint          # workspace guard, turbo lint, i18n and code-name checks, ast-grep rules and ratchet, format:check
pnpm run typecheck
pnpm run test          # turbo tests, then the root vitest run
pnpm run build
pnpm run check         # lint + typecheck + test
```

- Run them on what you changed before every push; CI runs the rest.
- `pnpm run merge:messages` regenerates the merged messages that `lint` checks; `pnpm run sg:ratchet:update` is for the ratchet owners only, never to get green.

## Architecture & conventions

- Follow the [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md); search its [packages reference](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/references/packages.md) before writing anything generic.
- Take libraries first: a size check, a date sum, a money format, a fetch, a retry, a rate limit, a validation regex come from `@krizaka/*`; a missing function goes into the package first, never a local copy.
- Keep ports and adapters: domain code reads no env, no ambient clock, no database client; services talk to ports; route handlers are thin (authenticate, parse, one service call, map the result).
- Write one job per function: cognitive complexity ≤ 15, nesting ≤ 2, a body under 60 lines; a form saves once; the same block twice is a function, in two repositories a package function.
- Put limits, prices, durations and flags in settings an administrator changes, not in constants.
- A closed set is a type (`as const` object, Java enum or sealed interface), never strings compared by hand.
- Type errors with a stable code, mapped to HTTP once; user messages come from the catalogues.
- Name things by what they do (`media-store.ts`, never `postgres.ts`, `utils`, `helpers`, `manager`).
- Hierarchy: this root file holds the rules of the whole repository; a sub-folder with its own rules adds a local `AGENTS.md` that says only what differs there. The nearest file wins.

## Guard-rails & known pitfalls (read before coding)

- A recurring mistake becomes one rule here, one line; its detail goes to `docs/` and is linked from References.
- The checks are the judge ([ADR-015](https://github.com/krizaka/krizaka-internal/blob/main/docs/adr/.github/ADR-015-ai-code-audit-measured-and-enforced.md), [guards](https://github.com/krizaka/.github/blob/main/docs/standards/guards.md)): never `--no-verify`, never a new `eslint-disable`, never a raised ratchet or baseline; a rule is never silenced to get green.
- Anti-slop, what a model tends to write and the code does not need:
  - No defensive null on `@NullMarked` code: no `Objects.requireNonNull` or `if (x == null)` on a value the type guarantees (NullAway); a new package is `@NullMarked` (ArchUnit).
  - A closed set is a type, never a string compared by hand; strategies are a `Map<Kind, Strategy>` built once.
  - HTTP in Java is a DTO record, `@Valid` and `ProblemDetail`: no `Map.of("error", …)`, no entity in a response, one `@RestControllerAdvice` per service (ArchUnit).
  - Use `?.` and `??` in TypeScript, not a chain of `&&` or a ternary on null.
- Start a fix with a failing test; every bug gets its guard; the journey (end to end) proves the feature.
- Never invent a URL, a law article, a price or a figure you did not read; write `TO VALIDATE` and say who decides.
- Never commit a secret, a capture or a log; no production data in a session, only the dev data.
- Sovkora does the analysis, never this repository; the product stays independent: read the sections 2 and 3 of [docs/agents.md](docs/agents.md) before touching analysis or cross-product code.
- Keep the edit hook in `.claude/settings.json`: `npx --yes -p @krizaka/config krizaka-edit-check` on `Edit|Write`.
- Every user-facing string lives in the message catalogues (`apps/web/messages/`, English is the reference; checked by `check:i18n` and `check:code-names`); never choose a text with a locale ternary.

## Expected validation workflow

- [ ] Compile, format, lint and test what changed (the commands above); fix the cause of a red, never the guard.
- [ ] The « before you push » checklist of the skill holds for what changed.
- [ ] A feature or fix PR names its journey (`Journey: <name>` or `Journey: n/a — <reason>`).
- [ ] README and generated docs still say what the code does; the docs map category of the change is updated.
- [ ] One issue, one small PR (`Closes #<n>`); merge only with green CI.

## References

- [docs/agents.md](docs/agents.md): this repository's own detail (storage, dev security, checks, ast-grep rules, anti-slop), read by section.
- [Org standards](https://github.com/krizaka/.github/tree/main/docs/standards) of krizaka/.github; the [engineering charter](https://github.com/krizaka/.github/blob/main/AGENTS.template.md) (naming, tests, mobile, coding agents).
- [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md).
