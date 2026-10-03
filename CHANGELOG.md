# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-10-03

### Added
- `filter:rank-badges.level` hook for other plugins. It is called with `{ uids, users, levels }`; a listener sets
  `levels[uid]` to an integer (1 = lowest rank, clamped to the ladder) and that level replaces the post/reputation rank
  for that user. Group badges (administrators, moderators, ...) keep precedence. A listener that throws is logged and
  ignored, so the normal ranks keep working. Without listeners nothing changes.

## [1.2.0] - 2026-10-01

### Added
- Update notices on the ACP page: "Version X is available — what's new", linking to the release notes. The plugin fetches
  `https://updates.wirelab.pl/api/nodebb-plugin-rank-badges.json` at most once a day (in the background and when the
  ACP page is opened, from a cache kept in the database; an hour after a failed attempt) with a plain
  `GET`: no query string, no cookies, no data about the forum, `User-Agent: nodebb-plugin-rank-badges/<version>`,
  5 s timeout. Network errors are logged at verbose level only.
- "Check for updates" switch on the ACP page, on by default, saved on its own (settings hash
  `rank-badges-update-check`). When it is off, no request is made at all.
- `lib/update-check.js`, shared by the wirelab plugins; no new dependencies.

## [1.1.2] - 2026-10-01

### Security
- Use express-rate-limit for the request limits.
  Unchanged (60 ACP page loads and 300 `ladder` requests per minute per user, guests per IP
  address, IPv6 grouped by /56) and now come from `express-rate-limit` (new dependency), which
  replaces `lib/ratelimit.js`.

## [1.1.1] - 2026-10-01

### Security
- ACP preview and badges re-rendered in the viewer's language are built with DOM methods from the
  badge data that the ladder route now also returns (`view`: classes, data attributes, colour,
  image, icon, bar, plain-text name and label; `lib/badge-dom.js`). Classes, colours, icons and
  image URLs (forum paths or https only) are checked again in the browser; no HTML from the response
  is inserted any more. `html` stays in the response for other consumers.
- Request limits per user (guests: per IP address), counted in memory without new dependencies
  (`lib/ratelimit.js`): 60 loads of the ACP page and 300 requests to the ladder route per minute.
  Above the limit the answer is `429` with `Retry-After`.
- Findings reported by Snyk Code (CWE-79, CWE-770).

## [1.1.0] - 2026-09-27

### Changed
- **Zero thresholds:** level 1 is the starting rank; for every other rank a threshold of 0 means
  "no requirement" and never grants the rank by itself. In "reputation only" mode the default ladder
  no longer puts every new user (also with negative reputation) at level 2; in "posts only" mode a rank
  with only a reputation threshold is no longer free. A later rank whose counted thresholds are all 0
  cannot be reached, and the ACP says so.
- **Empty rank list** means no rank badges; the default ladder is used only until the settings are
  saved for the first time (previously an empty list silently brought back the six default ranks).
- **Group precedence:** administrators, then Global Moderators (including category moderators when
  enabled), then the other groups in list order. A category moderator who is also in another listed
  group now gets the Moderator badge.
- **Reputation disabled:** every mode counts posts only, so posts and profiles show the same rank.
- **Hidden groups:** their badges are not shown unless the new per-group "Show if hidden" option is on;
  even then the group name is left out of `data-group` and of `rankBadge.group`. Badges of groups that
  do not exist are not shown.
- Group badges with a colour pick black or white text from the colour's luminance.
- Level bars of ladders with more than 10 ranks show "level/total"; long names end with an ellipsis.
- The public ladder route returns 403 to viewers who cannot read any category, and now also lists
  group badges (without group names) and an `id` per badge.
- Requires Node.js 22 (as NodeBB 4.16 does). The redundant en-US language files were removed; en-US
  and other languages fall back to en-GB.

### Fixed
- Badges in the viewer's language after ajaxify navigation, on infinite scroll, for new replies
  pushed over the websocket and in API responses (previously the forum default language).
- Translation tokens typed in rank or group names were expanded in `aria-label` and `title`. Labels
  are now translated with a placeholder and the escaped name is inserted afterwards; `[` and `]` are
  encoded as `&lsqb;` / `&rsqb;`, which NodeBB's translator leaves alone.
- A badge rendered from the old settings could stay cached after the settings were saved (race
  between rendering and invalidation). Caches are written only when the settings did not change in the
  meantime, and rendered badges are keyed by the settings generation.
- Caches use least-recently-used eviction instead of being emptied when full, so many `?lang=` values
  on the public ladder route no longer flush the badges in use.
- ACP: saving shows a confirmation or the error; a failed load disables saving instead of letting the
  defaults overwrite the stored settings.
- ACP: thresholds such as `1e3` were saved as 1; only integers written with digits are accepted now,
  in the ACP and on the server.
- ACP: a rank without a name was saved and shown as an empty badge; it is refused now, and a rank
  without any name renders as "Rank N".
- ACP: names in languages removed from "Languages for rank names" stayed active but invisible; they are
  deleted on save.
- Upload with `relative_path`: only a leading prefix is removed (a file named `forum-logo.png` on a forum
  in `/forum` lost part of its name).
- Upload: the file type (PNG, JPG, WebP, GIF, SVG) and size (512 KB) are checked in the browser, and
  each file gets a unique name, so uploads no longer overwrite each other.
- An image that fails to load falls back to the level bar, the group icon or a generic icon, also when
  the level bar is turned off.
- Presets: every folder in `presets/` with a `preset.json` is offered, as documented (previously only
  `wirelab`); preset ids and image file names are validated.
- Zero-width and bidirectional control characters are removed from names.
- Inaccurate code comments and documentation (escaping, upload checks, search results).

### Added
- ACP translated into English and Polish, with validation errors and warnings (ranks out of order,
  equal or unreachable ranks, empty rank list, missing or hidden groups, reputation disabled).
- Server-side validation of the settings (`filter:settings.set`).
- `referrerpolicy="no-referrer"` on badge images.
- Tests for the rank rules, validation, group precedence, escaping with a translator, hidden groups,
  contrast, language choice and the LRU cache; the logic moved from `library.js` to `lib/`.

### Removed
- Unused translation key `ladder.title`.

## [1.0.0] - 2026-09-27

### Added
- Ranks from post count and/or reputation (modes: both, posts only, reputation only, either).
- Group badges for any group (defaults: Administrator, Moderator); first matching group wins over the rank.
  Optionally category moderators get the "Global Moderators" badge.
- Badge in posts (automatic via `custom_profile_info`, or `posts.user.rankBadge.html` in a theme) and on profiles.
- Optional image per rank/group (upload in the ACP or URL) with the level bar as fallback when the image fails to load.
- ACP page: rank table with per-language names, thresholds, image and colour; group badges; presets; preview of the saved badges.
- Public read-only endpoint `GET /api/v3/plugins/rank-badges/ladder`.
- Translations: en-GB, en-US, pl.
- CSS custom properties (`--rank-badge-*`) for theming; light and dark mode; `forced-colors` support.
- Unit tests (`node:test`) for thresholds, precedence, sanitising and rendering.
