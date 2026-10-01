'use strict';

/*
 * ACP page script for nodebb-plugin-rank-badges (ACP → Plugins → Rank badges).
 * Registered in plugin.json under "modules" and loaded by NodeBB for
 * templates/admin/plugins/rank-badges.tpl. Strings are translation keys of the
 * "admin/plugins/rank-badges" namespace (languages/<lang>/admin/plugins/rank-badges.json).
 *
 * The rank and group tables are edited in memory (`ranks`, `special`) and serialised as JSON
 * into two hidden inputs, which NodeBB's settings module saves together with the switches.
 * Validation and ladder warnings come from lib/ranks.js, the same module the server uses
 * (exposed to the browser as "rank-badges/ranks" through plugin.json); the server checks
 * everything again when the settings are saved (library.js onSettingsSave).
 * ajaxify.data.defaults, defaultNames, groupList and reputationDisabled come from the route in
 * library.js.
 */
define('admin/plugins/rank-badges', ['settings', 'alerts', 'translator', 'rank-badges/ranks', 'rank-badges/badge-dom'], function (Settings, alerts, translator, R, BadgeDom) {
	const ACP = {};
	const HASH = 'rank-badges';
	const PLUGIN_ID = 'nodebb-plugin-rank-badges';
	const NS = 'admin/plugins/rank-badges';
	/** Largest badge image accepted by the upload button, in KB (also shown in the help text). */
	const MAX_UPLOAD_KB = 512;
	/** Image types accepted by the upload button: extension → MIME type. */
	const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
	/** Placeholder replaced by an escaped group name after translation (see message()). */
	const ARG = '@@rb-arg@@';

	/** Rank table being edited (array of rank entries, see lib/ranks.js). */
	let ranks = [];
	/** Group badge table being edited. */
	let special = [];
	/** False until the stored settings were read; saving is refused before that. */
	let loaded = false;

	/**
	 * Translation token in this plugin's ACP namespace. Arguments must be numbers or
	 * placeholders; text typed by the admin is inserted with message() instead.
	 *
	 * @param {string} key
	 * @param {...(string|number)} args
	 * @returns {string} token such as [[admin/plugins/rank-badges:saved]]
	 */
	function tx(key) {
		return translator.compile.apply(null, [NS + ':' + key].concat(Array.prototype.slice.call(arguments, 1)));
	}

	/**
	 * Escapes text for element content and double-quoted attributes. Every stored value that
	 * goes into the table markup below passes through here (settings are not trusted even in
	 * the ACP: they could have been written by an older version or directly to the database).
	 * Square brackets are encoded too, so that no text can become a translation token.
	 *
	 * @param {*} str
	 * @returns {string}
	 */
	function esc(str) {
		return $('<div>').text(str == null ? '' : String(str)).html()
			.replace(/"/g, '&quot;').replace(/\[/g, '&lsqb;').replace(/\]/g, '&rsqb;');
	}

	/**
	 * Translated message with an optional admin-typed argument, which is escaped and inserted
	 * after translation, so it is never read as a translation token.
	 *
	 * @param {string} key translation key
	 * @param {string} [arg] plain text
	 * @returns {Promise<string>} HTML
	 */
	function message(key, arg) {
		return translator.translate(arg === undefined ? tx(key) : tx(key, ARG)).then(function (html) {
			return arg === undefined ? html : html.split(ARG).join(esc(arg));
		});
	}

	/**
	 * Language codes for the name columns, from the "Languages for rank names" field.
	 *
	 * @returns {string[]}
	 */
	function langs() {
		const list = R.parseLangList($('#rb-langs').val());
		return list.length ? list : R.DEFAULT_NAME_LANGS.slice();
	}

	/**
	 * @param {string} value JSON from a hidden input
	 * @param {Array} fallback returned when the value is empty (never saved) or not a JSON array
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
	 * @param {Array} list
	 * @returns {Array} deep copy
	 */
	function clone(list) {
		return JSON.parse(JSON.stringify(list || []));
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
	 * Site-relative image path as stored (without relative_path), from a URL that may carry the
	 * prefix. Only a leading "<relative_path>/" is removed, never a match inside the file name.
	 *
	 * @param {string} url
	 * @returns {string}
	 */
	function stripRelativePath(url) {
		const rp = config.relative_path || '';
		return rp && url.indexOf(rp + '/') === 0 ? url.slice(rp.length) : url;
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
		const rp = config.relative_path || '';
		const img = R.cleanImage(entry.image);
		const src = img && img.charAt(0) === '/' && (!rp || img.indexOf(rp + '/') !== 0) ? rp + img : img;
		return '<div class="d-flex align-items-center gap-2" style="min-width:16rem">' +
			(src ? '<img src="' + esc(src) + '" alt="" width="32" height="32" style="object-fit:contain" referrerpolicy="no-referrer">' : '<span class="text-muted small" style="width:32px">—</span>') +
			'<input type="text" class="form-control form-control-sm" data-list="' + list + '" data-i="' + i + '" data-field="image" value="' + esc(entry.image || '') + '" placeholder="/assets/uploads/… or https://…">' +
			'<button type="button" class="btn btn-sm btn-light" data-rb-action="upload" data-list="' + list + '" data-i="' + i + '" title="' + tx('upload') + '"><i class="fa fa-upload"></i></button></div>';
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
	 * Threshold input: plain text with a numeric keyboard, so that the exact text reaches the
	 * validation ("1e3" or "2.5" are reported, not silently converted).
	 *
	 * @param {object} entry rank
	 * @param {number} i
	 * @param {'minPosts'|'minReputation'} field
	 * @returns {string} HTML
	 */
	function thresholdCell(entry, i, field) {
		const value = entry[field] === undefined || entry[field] === null ? '0' : String(entry[field]);
		const invalid = R.parseThreshold(entry[field]) === null ? ' is-invalid' : '';
		return '<input type="text" inputmode="numeric" autocomplete="off" class="form-control form-control-sm' + invalid + '" style="width:6rem" data-list="ranks" data-i="' + i + '" data-field="' + field + '" value="' + esc(value) + '">';
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
			'<button type="button" class="btn btn-light" data-rb-action="up" data-list="' + list + '" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="' + tx('up') + '"><i class="fa fa-arrow-up"></i></button>' +
			'<button type="button" class="btn btn-light" data-rb-action="down" data-list="' + list + '" data-i="' + i + '"' + (i === len - 1 ? ' disabled' : '') + ' title="' + tx('down') + '"><i class="fa fa-arrow-down"></i></button>' +
			'<button type="button" class="btn btn-light text-danger" data-rb-action="remove" data-list="' + list + '" data-i="' + i + '" title="' + tx('remove') + '"><i class="fa fa-trash"></i></button></div>';
	}

	/**
	 * Re-renders both tables from `ranks` and `special`. Called after every structural change
	 * (add, remove, move, preset, upload, language list); plain typing only updates the model.
	 * The markup contains translation tokens (button titles), hence the translate step.
	 *
	 * @returns {void}
	 */
	function renderTables() {
		const rankRows = ranks.map(function (r, i) {
			return '<tr><td class="fw-bold">' + (i + 1) + '</td>' +
				'<td style="min-width:16rem">' + nameInputs(r, 'ranks', i) + '</td>' +
				'<td>' + thresholdCell(r, i, 'minPosts') + '</td>' +
				'<td>' + thresholdCell(r, i, 'minReputation') + '</td>' +
				'<td>' + imageCell(r, 'ranks', i) + '</td><td>' + colorCell(r, 'ranks', i) + '</td>' +
				'<td>' + moveButtons('ranks', i, ranks.length) + '</td></tr>';
		}).join('');

		const specialRows = special.map(function (s, i) {
			return '<tr><td><input type="text" class="form-control form-control-sm" style="min-width:10rem" data-list="special" data-i="' + i + '" data-field="group" value="' + esc(s.group) + '" placeholder="administrators"></td>' +
				'<td style="min-width:16rem">' + nameInputs(s, 'special', i) + '</td>' +
				'<td><input type="text" class="form-control form-control-sm" style="width:9rem" data-list="special" data-i="' + i + '" data-field="icon" value="' + esc(s.icon || '') + '" placeholder="fa-shield-halved"></td>' +
				'<td>' + imageCell(s, 'special', i) + '</td><td>' + colorCell(s, 'special', i) + '</td>' +
				'<td class="text-center"><input type="checkbox" class="form-check-input" data-list="special" data-i="' + i + '" data-field="showHidden"' + (s.showHidden === true || s.showHidden === 'on' ? ' checked' : '') + '></td>' +
				'<td>' + moveButtons('special', i, special.length) + '</td></tr>';
		}).join('');

		translator.translate(rankRows, function (html) { $('#rb-ranks tbody').html(html); });
		translator.translate(specialRows, function (html) { $('#rb-special tbody').html(html); });
		renderChecks();
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
	 * Same checks as the server (lib/ranks.js validateSettings) on the tables being edited.
	 *
	 * @returns {{errors: string[], settings: object}}
	 */
	function validate() {
		return R.validateSettings({ nameLangs: $('#rb-langs').val() || '', ranks: JSON.stringify(ranks), special: JSON.stringify(special) });
	}

	/**
	 * Non-blocking remarks: ladder order and reachability, empty ladder, missing or hidden groups.
	 *
	 * @returns {Array<Promise<string>>} translated HTML messages
	 */
	function warnings() {
		const out = [];
		const mode = R.effectiveMode($('#rb-mode').val(), !!ajaxify.data.reputationDisabled);
		if (!ranks.length) out.push(message('warn.no-ranks'));
		R.ladderWarnings(ranks, mode).forEach(function (w) {
			out.push(translator.translate(tx('warn.' + w.code, w.level)));
		});
		const known = {};
		(ajaxify.data.groupList || []).forEach(function (g) { known[g.name] = g; });
		special.forEach(function (s) {
			const name = String(s.group || '').trim();
			if (!name) return;
			if (!known[name]) out.push(message('warn.group-missing', name));
			else if (known[name].hidden && !(s.showHidden === true || s.showHidden === 'on')) out.push(message('warn.group-hidden', name));
		});
		return out;
	}

	/**
	 * Shows validation errors (red) and warnings (yellow) under the tables; hidden when there
	 * is nothing to report. Also marks invalid threshold fields.
	 *
	 * @returns {void}
	 */
	function renderChecks() {
		$('[data-field="minPosts"], [data-field="minReputation"]').each(function () {
			$(this).toggleClass('is-invalid', R.parseThreshold($(this).val()) === null);
		});
		const errors = validate().errors.map(function (token) { return translator.translate(token); });
		Promise.all([Promise.all(errors), Promise.all(warnings())]).then(function (res) {
			const items = res[0].map(function (html) { return '<li class="alert alert-danger py-2 mb-0">' + html + '</li>'; })
				.concat(res[1].map(function (html) { return '<li class="alert alert-warning py-2 mb-0">' + html + '</li>'; }));
			$('#rb-checks ul').html(items.join(''));
			$('#rb-checks').toggleClass('d-none', !items.length);
		});
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
		if (field === 'name') {
			const val = el.val().trim();
			entry.names = entry.names || {};
			if (val) entry.names[el.attr('data-lang')] = val;
			else delete entry.names[el.attr('data-lang')];
		} else if (field === 'showHidden') {
			entry.showHidden = el.is(':checked');
		} else if (field === 'minPosts' || field === 'minReputation') {
			// Kept as typed; converted in syncHidden only when valid (see validate()).
			const n = R.parseThreshold(el.val());
			entry[field] = n === null ? el.val() : n;
		} else {
			entry[field] = el.val().trim();
		}
		syncHidden();
		renderChecks();
	}

	/**
	 * Lets the admin pick an image, checks its type and size, and uploads it under a unique
	 * name (so that two badges called "badge.png" do not overwrite each other) through the core
	 * ACP upload route, which is restricted to administrators but does not check the file type
	 * itself.
	 *
	 * @param {Array} list table of the entry
	 * @param {number} i index of the entry
	 * @returns {void}
	 */
	function upload(list, i) {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = Object.keys(IMAGE_TYPES).map(function (ext) { return '.' + ext; }).join(',');
		input.addEventListener('change', function () {
			const file = input.files && input.files[0];
			if (!file) return;
			const match = /\.([a-z0-9]+)$/i.exec(file.name);
			const ext = match ? match[1].toLowerCase() : '';
			if (!IMAGE_TYPES[ext] || (file.type && file.type !== IMAGE_TYPES[ext])) {
				alerts.error(tx('upload-type'));
				return;
			}
			if (file.size > MAX_UPLOAD_KB * 1024) {
				alerts.error(tx('upload-size', MAX_UPLOAD_KB));
				return;
			}
			const name = 'badge-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + (ext === 'jpeg' ? 'jpg' : ext);
			const body = new FormData();
			body.append('files[]', file, name);
			body.append('params', JSON.stringify({ folder: 'rank-badges' }));
			fetch(config.relative_path + '/api/admin/upload/file', {
				method: 'POST',
				body: body,
				credentials: 'same-origin',
				headers: { 'x-csrf-token': config.csrf_token },
			}).then(function (res) {
				return res.json().catch(function () { return {}; }).then(function (data) {
					if (!res.ok || !Array.isArray(data) || !data[0] || !data[0].url) {
						throw new Error((data && (data.error || (data.status && data.status.message))) || res.status + ' ' + res.statusText);
					}
					return data[0].url;
				});
			}).then(function (url) {
				// Stored without relative_path, so the setting survives a move of the forum to
				// another sub-folder; lib/render.js adds the prefix on output.
				list[i].image = stripRelativePath(url);
				syncHidden();
				renderTables();
				alerts.success(tx('uploaded'));
			}).catch(function (err) {
				translator.translate(String(err.message || err), function (reason) {
					message('upload-failed', $('<div>').html(reason).text()).then(function (html) { alerts.error(html); });
				});
			});
		});
		input.click();
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
		const list = listFor(btn.attr('data-list'));
		const i = parseInt(btn.attr('data-i'), 10);

		if (action === 'add-rank') {
			// Suggest thresholds above the last rank: double its posts (10 if it had none).
			const last = ranks[ranks.length - 1] || { minPosts: 0, minReputation: 0 };
			const posts = R.parseThreshold(last.minPosts) || 0;
			ranks.push({ names: {}, minPosts: posts * 2 || 10, minReputation: R.parseThreshold(last.minReputation) || 0, image: '', color: '' });
		} else if (action === 'add-special') {
			special.push({ group: '', names: {}, icon: 'fa-shield-halved', image: '', color: '', showHidden: false });
		} else if (action === 'remove') {
			list.splice(i, 1);
		} else if (action === 'up' && i > 0) {
			list.splice(i - 1, 0, list.splice(i, 1)[0]);
		} else if (action === 'down' && i < list.length - 1) {
			list.splice(i + 1, 0, list.splice(i, 1)[0]);
		} else if (action === 'defaults') {
			const d = ajaxify.data.defaults || {};
			ranks = clone(d.ranks);
			special = clone(d.special);
			alerts.info(tx('defaults-restored'));
		} else if (action === 'preset') {
			loadPreset(btn.attr('data-preset'));
			return;
		} else if (action === 'upload') {
			upload(list, i);
			return;
		}
		syncHidden();
		renderTables();
	}

	/**
	 * Fills both tables from presets/<id>/preset.json, served by NodeBB through the "staticDirs"
	 * entry in plugin.json. `id` comes from a button rendered by the server (library.js
	 * listPresets). Image entries must be plain file names inside the preset folder with an image
	 * extension; anything else (sub-paths, "..", URLs) is skipped. Nothing is saved until the
	 * admin clicks Save, and the server validates the result like any other input.
	 *
	 * @param {string} id preset directory name
	 * @returns {void}
	 */
	function loadPreset(id) {
		if (!/^[a-z0-9-]{1,40}$/.test(id || '')) return;
		const base = '/assets/plugins/' + PLUGIN_ID + '/presets/' + id + '/';
		$.getJSON(config.relative_path + base + 'preset.json?' + config['cache-buster']).then(function (preset) {
			let skipped = false;
			const img = function (file) {
				if (!file) return '';
				if (typeof file !== 'string' || file.indexOf('..') !== -1 || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,80}\.(png|jpe?g|webp|gif|svg)$/i.test(file)) {
					skipped = true;
					return '';
				}
				return base + file;
			};
			const entries = function (list) {
				return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object'; });
			};
			ranks = entries(preset.ranks).map(function (r) { return Object.assign({}, r, { image: img(r.image) }); });
			special = entries(preset.special).map(function (s) { return Object.assign({}, s, { image: img(s.image) }); });
			syncHidden();
			renderTables();
			alerts.info(tx('preset-loaded', id));
			if (skipped) alerts.warning(tx('preset-bad-file', id));
		}, function () {
			alerts.error(tx('preset-not-found', id));
		});
	}

	/**
	 * Shows the saved badges, translated by the server exactly as on the forum, using the public
	 * ladder route. It reflects the saved settings, so it is refreshed after each save. The
	 * badges are built from their data (`view`) with DOM methods (lib/badge-dom.js); no HTML
	 * from the response is parsed.
	 *
	 * @returns {void}
	 */
	function preview() {
		$.getJSON(config.relative_path + '/api/v3/plugins/rank-badges/ladder?lang=' + encodeURIComponent(config.acpLang || 'en-GB')).then(function (res) {
			const data = (res && res.response) || {};
			const target = document.getElementById('rb-preview');
			if (!target) return;
			const nodes = [];
			(data.ladder || []).concat(data.groups || []).forEach(function (r) {
				const badge = r && BadgeDom.build(document, r.view);
				if (badge) nodes.push(badge);
			});
			target.replaceChildren.apply(target, nodes);
		}, function (xhr) {
			alerts.error(tx('preview-error', xhr.status));
		});
	}

	/**
	 * Page entry point, called by NodeBB when the ACP page is loaded.
	 *
	 * @returns {void}
	 */
	/**
	 * "Check for updates" switch (lib/update-check.js): its own settings hash, saved when changed,
	 * independent of the main form and its Save button.
	 */
	function initUpdateCheck() {
		const updateForm = $('.wl-update-check');
		const updateHash = updateForm.attr('data-hash');
		if (!updateHash) {
			return;
		}
		Settings.load(updateHash, updateForm, function (err, values) {
			// deserialize() never unchecks a box, so apply a saved "off" here
			if (!err && values) {
				updateForm.find('[name="checkUpdates"]').prop('checked', !['off', 'false', '0'].includes(String(values.checkUpdates)));
			}
		});
		updateForm.on('change', 'input', function () {
			Settings.save(updateHash, updateForm, function (err) {
				if (err) {
					alerts.error(err);
				} else {
					alerts.success('[[admin/plugins/rank-badges:update.saved]]');
				}
			});
		});
	}

	ACP.init = function () {
		initUpdateCheck();
		const form = $('.rank-badges-settings');
		Settings.load(HASH, form, function (err) {
			if (err) {
				// Rendering the defaults here and letting Save through would overwrite the stored
				// settings with them, so the page stays empty and saving is refused.
				$('#save').prop('disabled', true);
				translator.translate(String(err.message || err), function (reason) {
					message('load-error', $('<div>').html(reason).text()).then(function (html) { alerts.error(html, 0); });
				});
				return;
			}
			const d = ajaxify.data.defaults || {};
			const neverSaved = !$('#rb-ranks-json').val() && !$('#rb-special-json').val();
			// Only a table that was never saved falls back to the defaults; a saved empty list
			// ("[]") stays empty.
			ranks = parse($('#rb-ranks-json').val(), clone(d.ranks));
			special = parse($('#rb-special-json').val(), clone(d.special));
			if (neverSaved) {
				// Unset switches default to on, as on the server (lib/ranks.js normalize).
				['showBar', 'showImages', 'autoInject', 'showOnProfile', 'categoryModerators'].forEach(function (k) {
					$('#rb-' + k).prop('checked', true);
				});
			}
			loaded = true;
			syncHidden();
			renderTables();
			preview();
		});

		form.on('input change', '[data-list]', onInput);
		form.on('click', '[data-rb-action]', onAction);
		$('#rb-langs').on('change', renderTables);
		$('#rb-mode').on('change', renderChecks);

		$('#save').on('click', function (ev) {
			ev.preventDefault();
			if (!loaded) {
				alerts.error(tx('save-blocked'));
				return;
			}
			const result = validate();
			renderChecks();
			if (result.errors.length) {
				alerts.error(result.errors[0]);
				return;
			}
			// Names in languages that are no longer listed are dropped (as on the server).
			ranks = parse(result.settings.ranks, ranks);
			special = parse(result.settings.special, special);
			syncHidden();
			Settings.save(HASH, form, function (saveErr) {
				if (saveErr) {
					alerts.error(saveErr);
					return;
				}
				alerts.success(tx('saved'));
				renderTables();
				preview();
			});
		});
	};

	return ACP;
});
