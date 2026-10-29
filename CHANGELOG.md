# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Structured logger (`src/lib/logger.ts`) used by the worker, publishing and OAuth
- Local-folder Postgres volume (`./data/postgres`) and `pnpm db:reset`
- Contributor docs, Claude Code project context, issue/PR templates and CI

## [0.1.0] - 2026-10-29

### Added
- Composer with per-channel limits, image uploads and preview
- Month calendar; schedule or publish now with per-channel retries (pg-boss worker)
- Bluesky, X and LinkedIn channels with encrypted credentials
- Workspaces, roles and invite links
- Analytics: likes, reposts, replies, X impressions, top posts
