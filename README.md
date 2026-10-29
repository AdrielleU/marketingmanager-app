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
- **Spam safeguards**: posts to Reddit and X are spaced out per account (Reddit: 10 min apart, 10/day; X: 5 min, 50/day), and repeating recent text there, or sending it to several accounts of the same platform at once, asks for confirmation first
- **Channels**: Bluesky (handle + app password), X, LinkedIn and Reddit (OAuth 2.0), Mastodon (access token), Telegram (bot), Discord (webhook), YouTube (inbox only), and Facebook and Instagram (scheduled here, posted by hand from *Ready to post*). Tokens are encrypted at rest (AES-256-GCM)
- **Teams**: workspaces, roles (owner / admin / member), invite links, multiple workspaces per user
- **Analytics**: likes, reposts, replies and X impressions; top posts; engagement by day. Stats refresh every 30 minutes
- **Inbox**: replies, @mentions and keyword matches from Bluesky, Mastodon, Reddit and YouTube, plus Google Alerts feeds, in one list, with filters and replying from the app. Checked every 5 minutes

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
pnpm db:up                        # Postgres on localhost:5434, data in ./data/postgres
pnpm db:push                      # create tables
pnpm dev                          # web app: http://localhost:3300
pnpm worker                       # in a second terminal: publishes posts + refreshes stats
```

Open http://localhost:3300, create an account and a workspace, then connect a channel.

- **Database data** lives in `./data/postgres` (git-ignored). `pnpm db:reset` wipes it and recreates the schema.
- **Logs:** the web app and worker print readable log lines. Set `LOG_FORMAT=json` for one JSON object per line (the default when `NODE_ENV=production`), and `LOG_LEVEL=debug|info|warn|error` to filter.
- **Queue state** (pending, retrying and failed publish jobs) lives in the `pgboss` schema of the same database, so you can browse it with `pnpm db:studio` or psql.

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

**Mastodon**: no app config in `.env`. On your Mastodon server, go to *Preferences → Development → New application*.
- Scopes: `read:accounts`, `read:statuses`, `write:statuses`, `write:media`.
- Enter your server (e.g. `mastodon.social`) and *Your access token* on the Channels page.
- Posts are limited to 500 characters, the Mastodon default, even if your server allows more.

**Reddit**: create a *web app* at reddit.com/prefs/apps.
- Redirect URI: `http://localhost:3300/api/oauth/reddit/callback`
- Set `REDDIT_CLIENT_ID` (the id under the app name) / `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` to `web:<app name>:<version> (by /u/<your username>)`.
- The app asks for the `identity submit read privatemessages` scopes (`privatemessages` is Reddit's inbox, where replies and mentions arrive).
- Each post needs a subreddit and title, entered per channel in the composer. Text posts only for now (no images).
- Reddit's free API tier is for non-commercial use; check their Data API terms before using it for a business.

**Telegram**: create a bot with @BotFather and add it to your channel as an admin with *Post messages*.
- Enter the bot token and the channel (`@username`, or the numeric `-100…` id for a private channel) on the Channels page.
- Captions on images are limited to 1024 characters; longer text is sent as a follow-up message.
- The Bot API doesn't expose view counts, so there are no analytics.

**Discord**: in your server, go to *Server Settings → Integrations → Webhooks → New Webhook*, choose the channel and copy the webhook URL.
- Paste it on the Channels page. Messages are limited to 2000 characters and 10 images.
- Webhooks can't read reactions, so there are no analytics.

**YouTube** (inbox only: comments on your videos and Shorts, keyword matches, replies; no uploads yet): in Google Cloud Console, create a project, enable the *YouTube Data API v3*, set up the OAuth consent screen, and create an OAuth client of type *Web application*.
- Authorized redirect URI: `http://localhost:3300/api/oauth/youtube/callback`
- Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
- While the consent screen is in *Testing*, add your Google account as a test user. Google expires testing refresh tokens after 7 days, so the channel will ask to reconnect weekly until you move the app to *In production* (the `youtube.force-ssl` scope needs Google's verification for more than 100 users).
- The free quota is 10,000 units a day per Google Cloud project, shared by every connected account: a keyword search costs 100, so YouTube keywords are checked every 3 hours; reading comments costs 1 and replying 50. You can ask Google for more quota (free) through the YouTube API audit form.

**Facebook and Instagram** (posted by hand, no Meta API): add the Page link or @handle on the Channels page. Schedule posts as usual; when one is due it moves to **Ready to post** (sidebar), where *Copy & open* copies the caption, downloads the images in order and opens the account. Post it on the platform signed in as your brand, then click *Posted* (pasting the post's link is optional). *Skip* marks it failed, so *Retry failed channels* can bring it back. Instagram posts need at least one image. For replies, turn on comment and mention emails in Facebook and Instagram and add those emails to the notification email folder below; check which notifications Meta actually emails you by commenting on a test post.

### Notification emails (Reddit and others, without their API)

The Inbox can read one folder of a mailbox and turn platform notification emails (Reddit, Facebook and Instagram replies and mentions, YouTube comments, X and Mastodon notifications) into inbox items with a direct link to the thread. Nothing goes through the platform's API, and the app never changes, deletes or marks mail as read (the folder is opened read-only).

1. In Reddit (and the others), turn on email notifications for replies and mentions in the account's notification settings.
2. In Gmail, create a label (e.g. `Marketing Manager`) and a filter: *from* `redditmail.com OR facebookmail.com OR mail.instagram.com OR youtube.com OR x.com` → apply the label (and *Skip the inbox* if you like).
3. Create an app password: Google Account → Security → 2-Step Verification → App passwords.
4. In the app's Inbox, under *Notification emails*, add the address, the app password and the label name.

Email only covers your own activity (replies to your posts and comments, mentions). For keyword monitoring across the web, add a Google Alerts feed. The parsers are best guesses at each platform's email format; if an item looks wrong, the email still shows up with its subject.

### Reply drafts with the Claude CLI

Set `DRAFTS_WITH_CLAUDE_CLI=true` and the worker asks the Claude CLI (Claude Code, using its own login) to draft a reply for every new reply and mention; other items get a *Draft reply* button. Drafts appear on the item with *Copy & open thread* (or prefilled in the reply box for channels that reply from the app). A person always edits and sends.

- Install the CLI and sign in on the machine that runs `pnpm worker`.
- Add product facts, links and tone under *Reply guidelines* in the Inbox; that's all Claude knows about the company.
- The CLI runs with no tools, no MCP servers and none of your Claude settings or hooks, in an empty folder, one draft at a time. The messages it reads come from strangers, so it's told never to follow instructions in them, and it can answer "don't reply" when a brand comment would come across as spam.

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

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and the [security policy](SECURITY.md). [CLAUDE.md](CLAUDE.md) documents the architecture and conventions; it's written for AI coding agents, but it's the best quick tour for humans too.

## License

MIT, see [LICENSE](LICENSE).
