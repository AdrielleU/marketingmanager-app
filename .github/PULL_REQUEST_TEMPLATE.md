## What changed

<!-- What does this PR do, which area does it touch (web, worker, a provider, schema), and why? -->

## How I tested it

<!-- Numbered steps a reviewer can follow, e.g.:
1. Connect a Bluesky test account on /channels
2. Schedule a post 1 minute ahead
3. Wait for the worker; the post shows "Published" with a link -->

1.

## Checklist

- [ ] `pnpm typecheck` and `pnpm build` pass
- [ ] Org data is scoped by `orgId`; no tokens or secrets reach the browser or logs
- [ ] Schema changes (if any) are described above
- [ ] All code is original or from a permissively licensed source (no AGPL/GPL code)
