# Presets

A preset is a folder `presets/<id>/` with `preset.json` and image files. Every folder whose name uses
only `a-z`, `0-9` and `-` and that contains a `preset.json` gets a "Load preset" button in the ACP
(Plugins → Rank badges). Loading fills the tables; nothing changes until you click Save, and the
settings are validated like any other input.

```json
{
  "ranks":   [{ "key": "rank-1", "names": { "en-GB": "…", "pl": "…" }, "minPosts": 0, "minReputation": 0, "image": "rank-1.png", "color": "" }],
  "special": [{ "group": "administrators", "key": "group-administrators", "names": {}, "icon": "", "image": "admin.png", "color": "", "showHidden": false }]
}
```

- `image` is a plain file name inside the preset folder with a `png`, `jpg`, `jpeg`, `webp`, `gif` or
  `svg` extension. Paths (`a/b.png`), `..` and URLs are skipped when the preset is loaded.
- `key` refers to a name in the plugin's language files (`rank-1` … `rank-6`,
  `group-administrators`, `group-moderators`); `names` overrides it per language.
- Thresholds are whole numbers.

Presets are served from `/assets/plugins/nodebb-plugin-rank-badges/presets/<id>/` as static files,
without the protective headers NodeBB adds to uploads. Badges show them through `<img>`, where SVG
scripts do not run; still, put only SVG files you trust here.

This folder is part of the plugin: a preset added here is removed when the plugin is updated or
reinstalled. The `wirelab` preset contains artwork owned by its author and is not part of the npm
package.
