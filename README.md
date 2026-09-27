# nodebb-plugin-rank-badges

Rank badges for **NodeBB 4.x**. Users earn ranks from their post count and/or reputation; members of
chosen groups (Administrator, Moderator or any other group) get a group badge instead. The badge
appears next to the author's name in posts and on the profile.

*Polska wersja: [README.pl.md](README.pl.md).*

- **Compatibility:** NodeBB `^4.0.0` (4.x), Node.js 18 or newer.
- **Author:** [nairda](https://wirelab.pl)
- **Source and issues:** [github.com/nairdaweb/nodebb-plugin-rank-badges](https://github.com/nairdaweb/nodebb-plugin-rank-badges) ·
  [report a bug](https://github.com/nairdaweb/nodebb-plugin-rank-badges/issues)

![Badges in posts (light)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-light.png)
![Badges in posts (dark)](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-posts-dark.png)

## Features

- **Ranks** with thresholds for posts and reputation. Modes: both thresholds (default), posts only,
  reputation only, either one. The user gets the highest rank in the list they qualify for.
- **Group badges** for any group; the first matching group in the list wins over the rank.
  Category moderators can share the "Global Moderators" badge.
- **Names per language** typed in the ACP, or translations from the plugin's language files
  (en-GB, en-US, pl) for the default ranks.
- **Level bar** (one segment per rank) and optional **image** per rank. If an image fails to load,
  the bar is shown instead.
- **Accessible**: the visible name always carries the meaning (colour is only an accent),
  `aria-label` "Rank 3 of 6: Tinkerer", readable contrast in light and dark mode, `forced-colors` support.
- **Fast**: settings and rendered badges are cached in memory; group membership is checked once per
  group for all authors on a page (no extra queries per post).
- **Themeable**: every colour and size is a CSS custom property.

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

Compatible with NodeBB `^4.0.0` (declared in `package.json` → `nbbpm.compatibility`); requires Node.js 18+.
NodeBB 3.x and older are not supported.

## Configuration

**ACP → Plugins → Rank badges**

![ACP](https://raw.githubusercontent.com/nairdaweb/nodebb-plugin-rank-badges/main/docs/screenshot-acp.png)

- *How ranks are earned* — the mode described above.
- *Languages for rank names* — which name columns to show (e.g. `en-GB, pl, de`). An empty name
  falls back to the plugin's translation (default ranks) or to the first name given.
- *Ranks* — order matters (level = position). Image: upload (stored in `uploads/rank-badges/`) or a URL
  starting with `/` or `https://`; square, at least 64 px. Colour: `#rrggbb`, used as an accent.
- *Group badges* — group name exactly as in ACP → Groups, name, Font Awesome icon (`fa-shield-halved`),
  image, colour.
- *Add badge to posts automatically* — uses the `custom_profile_info` slot that Harmony and Persona
  render next to the author name. Turn it off if your theme prints the badge itself.
- *Presets* — a directory in `presets/` with `preset.json` and images (see [presets/README.md](presets/README.md)).
  "Load preset" fills the tables; nothing changes until you click Save. The npm package ships no preset
  artwork; the `wirelab` preset is available only in the GitHub repository (see Licence).

## For theme authors

Post data (`filter:posts.getUserInfoForPosts`) gets `user.rankBadge`:

```js
{ level: 3, total: 6, tier: 2, special: false, key: 'rank-3', group: '', image: '', color: '', name: 'Tinkerer', html: '<span class="rank-badge …">…</span>' }
```

In a template: `{{{ if posts.user.rankBadge }}}{{posts.user.rankBadge.html}}{{{ end }}}`.

Encoding: `html` is ready-made, escaped markup. `name` is HTML-safe (names typed in the ACP are escaped when saved). `group` is the raw group name — escape it before printing it yourself.
When you print it yourself, skip `custom_profile_info` entries with `rankBadge: true` (or turn off
automatic insertion). Profiles get `rankBadge` in the account data; the plugin's client script puts it in
`[component="user/badges"]` (Harmony account header).

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

Read-only API for a "ranks" page: `GET /api/v3/plugins/rank-badges/ladder?lang=en-GB`.

## Development

```sh
npm install
npm test       # node:test — thresholds, precedence, sanitising, rendering
npm run lint
```

## Licence

- **Code:** MIT © [nairda](https://wirelab.pl), see [LICENSE](LICENSE).
- **Artwork of the `wirelab` preset** (`presets/wirelab/*.png`, `*.svg`): © nairda (wirelab.pl), **not**
  covered by the MIT licence and not included in the npm package. Terms:
  [presets/wirelab/LICENSE.md](https://github.com/nairdaweb/nodebb-plugin-rank-badges/blob/main/presets/wirelab/LICENSE.md).
