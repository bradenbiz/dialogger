# AGENTS.md

Notes for AI agents (and humans) working in this repo. The README covers what Dialogger is and how to run it; this file covers how the code is organized, the traps we've already hit, and how to commit and open PRs.

## Commands

```bash
pnpm dev          # Vite + Nitro on http://127.0.0.1:4310 (UI, API, SSE, WebSocket on one port)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (tests/)
pnpm build        # typecheck, then vite build into .output/
pnpm start        # serve the production build
```

Before committing, run `pnpm typecheck` and `pnpm test`. For changes to what the browser loads, also run `pnpm build` and compare the `assets/index-*.js` gzip size before and after.

## Layout

| Path | What lives there |
| --- | --- |
| `server/api/**` | Nitro file-based routes: `<name>.<method>.ts`, `[param]` folders |
| `server/routes/ws/**` | Live-mic WebSocket (crossws) |
| `server/middleware/` | `auth.ts` (API key / session cookie for `/api/*`), `openapi.ts` (fills in schema definitions) |
| `server/plugins/startup.ts` | Startup guard and seed data |
| `server/lib/` | Plain modules Nitro doesn't scan: `store.ts` (sessions, persistence, SSE broadcast), `jobs.ts` (transcription/map job tracking), `speech.ts`, `live.ts`, `mapper.ts`, `youtube.ts`, `voicebank.ts`, `prompt.ts`, `auth.ts`, `http.ts` (route helpers) |
| `shared/schemas/` | Zod schemas shared by server, UI types, and OpenAPI: `models.ts`, `contracts.ts`, `events.ts`, `registry.ts` |
| `shared/ibis.ts` | IBIS helpers (node meta, speaker palette, legal children, Conklin stats); no Zod |
| `src/App.tsx` | The single screen: owns app state, the SSE subscription, and handlers passed down as props |
| `src/components/` | Feature components; `panels.tsx` holds the lazy-loaded modals |
| `src/lib/` | `api.ts` (typed fetch/SSE client), `url-state.ts`, `export.ts`, `format.ts`, `layout.ts` (d3-hierarchy), `audio-capture.ts` |
| `tests/` | Vitest; `vitest.config.ts` is separate so tests don't boot the Nitro plugin |

Path aliases: `@/` is `src/`, `@shared/` is `shared/`. Server code imports `shared/` by relative path (`../../shared/...` from `server/lib/`).

`server/` holds only Nitro's scanned folders (`api/`, `routes/`, `middleware/`, `plugins/`), where a file's location decides what it becomes, plus `lib/` for everything else. Put new server modules in `server/lib/`, not at the top level, and don't name a folder `utils/`, which Nitro can treat specially.

## Design patterns

### Server

- **Thin route handlers.** Each route file is `defineRouteMeta({ openAPI })` + `defineHandler`. Validate with `parseBody(event, Schema)` from `server/lib/http.ts`; if it returns a `Response`, return it. Business logic lives in `server/lib/`, mostly `sessionStore`.
- **One error shape.** Non-2xx responses are `{ error }` via `fail(status, error)`. Validation errors are `{ formErrors, fieldErrors }` from `z.flattenError`.
- **Responses are checked against contracts** with `satisfies SomeResponse`, not cast.
- **OpenAPI from Zod.** `defineRouteMeta` only allows static literals, so routes reference `#/components/schemas/<Name>`. Name a schema with `named("Name", schema)` in `shared/schemas/*`; `server/middleware/openapi.ts` fills in the definitions at request time. `pnpm test` fails if a `$ref` points at a name that doesn't exist. Document 400/401/404 responses like the existing routes do.
- **Live updates go through the store.** Mutations call `sessionStore.broadcast(id, event)`; `GET /api/sessions/[id]/events` streams those as SSE. Event shapes are the `SessionSSEEvent` union in `shared/schemas/events.ts`.
- **Long jobs are cancellable.** Transcription registers an `AbortController` in `server/lib/jobs.ts`; a newer job or `/transcribe/stop` cancels the old one, which then returns `{ cancelled: true }`.

### Web UI

- **One page, no router.** `?session=<id>&panel=settings|youtube|agent` is the URL state, read and written by `src/lib/url-state.ts` (`useUrlState`, `openPanel`, `closePanel`). Switching sessions pushes a history entry; closing a panel the app opened steps back, so Back never reopens it. We tried TanStack Router and dropped it: about 30 KB gzip for one screen. Revisit only if real pages appear.
- **State lives in `App.tsx`** and flows down as props and callbacks. Components don't fetch on their own, except modals loading their own settings data.
- **Typed API client.** `src/lib/api.ts` uses the request/response types from `shared/schemas/contracts.ts`. A 401 (`ApiError.status`) shows the sign-in screen. `api.subscribeToSession` wraps `EventSource`; `App.tsx` applies each event to `session` in one `switch`.
- **Load code when it's needed.** Modals are `React.lazy` in `src/components/panels.tsx`, and buttons that open them spread `preloadOnIntent(panel)` to start the download on hover or focus. Exporters (`lib/export.ts`) and mic capture (`lib/audio-capture.ts`) are dynamic `import()`s at the point of use.
- **Styling** is Tailwind v4 utilities inline (stone palette, `text-xs`, `rounded-lg`/`rounded-xl`, `transition`). No CSS modules; shared tokens are in `src/index.css`.
- **Accessible names.** Icon-only buttons need an `aria-label`, not just a `title`.

## Pitfalls we've hit

- **lucide-react barrel import.** Don't `import { X } from "lucide-react"`. Import each icon from its own module:
  ```ts
  import X from "lucide-react/icons/x";
  import Loader2 from "lucide-react/icons/loader-circle"; // aliases map to canonical names
  ```
  The barrel re-exports ~1,900 icons, so the dev server loads all of them, and production relies on tree-shaking to remove them. Some old names are aliases (`Loader2` → `loader-circle`, `AlertCircle` → `circle-alert`, `CheckCircle2` → `circle-check`); the file name is the canonical kebab-case name. lucide v1 removed brand icons, so YouTube uses the local `src/components/YoutubeIcon.tsx`.
- **No barrel files of our own.** Import from the module that defines the thing (e.g. `@/lib/format`), not an `index.ts` that re-exports a folder.
- **A lazy chunk is only lazy if nothing imports it statically.** One stray static import (e.g. `formatTime` from `lib/export`) pulls the module back into the main bundle. That's why `formatTime` lives in `lib/format.ts`. Import modals only through `components/panels.tsx`.
- **Keep runtime Zod out of the browser.** `src/` may `import type` from `shared/schemas/*`, but a value import pulls in Zod and every registered schema (~20+ KB gzip). For client-side form validation use `zod/mini`; keep enums the UI needs as plain arrays in a Zod-free shared module, and build the Zod enums from those arrays.
- **pnpm's release-age policy can be bypassed silently.** `pnpm add` of a package published in the last day can append a `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml`. Never commit that; pin an older version that passes the policy instead (`npm view <pkg> time`). Verify with `pnpm install --frozen-lockfile`.
- **Check for stray generated or local files before committing:** `.output/`, `.nitro/`, `.dialogger-data/`, `.claude/launch.json`, and generated files from other branches. Run `git status` first.
- **yt-dlp `HTTP Error 403`** means yt-dlp is outdated (see README), not a bug in the YouTube import code.

## Git

- **Commit messages are a single title line.** No body and no trailers. Imperative and specific, e.g. `Load the exporters and mic capture on demand`.
- **Never push, force-push, or open/merge a PR without explicit approval** from the user for that action.
- Changes that aren't specific to one feature branch (performance, tooling, shared fixes) go on the base branch first; then rebase the branches stacked on it.
- Don't rewrite history that has been pushed.

## Pull requests

Every PR description has:

1. **Why.** The problem this PR fixes or the need it meets, in a few sentences, before any list of changes.
2. **Changes.** A list, each item starting with one of these Gitmoji:

   | Emoji | Use for                                |
   | ----- | -------------------------------------- |
   | 🎨    | Improve structure / format of the code |
   | ⚡️    | Improve performance                    |
   | 🔥    | Remove code or files                   |
   | 🐛    | Fix a bug                              |
   | 🚑️    | Critical hotfix                        |
   | ✨    | Introduce new features                 |
   | 📝    | Add or update documentation            |
   | 💄    | Add or update the UI and style files   |

3. **Screenshots / recordings** of every new or changed page, component, or behavior. Use a recording when the change is an interaction (opening, closing, navigation, loading). If nothing visible changed, say the UI is visually unchanged.
4. **How it was verified.** Commands run (typecheck, tests, build size) and what was checked in the browser.

**Attaching screenshots.** `gh` uploads images and video itself (gh 2.100+, needs push access to the target repo). Reference the local file in the body where it should appear, then pass the same path to `--attach`; `gh` swaps the path for the hosted URL:

```bash
# pr-body.md contains: ![Swagger UI at /_swagger](/abs/path/swagger.png)
gh pr create --repo bradenbiz/dialogger --base main --head <you>:<branch> \
  --title "…" --body-file pr-body.md --attach "/abs/path/swagger.png#Swagger UI at /_swagger"
```

An attached file the body doesn't reference is appended at the end. `gh pr edit` and `gh pr comment` take `--attach` too. Don't commit screenshots to the repo or push a branch just to host them. Take screenshots against a throwaway `DIALOGGER_DATA_DIR` (e.g. with the Live Demo), so no real session content ends up in a public PR.
