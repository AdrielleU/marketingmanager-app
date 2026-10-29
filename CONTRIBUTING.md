# Contributing

Thanks for helping build a free, MIT-licensed social media scheduler. Bug reports, ideas, docs and code are all welcome.

## Ground rules

- **Original code only.** This project is MIT. Don't copy code, schemas, UI or text from AGPL/GPL projects (including Postiz) or from sources with unclear licenses. Reading other tools for ideas is fine; copying isn't.
- **Permissive dependencies only:** MIT, Apache-2.0, BSD or ISC. Mention any new dependency in your PR and say why it's needed.
- Be kind and constructive. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```bash
cp .env.example .env              # set ENCRYPTION_KEY: openssl rand -hex 32
pnpm install
pnpm db:up && pnpm db:push
pnpm dev                          # http://localhost:3300
pnpm worker                       # second terminal
```

You need Node 22+, pnpm 10 and Docker or Podman. Bluesky is the easiest channel to test with: no developer app is needed, just an [app password](https://bsky.app/settings/app-passwords). Use a test account.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Create a branch from `main`.
3. Follow the conventions in [CLAUDE.md](CLAUDE.md). They apply to humans too: server actions in `src/actions`, providers behind the shared interface, every org query scoped by `orgId`, no tokens sent to the browser, `createLogger` instead of `console`.
4. Run `pnpm typecheck` and `pnpm build`.
5. Open a pull request and fill in the template, including how you tested it.

## Adding a channel

Channels live in `src/lib/providers/`. See "Adding a channel" in the README for the checklist. Please include the platform's setup steps (app creation, callback URL, scopes) in the README.

## Commit messages

Use short, imperative subjects ("Add Mastodon provider", "Fix calendar time zone offset"), with details in the body if needed.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
