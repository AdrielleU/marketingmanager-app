# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately via GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, steps to reproduce, and the impact you expect. You'll get an acknowledgement within a few days, and a fix will be prioritized based on severity.

## Scope

This app stores OAuth tokens and app passwords for social accounts (encrypted with `ENCRYPTION_KEY`), so we especially want to hear about:

- Ways to read or use another workspace's channels, posts or media
- Token or credential exposure (in responses, logs or the browser)
- Authentication or session weaknesses

## Self-hosting notes

- Generate a unique `ENCRYPTION_KEY` (`openssl rand -hex 32`) and keep it secret. Losing it means reconnecting every channel.
- Serve the app over HTTPS in production (session cookies are marked `Secure` when `NODE_ENV=production`).
- This is early software: there's no login rate limiting or 2FA yet. Put it behind a VPN or an auth proxy if it faces the internet.
