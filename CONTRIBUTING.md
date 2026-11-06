# Contributing to Verikora

1. Node 22 and pnpm 10 (`corepack enable`). `pnpm install` also installs the pre-push hook.
2. `cp .env.example .env` and fill a local PostgreSQL URL; `pnpm dev` → http://localhost:3000.
3. Every change ships with its tests; `pnpm run check` passes before you push (the hook runs it).
4. Text goes in `apps/web/messages/{en,fr}.json`; UI from `@krizaka/ui`; analyses only through Sovkora (AGENTS.md §2).
5. Open a pull request; CI must be green. Feedback and ideas: the pinned Discussion of the repository.
