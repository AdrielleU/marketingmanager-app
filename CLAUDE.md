# Marketing Manager

An MIT-licensed, self-hostable social media scheduler: compose a post once, schedule it to several channels, and track how it performs. Built for small teams; it should stay light enough to run on a laptop.

@AGENTS.md

## Licensing rule (most important)

This project is MIT and written from scratch. **Never copy code, schemas, components or copy text from AGPL/GPL projects** (Postiz included) or from any source whose license is unclear. Getting ideas or feature lists from other products is fine. When adding a dependency, check that its license is permissive (MIT, Apache-2.0, BSD, ISC).

## Commands

```bash
pnpm db:up        # Postgres 17 on localhost:5434 (data in ./data/postgres)
pnpm db:push      # apply prisma/schema.prisma to the database
pnpm db:reset     # wipe the local database and recreate the schema
pnpm db:studio    # browse data
pnpm dev          # web app on http://localhost:3300 (Turbopack)
pnpm worker       # background worker (publishing + metrics), reloads on change
pnpm typecheck    # tsc --noEmit: run this after every change
pnpm build        # production build
```

Run `pnpm typecheck` before saying a change is done. There's no test suite yet; when you add tests, use Vitest and put them next to the file they test (`foo.test.ts`).

## Architecture

- **Two processes, one database.** The Next.js app (`src/app`, `src/actions`) only reads and writes Postgres rows. The worker (`src/worker/index.ts`) does everything slow or external: publishing and metrics. They share code in `src/lib`.
- **Queues: pg-boss** (Postgres-backed, no Redis). Every 10 seconds the worker claims due `SCHEDULED` posts (`dispatchDuePosts`) and enqueues one `publish-target` job per channel (3 retries, backoff). `refresh-metrics` runs on a cron every 30 minutes. Queue names and logic live in `src/lib/publishing.ts`.
- **Inbox** (`src/lib/inbox.ts`): `inbox-sync` runs every 5 minutes and stores replies, mentions and keyword matches as `InboxItem` rows (providers' optional `fetchInbox` / `searchPosts`). Replies written in the app are saved as `PENDING` and sent by the worker's 10-second tick (`sendPendingReplies`), never from the web app.
- **Post lifecycle:** `DRAFT → SCHEDULED → PUBLISHING → PUBLISHED | PARTIAL | FAILED`. Each channel has its own `PostTarget` row with its own status, error and external URL. Manual channels (`connectType: 'manual'`, e.g. Facebook/Instagram) never get a publish job: at dispatch their target becomes `READY` and waits in *Ready to post* until a person marks it posted. Only `DRAFT`, `SCHEDULED` and `FAILED` posts can be edited (enforced with a conditional `updateMany` so the worker can't race an edit).
- **Providers** (`src/lib/providers/`): one file per channel implementing `OAuthProvider` or `CredentialsProvider` from `types.ts`, registered in `index.ts`. Generic code must never branch on a provider id. If a channel needs special behavior, add a method or flag to the interface and implement it in that provider. Throw `ReconnectRequiredError` for auth failures, which marks the channel "needs reconnecting" and skips retries.
- **Auth:** email + bcrypt password, random session token in an httpOnly cookie, only its SHA-256 stored (`Session.id`). `requireUser()` / `requireOrg(minRole)` in `src/lib/auth.ts`.
- **Multi-tenancy:** every query on org data must filter by `orgId` from `requireOrg()`. Never trust an id from the client without scoping it to the org (use `findFirst`/`updateMany`/`deleteMany` with `orgId` in the `where`).

## Conventions

- **Server actions** go in `src/actions/<area>.ts` (`'use server'`). Validate input with zod, call `requireOrg()` with the right role first, then `revalidatePath` the affected pages.
  - Form actions return `FormState` (`{ error?: string }`) and pair with `<ActionForm>` from `src/components/form.tsx`.
  - Actions called from client code return a result object instead of throwing.
- **Secrets:** channel tokens are encrypted with `encrypt()`/`decrypt()` (`src/lib/crypto.ts`, AES-256-GCM, `ENCRYPTION_KEY`). Never send tokens to the browser: select channels with `publicChannelSelect`, and always use an explicit `select` for `User`/`Channel`/`Session` rows that reach a page or response.
- **Database:** Prisma only, no raw SQL. After changing `schema.prisma` run `pnpm db:push` (there are no migration files yet; add `prisma migrate` before the first production deploy).
- **Logging:** use `createLogger(scope)` from `src/lib/logger.ts`, not `console.*`. Pass context as fields (`log.info('published', { postId, provider })`), and pass errors as `{ error: e }`. Never log tokens, passwords or post bodies.
- **UI:** Tailwind 3 plus the component classes in `src/app/globals.css` (`btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `card`, `page-title`). Write native components; don't add UI kits. Use `brand-*` colors for accents.
  - Times are stored in UTC and shown in the viewer's time zone through client components (`<LocalTime>`).
- **Server vs client:** pages are server components that load data and pass plain serializable props to a `'use client'` component when interactivity is needed (see `calendar/` and `compose/`). Don't import `src/lib/providers` or `src/lib/db` into client components.
- Keep files focused and match the surrounding style: 2-space indent, single quotes, named exports, short comments that explain *why*.

## Environment

See `.env.example`. Required: `DATABASE_URL`, `APP_URL`, `ENCRYPTION_KEY` (`openssl rand -hex 32`). Optional: X/LinkedIn OAuth credentials, `LOG_LEVEL`, `LOG_FORMAT=json`.

## Adding a channel (checklist)

1. `src/lib/providers/<id>.ts`: implement the interface. Respect the platform's character and image limits (`maxLength`, `maxImages`). If posts need extra input (a title, a target community), declare `postFields`; the composer renders them and `publish` receives the values.
2. Add `<id>` to `ProviderId` in `types.ts` and register it in `index.ts`. A channel can also be inbox-only (no `publish`) or `manual` (posted by hand); generic code checks these, never the id.
3. Add a letter mark in `src/components/provider-icon.tsx`.
4. Document the app setup (callback URL, scopes) in README "Connecting channels" and add its env vars to `.env.example`.
