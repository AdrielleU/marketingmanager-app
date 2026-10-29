# Marketing Manager

Plan, schedule and measure social media posts across channels. MIT licensed, self-hostable, and light enough to run on a laptop (about 1.2 GB of RAM in development).

## About

Marketing Manager is based on the feature set of [Postiz](https://github.com/gitroomhq/postiz-app), an open-source social media scheduler licensed under AGPL-3.0. I wanted an **MIT-licensed, open-source, free version** that anyone can use, modify and build on with no copyleft strings attached. So this project was written from scratch: it borrows ideas, not code.

### Other tools in this space

| Tool | Type | Notes |
|---|---|---|
| [Postiz](https://postiz.com) | Open source (AGPL-3.0) / SaaS | Broad channel support; the inspiration for this project |
| [Mixpost](https://mixpost.app) | Open source / self-hosted | Laravel-based self-hosted scheduler |
| [Buffer](https://buffer.com) | SaaS | Simple scheduling and analytics for small teams and creators |
| [Hootsuite](https://hootsuite.com) | SaaS | Enterprise suite: scheduling, listening, inbox, ads |
| [Sprout Social](https://sproutsocial.com) | SaaS | Premium all-in-one engagement and reporting |
| [Later](https://later.com) | SaaS | Visual planner, strong on Instagram and TikTok |
| [Agorapulse](https://www.agorapulse.com) | SaaS | Unified social inbox and ROI reporting |
| [Sendible](https://www.sendible.com) | SaaS | Agency-focused, white-label client management |
| [SocialBee](https://socialbee.com) | SaaS | Category-based content recycling |
| [Publer](https://publer.io) | SaaS | Affordable scheduler with bulk posting |
| [Metricool](https://metricool.com) | SaaS | Analytics-heavy, includes ads and web analytics |
| [Loomly](https://www.loomly.com) | SaaS | Content calendar with approval workflows |
| [Planable](https://planable.io) | SaaS | Collaboration and approvals for teams |
| [Typefully](https://typefully.com) | SaaS | Writing and scheduling for X, LinkedIn, Threads, Bluesky |

> Contributors: keep this codebase MIT. Don't copy code from AGPL/GPL projects (including Postiz) into this repo.

## Features (v0.1)

- **Composer**: write once and publish to several channels, with per-channel character limits, image uploads and a live preview
- **Calendar**: month view of scheduled, published and draft posts; click a day to plan a post on it
- **Scheduling**: publish now or at a set time, with automatic retries (3 attempts with backoff) and per-channel success/failure
- **Channels**: Bluesky (handle + app password), X and LinkedIn (OAuth 2.0). Tokens are encrypted at rest (AES-256-GCM)
- **Teams**: workspaces, roles (owner / admin / member), invite links, multiple workspaces per user
- **Analytics**: likes, reposts, replies and X impressions; top posts; engagement by day. Stats refresh every 30 minutes

## Stack

| Piece | Choice |
|---|---|
| Web app | Next.js 16 (App Router, server actions), React 19, Tailwind 3 |
| Database | Postgres 17 + Prisma 6 |
| Background jobs | [pg-boss](https://github.com/timgit/pg-boss) on the same Postgres (no Redis or Temporal) |
| Auth | Email + password (bcrypt), DB-backed sessions in an httpOnly cookie |

## Running locally

Requirements: Node 22+, pnpm 10, Podman (or Docker) with compose.

```bash
cp .env.example .env              # then set ENCRYPTION_KEY: openssl rand -hex 32
pnpm install
pnpm db:up                        # Postgres on localhost:5434
pnpm db:push                      # create tables
pnpm dev                          # web app: http://localhost:3300
pnpm worker                       # in a second terminal: publishes posts + refreshes stats
```

Open http://localhost:3300, create an account and a workspace, then connect a channel.

## Connecting channels

**Bluesky**: no app setup needed. In Bluesky, go to *Settings → Privacy and security → App passwords*, create one, and enter your handle and that app password on the Channels page.

**X**: create a project and app at developer.x.com and enable OAuth 2.0 (type: Web App / confidential client).
- Callback URL: `http://localhost:3300/api/oauth/x/callback`
- Put the client ID and secret in `X_CLIENT_ID` / `X_CLIENT_SECRET`.
- The free API tier allows only a small number of posts per month.

**LinkedIn**: create an app at linkedin.com/developers and add the *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn* products.
- Redirect URL: `http://localhost:3300/api/oauth/linkedin/callback`
- Set `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.
- Access lasts 60 days, after which the channel shows "Needs reconnecting".
- LinkedIn doesn't expose stats for personal posts to standard apps.

## How publishing works

1. The web app only writes `Post` rows (plus one `PostTarget` per channel). Editing or unscheduling a post before it's due needs no queue bookkeeping.
2. Every 10 seconds the worker claims due `SCHEDULED` posts (status becomes `PUBLISHING`) and enqueues one pg-boss job per channel.
3. Each job publishes through the channel's provider. Transient errors retry; auth errors mark the channel "needs reconnecting" and fail immediately.
4. When every channel is done, the post becomes `PUBLISHED`, `PARTIAL` or `FAILED`. Failed channels can be retried from the post.

## Project layout

```
prisma/schema.prisma      data model
src/lib/providers/        one file per channel + shared Provider interface (add new channels here)
src/lib/publishing.ts     dispatch, publish, retry and metrics logic (used by the worker)
src/worker/index.ts       background worker entry point
src/actions/              server actions (auth, posts, channels, team)
src/app/(app)/            signed-in pages: calendar, compose, posts, analytics, channels, team
src/app/(auth)/           login, register, onboarding, invite acceptance
src/app/api/              OAuth connect/callback routes, media upload
```

## Adding a channel

1. Create `src/lib/providers/<name>.ts` implementing `OAuthProvider` or `CredentialsProvider` from `types.ts`.
2. Register it in `src/lib/providers/index.ts`.
3. Add a letter mark in `src/components/provider-icon.tsx`.

## Not built yet / ideas

- Email delivery for invites (currently copy-the-link) and password reset
- Week view and drag-to-reschedule on the calendar
- Threads/replies and per-channel text variations
- Video uploads, more channels (Mastodon, Threads, Instagram, Facebook, YouTube, TikTok)
- Approval workflow, post templates, link shortening and UTM tagging
- Login rate limiting and 2FA before exposing this to the internet

## License

MIT, see [LICENSE](LICENSE).
