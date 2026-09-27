# nodebb-plugin-rank-badges

Rank badges for **NodeBB 4.x**. Users earn ranks from their post count and/or reputation; members of
chosen groups (Administrator, Moderator or any other group) get a group badge instead. The badge
appears next to the author's name in posts and on the profile.

*Polska wersja: [README.pl.md](README.pl.md).*

- **Compatibility:** NodeBB `^4.0.0`, tested with NodeBB 4.16 and the Harmony theme; Node.js 22 or newer
  (the version NodeBB 4.16 requires).
- **Author:** [nairda](https://wirelab.pl)
- **Source and issues:** [github.com/nairdaweb/nodebb-plugin-rank-badges](https://github.com/nairdaweb/nodebb-plugin-rank-badges) ·
  [report a bug](https://github.com/nairdaweb/nodebb-plugin-rank-badges/issues)

![Badges in posts (light)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-light.png)
![Badges in posts (dark)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-dark.png)

## Features

- **Ranks** with thresholds for posts and reputation. Modes: posts and reputation (default), posts
  only, reputation only, either one. The user gets the highest rank in the list they qualify for.
- **Group badges** for any group; a group badge wins over the rank. Category moderators can share the
  "Global Moderators" badge.
- **Names per language** typed in the ACP, or translations from the plugin's language files
  (en-GB, pl; other languages fall back to en-GB) for the default ranks.
- **Viewer's language** everywhere: full page loads, ajaxify navigation, infinite scroll, new replies
  arriving over the websocket and API responses.
- **Level bar** (one segment per rank, or "3/12" for ladders longer than 10 ranks) and an optional
  **image** per rank or group. If an image fails to load, the level bar, the group icon or a generic
  icon is shown instead.
- **Accessible**: the visible name always carries the meaning (colour is only an accent),
  `aria-label` "Rank 3 of 6: Tinkerer", readable contrast in light and dark mode (group badges pick
  black or white text for their colour), `forced-colors` support.
- **Fast**: settings and rendered badges are cached in memory; group membership is checked once per
  group for all authors on a page (no extra queries per post).
- **Themeable**: every colour and size is a CSS custom property.
- **ACP in English and Polish**, with validation, warnings and a preview of the saved badges.

Default ladder (change everything in the ACP):

| Level | en-GB | pl | Posts | Reputation |
|---|---|---|---|---|
| 1 | New at the bench | Nowy na warsztacie | 0 | 0 |
| 2 | Apprentice | Praktykant | 5 | 0 |
| 3 | Tinkerer | Majsterkowicz | 25 | 5 |
| 4 | Technician | Technik | 75 | 20 |
| 5 | Engineer | Inżynier | 200 | 50 |
| 6 | Builder | Konstruktor | 500 | 150 |
| – | Administrator | Administrator | group `administrators` | |
| – | Moderator | Moderator | group `Global Moderators` | |

## Installation

From the NodeBB directory:

```sh
cd /path/to/nodebb
npm install nodebb-plugin-rank-badges
./nodebb activate nodebb-plugin-rank-badges
./nodebb build
./nodebb restart
```

Alternatively install and activate it in **ACP → Extend → Plugins**, then rebuild and restart.

Declared compatibility: NodeBB `^4.0.0` (`package.json` → `nbbpm.compatibility`); requires Node.js 22+.
NodeBB 3.x and older are not supported.

## Configuration

**ACP → Plugins → Rank badges**

![ACP](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-acp.png)

- *How ranks are earned* — the mode, see [How ranks are computed](#how-ranks-are-computed).
- *Languages for rank names* — which name columns to show (e.g. `en-GB, pl, de`). An empty name
  falls back to the plugin's translation (default ranks), to the first name given, and finally to
  "Rank N". Names in languages removed from this list are deleted when you save.
- *Ranks* — order matters (level = position). Thresholds are whole numbers written with digits
  (`1e3`, `2.5` or `-1` are refused). Every rank needs a name in at least one language (or a key from
  the language files, as the default ranks have). Image: upload (PNG, JPG, WebP, GIF or SVG up to
  512 KB, stored in `uploads/rank-badges/` under a unique name) or a URL starting with `/` or
  `https://`; square, at least 64 px. Colour: `#rrggbb`, used as an accent.
- *Group badges* — group name exactly as in ACP → Groups, name, Font Awesome icon (`fa-shield-halved`),
  image, colour, "Show if hidden" (see below).
- *Add badge to posts automatically* — uses the `custom_profile_info` slot that Harmony and Persona
  render next to the author name. Turn it off if your theme prints the badge itself.
- *Restore defaults* — puts the default ranks and group badges back into the tables (saved only when
  you click Save).
- *Presets* — see [Presets](#presets).

Saving shows a confirmation or the error. The settings are validated in the browser and again on the
server; invalid settings are not stored. If the ACP cannot read the stored settings, saving is
disabled so that the defaults shown in the form cannot overwrite them. Under the tables the ACP lists
warnings that do not block saving: ranks out of order, ranks with the same thresholds, ranks that can
never be reached, an empty rank list, groups that do not exist or are hidden.

### How ranks are computed

- Ranks are checked in list order and the user gets the **last** rank whose thresholds they meet, so
  keep the thresholds ascending (the ACP warns otherwise).
- **Level 1 is the starting rank.** If its counted thresholds are 0, every user has it, whatever their
  post count or reputation (also negative).
- For every other rank a threshold of **0 means "no requirement"** for that criterion and never grants
  the rank by itself. The rank is reached through its non-zero counted thresholds:
  - *posts and reputation*: all non-zero thresholds must be met;
  - *posts only* / *reputation only*: the non-zero posts / reputation threshold must be met;
  - *either one*: one non-zero threshold is enough.

  A rank after the first whose counted thresholds are all 0 can never be reached. Example: with the
  default ladder in *reputation only* mode, level 2 (5 posts, 0 reputation) is skipped and users go
  from level 1 straight to level 3 at 5 reputation.
- **Reputation disabled** (ACP → Settings → Reputation): every mode counts posts only, in posts and
  on profiles alike. The ACP shows a note about it.
- An empty rank list means no rank badges at all (group badges still work). The default ladder is used
  only until the settings are saved for the first time.

### Group badges

- **Precedence**, independent of the order of the user's memberships:
  1. `administrators`;
  2. `Global Moderators` — including category moderators when "Category moderators get the Global
     Moderators badge" is on (and a `Global Moderators` entry exists);
  3. every other group, in the order of the ACP list.
- **Hidden groups:** NodeBB does not show membership of hidden groups, and neither does this plugin: a
  badge for a hidden group is not shown unless its "Show if hidden" box is ticked (off by default).
  Even then the group name is kept out of the markup (`data-group`) and of the API data (`group`
  is empty), and a badge without a name of its own is called "Team". Private groups (join by
  approval) are shown normally: their membership is public in NodeBB, and `Global Moderators` is a
  private group.
- **Groups that do not exist** are skipped, and the ACP warns about them. A group badge is tied to a
  group **name**: if a configured group is deleted or renamed, or its name is misspelt, anyone allowed
  to create groups can create a group with that name and give its members the badge. Keep the
  "Create groups" privilege for trusted users, and fix or remove entries the ACP reports as missing.
- Existence and the hidden flag are re-read at least every minute and whenever the settings are saved.

## Presets

A preset is a folder `presets/<id>/` with a `preset.json` and image files; every such folder whose
name uses only `a-z`, `0-9` and `-` gets a "Load preset" button in the ACP. Loading fills the tables;
nothing changes until you click Save. Image entries must be plain file names in that folder with an
image extension (`rank-1.png`, no sub-folders or `..`); others are skipped. Format:
[presets/README.md](presets/README.md).

The folder lives inside the plugin, so a preset you add yourself is removed when the plugin is updated
or reinstalled: keep a copy. The npm package ships no preset; the `wirelab` preset is available only in
the GitHub repository (see Licence).

Preset files are served as static files from the forum's origin
(`/assets/plugins/nodebb-plugin-rank-badges/presets/…`), without the protective headers NodeBB adds to
user uploads. Badges always show them through `<img>`, where SVG scripts do not run, but a script in an
SVG opened directly would run on the forum domain: put only SVG files you trust in `presets/`.

## For theme authors

Post data (`filter:posts.getUserInfoForPosts`) gets `user.rankBadge`:

```js
{ level: 3, total: 6, tier: 2, special: false, key: 'rank-3', group: '', image: '', color: '', name: 'Tinkerer', html: '<span class="rank-badge …">…</span>' }
```

In a template: `{{{ if posts.user.rankBadge }}}{{posts.user.rankBadge.html}}{{{ end }}}`.

Encoding:
- `html` is ready-made markup, already translated. Everything typed in the ACP is stored as plain
  text and HTML-escaped when the badge is rendered, with `[` and `]` written as `&lsqb;` / `&rsqb;`, so
  names can never become NodeBB translation tokens, even if the markup is translated again.
- `name` is HTML (escaped the same way), in the viewer's language.
- `group` is the raw group name, empty for hidden groups — escape it before printing it yourself.
- Settings read directly with `meta.settings.get('rank-badges')` are **not** escaped.

When you print the badge yourself, skip `custom_profile_info` entries with `rankBadge: true` (or turn
off automatic insertion). Profiles get `rankBadge` in the account data; the plugin's client script puts
it in `[component="user/badges"]` (Harmony account header). Search results and the post lists on
profiles use NodeBB's post summaries, which carry no badge.

Badge attributes: `data-rb` (`r2` = third rank, `s0` = first group entry), `data-rb-lang` (language
of the markup), `data-level` / `data-total` (ranks), `data-group` (groups that are not hidden).

Styling — override the variables, not the selectors:

```css
:root {
  --rank-badge-height: 1.5rem;
  --rank-badge-radius: .45rem;
  --rank-badge-font-size: .78rem;
  --rank-badge-image-size: 1.25rem;
  --rank-badge-tier-1-bg: …; --rank-badge-tier-1-fg: …; --rank-badge-tier-1-led: …;  /* low levels */
  --rank-badge-tier-2-bg: …; --rank-badge-tier-2-fg: …; --rank-badge-tier-2-led: …;  /* middle */
  --rank-badge-tier-3-bg: …; --rank-badge-tier-3-fg: …; --rank-badge-tier-3-led: …;  /* top */
  --rank-badge-special-bg: …; --rank-badge-special-fg: …;                           /* groups */
  --rank-badge-led-off: …;
}
.rank-badge--special[data-group="Global Moderators"] { --_bg: …; --_fg: …; }
```

A group colour set as `var(--…)` cannot be evaluated on the server; its text stays white unless you
set `--rank-badge-accent-fg`.

### Read-only API

`GET /api/v3/plugins/rank-badges/ladder?lang=en-GB` returns the effective mode, the ranks (`id`,
`level`, thresholds, `name`, `html`) and the group badges that can appear on posts (`id`, `name`,
`html`, without the group name), in the requested language (default: the viewer's). It answers
`403` when the viewer cannot read any category, e.g. guests on a forum closed to guests. The
plugin's client script uses it to translate badges of posts that arrive over the websocket.

External images get `referrerpolicy="no-referrer"` and `loading="lazy"`, so the image host does not
learn which topic is being read; it still sees the viewer's IP address, so prefer uploaded images.

## Development

```sh
npm install
npm test       # node:test — thresholds, precedence, validation, escaping, rendering, language, cache
npm run lint
```

`lib/` holds the logic without NodeBB dependencies (`ranks.js`, `render.js`, `lang.js`, `lru.js`);
`library.js` wires it into NodeBB hooks.

## Licence

- **Code:** MIT © [nairda](https://wirelab.pl), see [LICENSE](LICENSE).
- **Artwork of the `wirelab` preset** (`presets/wirelab/*.png`, `*.svg`): © nairda (wirelab.pl), **not**
  covered by the MIT licence and not included in the npm package. All rights reserved: no licence is
  granted to use it on other sites (see `presets/wirelab/LICENSE.md`).
