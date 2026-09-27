# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-27

### Added
- Ranks from post count and/or reputation (modes: both, posts only, reputation only, either).
- Group badges for any group (defaults: Administrator, Moderator); first matching group wins over the rank.
  Optionally category moderators get the "Global Moderators" badge.
- Badge in posts (automatic via `custom_profile_info`, or `posts.user.rankBadge.html` in a theme) and on profiles.
- Optional image per rank/group (upload in the ACP or URL) with the level bar as fallback when the image fails to load.
- ACP page: rank table with per-language names, thresholds, image and colour; group badges; presets; live preview.
- Public read-only endpoint `GET /api/v3/plugins/rank-badges/ladder`.
- Translations: en-GB, en-US, pl.
- CSS custom properties (`--rank-badge-*`) for theming; light and dark mode; `forced-colors` support.
- Unit tests (`node:test`) for thresholds, precedence, sanitising and rendering.
