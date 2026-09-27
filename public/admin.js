'use strict';

/*
 * ACP page script for nodebb-plugin-rank-badges (ACP → Plugins → Rank badges).
 * Registered in plugin.json under "modules" and loaded by NodeBB for
 * templates/admin/plugins/rank-badges.tpl.
 *
 * The rank and group tables are edited in memory (`ranks`, `special`) and serialised as JSON
 * into two hidden inputs, which NodeBB's settings module saves together with the switches.
 * The server validates everything again in lib/ranks.js normalize(); checks here are only for
 * convenience. ajaxify.data.defaults / defaultNames come from the route in library.js.
 */
define('admin/plugins/rank-badges', ['settings', 'alerts', 'uploader', 'translator'], function (Settings, alerts, uploader, translator) {
	const ACP = {};
	const HASH = 'rank-badges';
	const PLUGIN_ID = 'nodebb-plugin-rank-badges';

	/** Rank table being edited (array of rank entries, see lib/ranks.js). */
	let ranks = [];
	/** Group badge table being edited. */
	let special = [];

	/**
	 * Language codes for the name columns, from the "Languages for rank names" field.
	 * Same pattern as the server-side cleanNames().
	 *
	 * @returns {string[]}
	 */
	function langs() {
		const raw = $('#rb-langs').val() || 'en-GB, pl';
		const list = raw.split(',').map(s => s.trim()).filter(s => /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})?$/.test(s));
		return list.length ? list : ['en-GB', 'pl'];
	}

	/**
	 * @param {string} value JSON from a hidden input
	 * @param {Array} fallback returned when the value is empty or not a JSON array
	 * @returns {Array}
	 */
	function parse(value, fallback) {
		try {
			const v = JSON.parse(value);
			return Array.isArray(v) ? v : fallback;
		} catch {
			return fallback;
		}
	}

	/**
	 * Escapes text for element content and double-quoted attributes. Every stored value that
	 * goes into the table markup below passes through here (settings are not trusted even in
	 * the ACP: they could have been written by an older version or directly to the database).
	 *
	 * @param {*} str
	 * @returns {string}
	 */
	function esc(str) {
		return $('<div>').text(str == null ? '' : String(str)).html().replace(/"/g, '&quot;');
	}

	/**
	 * One text input per language. The placeholder shows what an empty field falls back to:
	 * the translation from the language files for entries with a key, otherwise the language.
	 *
	 * @param {object} entry rank or group entry
	 * @param {'ranks'|'special'} list table the entry belongs to
	 * @param {number} i index in that table
	 * @returns {string} HTML
	 */
	function nameInputs(entry, list, i) {
		return langs().map(function (lang) {
			const val = (entry.names && entry.names[lang]) || '';
			const defaults = (ajaxify.data.defaultNames || {})[entry.key] || {};
			const ph = entry.key ? (defaults[lang] || defaults['en-GB'] || entry.key) : lang;
			return '<div class="input-group input-group-sm mb-1"><span class="input-group-text" style="min-width:4.5rem">' + esc(lang) + '</span>' +
				'<input type="text" class="form-control" maxlength="60" data-list="' + list + '" data-i="' + i + '" data-field="name" data-lang="' + esc(lang) + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '"></div>';
		}).join('');
	}

	/**
	 * Thumbnail, URL input and upload button. Site-relative paths are stored without
	 * relative_path and get it only for the preview.
	 *
	 * @param {object} entry
	 * @param {'ranks'|'special'} list
	 * @param {number} i
	 * @returns {string} HTML
	 */
	function imageCell(entry, list, i) {
		const src = entry.image ? (entry.image.startsWith('/') && !entry.image.startsWith(config.relative_path + '/') ? config.relative_path + entry.image : entry.image) : '';
		return '<div class="d-flex align-items-center gap-2" style="min-width:16rem">' +
			(src ? '<img src="' + esc(src) + '" alt="" width="32" height="32" style="object-fit:contain">' : '<span class="text-muted small" style="width:32px">—</span>') +
			'<input type="text" class="form-control form-control-sm" data-list="' + list + '" data-i="' + i + '" data-field="image" value="' + esc(entry.image || '') + '" placeholder="/assets/uploads/… or https://…">' +
			'<button type="button" class="btn btn-sm btn-light" data-rb-action="upload" data-list="' + list + '" data-i="' + i + '" title="Upload"><i class="fa fa-upload"></i></button></div>';
	}

	/**
	 * @param {object} entry
	 * @param {'ranks'|'special'} list
	 * @param {number} i
	 * @returns {string} HTML of the colour input
	 */
	function colorCell(entry, list, i) {
		return '<input type="text" class="form-control form-control-sm" style="width:7rem" maxlength="7" data-list="' + list + '" data-i="' + i + '" data-field="color" value="' + esc(entry.color || '') + '" placeholder="#1e4fd8">';
	}

	/**
	 * Up, down and remove buttons; handled by onAction() through data-rb-action.
	 *
	 * @param {'ranks'|'special'} list
	 * @param {number} i
	 * @param {number} len length of the table
	 * @returns {string} HTML
	 */
	function moveButtons(list, i, len) {
		return '<div class="btn-group btn-group-sm">' +
			'<button type="button" class="btn btn-light" data-rb-action="up" data-list="' + list + '" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="Up"><i class="fa fa-arrow-up"></i></button>' +
			'<button type="button" class="btn btn-light" data-rb-action="down" data-list="' + list + '" data-i="' + i + '"' + (i === len - 1 ? ' disabled' : '') + ' title="Down"><i class="fa fa-arrow-down"></i></button>' +
			'<button type="button" class="btn btn-light text-danger" data-rb-action="remove" data-list="' + list + '" data-i="' + i + '" title="Remove"><i class="fa fa-trash"></i></button></div>';
	}

	/**
	 * Re-renders both tables from `ranks` and `special`. Called after every structural change
	 * (add, remove, move, preset, upload, language list); plain typing only updates the model.
	 *
	 * @returns {void}
	 */
	function renderTables() {
		$('#rb-ranks tbody').html(ranks.map(function (r, i) {
			return '<tr><td class="fw-bold">' + (i + 1) + '</td>' +
				'<td style="min-width:16rem">' + nameInputs(r, 'ranks', i) + '</td>' +
				'<td><input type="number" min="0" class="form-control form-control-sm" style="width:6rem" data-list="ranks" data-i="' + i + '" data-field="minPosts" value="' + (parseInt(r.minPosts, 10) || 0) + '"></td>' +
				'<td><input type="number" min="0" class="form-control form-control-sm" style="width:6rem" data-list="ranks" data-i="' + i + '" data-field="minReputation" value="' + (parseInt(r.minReputation, 10) || 0) + '"></td>' +
				'<td>' + imageCell(r, 'ranks', i) + '</td><td>' + colorCell(r, 'ranks', i) + '</td>' +
				'<td>' + moveButtons('ranks', i, ranks.length) + '</td></tr>';
		}).join(''));

		$('#rb-special tbody').html(special.map(function (s, i) {
			return '<tr><td><input type="text" class="form-control form-control-sm" style="min-width:10rem" data-list="special" data-i="' + i + '" data-field="group" value="' + esc(s.group) + '" placeholder="administrators"></td>' +
				'<td style="min-width:16rem">' + nameInputs(s, 'special', i) + '</td>' +
				'<td><input type="text" class="form-control form-control-sm" style="width:9rem" data-list="special" data-i="' + i + '" data-field="icon" value="' + esc(s.icon || '') + '" placeholder="fa-shield-halved"></td>' +
				'<td>' + imageCell(s, 'special', i) + '</td><td>' + colorCell(s, 'special', i) + '</td>' +
				'<td>' + moveButtons('special', i, special.length) + '</td></tr>';
		}).join(''));
	}

	/**
	 * @param {string} name value of a data-list attribute
	 * @returns {Array} the matching table
	 */
	function listFor(name) {
		return name === 'special' ? special : ranks;
	}

	/**
	 * Writes both tables into the hidden inputs that the settings module saves.
	 *
	 * @returns {void}
	 */
	function syncHidden() {
		$('#rb-ranks-json').val(JSON.stringify(ranks));
		$('#rb-special-json').val(JSON.stringify(special));
	}

	/**
	 * Delegated input/change handler for table fields: updates the model and the hidden
	 * inputs without re-rendering, so the focused field keeps its cursor.
	 *
	 * @this {HTMLElement} the edited input
	 * @returns {void}
	 */
	function onInput() {
		const el = $(this);
		const list = listFor(el.attr('data-list'));
		const entry = list[parseInt(el.attr('data-i'), 10)];
		if (!entry) return;
		const field = el.attr('data-field');
		const val = el.val();
		if (field === 'name') {
			entry.names = entry.names || {};
			if (val.trim()) entry.names[el.attr('data-lang')] = val.trim();
			else delete entry.names[el.attr('data-lang')];
		} else if (field === 'minPosts' || field === 'minReputation') {
			entry[field] = Math.max(0, parseInt(val, 10) || 0);
		} else {
			entry[field] = val.trim();
		}
		syncHidden();
	}

	/**
	 * Delegated click handler for every [data-rb-action] button.
	 *
	 * @this {HTMLElement} the clicked button
	 * @returns {void}
	 */
	function onAction() {
		const btn = $(this);
		const action = btn.attr('data-rb-action');
		const name = btn.attr('data-list');
		const list = listFor(name);
		const i = parseInt(btn.attr('data-i'), 10);

		if (action === 'add-rank') {
			// Suggest thresholds above the last rank: double its posts (10 if it had none).
			const last = ranks[ranks.length - 1] || { minPosts: 0, minReputation: 0 };
			ranks.push({ names: {}, minPosts: (parseInt(last.minPosts, 10) || 0) * 2 || 10, minReputation: parseInt(last.minReputation, 10) || 0, image: '', color: '' });
		} else if (action === 'add-special') {
			special.push({ group: '', names: {}, icon: 'fa-shield-halved', image: '', color: '' });
		} else if (action === 'remove') {
			list.splice(i, 1);
		} else if (action === 'up' && i > 0) {
			list.splice(i - 1, 0, list.splice(i, 1)[0]);
		} else if (action === 'down' && i < list.length - 1) {
			list.splice(i + 1, 0, list.splice(i, 1)[0]);
		} else if (action === 'defaults') {
			const d = ajaxify.data.defaults || {};
			ranks = JSON.parse(JSON.stringify(d.ranks || []));
			special = JSON.parse(JSON.stringify(d.special || []));
			alerts.info('Defaults restored. Click Save to apply.');
		} else if (action === 'preset') {
			loadPreset(btn.attr('data-preset'));
			return;
		} else if (action === 'upload') {
			// Core ACP upload route (admin only). The folder is created by library.js init;
			// NodeBB checks the file type against the forum's allowed extensions.
			uploader.show({
				title: 'Upload badge image',
				route: config.relative_path + '/api/admin/upload/file',
				params: { folder: 'rank-badges' },
				accept: 'image/*',
			}, function (url) {
				// Store the path without relative_path, so the setting survives a move of the
				// forum to another sub-folder; lib/render.js adds the prefix on output.
				list[i].image = url.replace(config.relative_path, '');
				syncHidden();
				renderTables();
			});
			return;
		}
		syncHidden();
		renderTables();
	}

	/**
	 * Fills both tables from presets/<id>/preset.json, served by NodeBB through the "staticDirs"
	 * entry in plugin.json. `id` comes from the button rendered by the server (a fixed list in
	 * library.js). Image file names are turned into URLs under the preset directory. Nothing is
	 * saved until the admin clicks Save.
	 *
	 * @param {string} id preset directory name
	 * @returns {void}
	 */
	function loadPreset(id) {
		const base = config.relative_path + '/assets/plugins/' + PLUGIN_ID + '/presets/' + encodeURIComponent(id) + '/';
		$.getJSON(base + 'preset.json?' + config['cache-buster']).then(function (preset) {
			const img = function (file) { return file ? '/assets/plugins/' + PLUGIN_ID + '/presets/' + id + '/' + file : ''; };
			ranks = (preset.ranks || []).map(function (r) { return Object.assign({}, r, { image: img(r.image) }); });
			special = (preset.special || []).map(function (s) { return Object.assign({}, s, { image: img(s.image) }); });
			syncHidden();
			renderTables();
			alerts.info('Preset "' + id + '" loaded. Click Save to apply.');
		}, function () {
			alerts.error('Preset not found: ' + id);
		});
	}

	/**
	 * Shows the saved ladder, rendered by the server exactly as on the forum, using the public
	 * ladder route. The HTML is built and escaped server-side (lib/render.js). It reflects the
	 * saved settings, so it is refreshed after each save.
	 *
	 * @returns {void}
	 */
	function preview() {
		$.getJSON(config.relative_path + '/api/v3/plugins/rank-badges/ladder?lang=' + encodeURIComponent(config.acpLang || 'en-GB')).then(function (res) {
			const html = (res.response.ladder || []).map(function (r) { return r.html; }).join('');
			translator.translate(html, config.acpLang, function (translated) {
				$('#rb-preview').html(translated);
			});
		});
	}

	/**
	 * Page entry point, called by NodeBB when the ACP page is loaded.
	 *
	 * @returns {void}
	 */
	ACP.init = function () {
		const form = $('.rank-badges-settings');
		Settings.load(HASH, form, function () {
			const d = ajaxify.data.defaults || {};
			ranks = parse($('#rb-ranks-json').val(), JSON.parse(JSON.stringify(d.ranks || [])));
			special = parse($('#rb-special-json').val(), JSON.parse(JSON.stringify(d.special || [])));
			// A fresh install has no stored values at all; the empty tables are the signal.
			['showBar', 'showImages', 'autoInject', 'showOnProfile', 'categoryModerators'].forEach(function (k) {
				const el = $('#rb-' + k);
				// Unset switches default to on (as on the server).
				if (!$('#rb-ranks-json').val() && !$('#rb-special-json').val()) el.prop('checked', true);
			});
			syncHidden();
			renderTables();
			preview();
		});

		form.on('input change', '[data-list]', onInput);
		form.on('click', '[data-rb-action]', onAction);
		$('#rb-langs').on('change', renderTables);

		$('#save').on('click', function () {
			// A group badge without a group would be dropped by the server anyway; say so now.
			const bad = special.some(function (s) { return !String(s.group || '').trim(); });
			if (bad) {
				alerts.error('Every group badge needs a group name.');
				return;
			}
			syncHidden();
			Settings.save(HASH, form, function () {
				preview();
			});
		});
	};

	return ACP;
});
