# Presets

A preset is a directory with `preset.json` and image files. In the ACP (Plugins → Rank badges)
"Load preset" fills the tables from it; nothing changes until you click Save.

```json
{
  "ranks":   [{ "key": "rank-1", "names": { "en-GB": "…", "pl": "…" }, "minPosts": 0, "minReputation": 0, "image": "rank-1.png", "color": "" }],
  "special": [{ "group": "administrators", "key": "group-administrators", "names": {}, "icon": "", "image": "admin.png", "color": "" }]
}
```

`image` is a file name inside the preset directory. Presets are served from
`/assets/plugins/nodebb-plugin-rank-badges/presets/<name>/`.

The `wirelab` preset contains artwork owned by its author and is not part of the npm package.
