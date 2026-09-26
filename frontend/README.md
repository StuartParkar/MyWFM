# Universal MyWFM - Frontend

Next.js (App Router) + TypeScript + Tailwind CSS v4. See the root [`README.md`](../README.md) for the overall project and phase tracker, and [`documentation/architecture.md`](../documentation/architecture.md) for how this fits with the backend and database.

## Development

```bash
cp .env.example .env.local
npm run dev --workspace=frontend
```

`next.config.ts` proxies `/api/*` to the backend (`BACKEND_API_URL`, default `http://localhost:4000`) so the browser only ever talks to this Next.js origin - no CORS, and the auth refresh cookie stays same-site. See `documentation/security.md`.

## Structure

- `src/app/` - routes. `(app)/` is the authenticated shell (sidebar, top bar, Global Filter Bar); `login/` stands alone.
- `src/app/(app)/[...slug]`, `.../admin/[...slug]`, `.../system/[...slug]` - render a honest "not yet implemented" page (`src/components/ComingSoon.tsx`) for any nav item without a real page yet, sourced from `src/lib/nav/navTree.ts` (the single source of truth the sidebar also reads from).
- `src/lib/auth/AuthContext.tsx` - session state, backed by the backend's JWT access token + httpOnly refresh cookie.
- `src/lib/filters/FilterContext.tsx` - the Global Filter Bar's state (build spec section 8), including the HOD -> TL -> Agent/Senior cascade.
- `src/components/ui/` - the shared design-token-driven components (`Card`, `Badge`, `KpiCard`, `Button`, empty/loading/error states).

## Notes for future agents

This project was scaffolded with `create-next-app` on Next.js 16, which ships version-matched docs at `node_modules/next/dist/docs/` and an `AGENTS.md` pointing at them. Read the relevant guide there before changing routing, caching or data-fetching conventions - Next.js's App Router has changed meaningfully across versions (async `params`/`searchParams`, Turbopack-by-default, Cache Components as an opt-in rather than default), and this project intentionally does **not** enable `cacheComponents`.
