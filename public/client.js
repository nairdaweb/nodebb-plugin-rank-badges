'use strict';

/*
 * nodebb-plugin-rank-badges: forum-side script, bundled into NodeBB's client JS through
 * "scripts" in plugin.json (runs on every forum page, not in the ACP).
 * 1. Missing badge image → CSS fallback (level bar, group icon or a generic icon).
 * 2. Profile pages: put the badge next to the group badges in the account header.
 * 3. Posts that arrive over the websocket (new replies from other users, infinite scroll for
 *    guests) were rendered without knowing the viewer's language; their badges are replaced by
 *    the same badges in the viewer's language from the ladder route.
 */
(function () {
	/**
	 * Switches a badge to its fallback (CSS: .rank-badge--image-failed).
	 *
	 * @param {HTMLImageElement} img broken badge image
	 * @returns {void}
	 */
	function markFailed(img) {
		const badge = img.closest && img.closest('.rank-badge');
		if (badge) badge.classList.add('rank-badge--image-failed');
	}

	// Error events do not bubble, but they can be captured on the document.
	document.addEventListener('error', function (ev) {
		const t = ev.target;
		if (t && t.tagName === 'IMG' && t.classList.contains('rank-badge__img')) markFailed(t);
	}, true);

	/**
	 * Catches images that failed before the capturing listener existed (cached 404s, images in
	 * the server-rendered page).
	 *
	 * @param {ParentNode} [root=document]
	 * @returns {void}
	 */
	function checkLoaded(root) {
		(root || document).querySelectorAll('.rank-badge__img').forEach(function (img) {
			// Already failed before this script ran.
			if (img.complete && img.naturalWidth === 0) markFailed(img);
		});
	}

	/**
	 * Puts ajaxify.data.rankBadge (set by library.js onAccountData, already translated by the
	 * server) into the account header. Themes have no slot for it there, hence the DOM insertion.
	 * Guarded against double insertion because ajaxify.end can fire more than once per page.
	 *
	 * @returns {void}
	 */
	function injectProfileBadge() {
		const data = window.ajaxify && window.ajaxify.data;
		if (!data || !data.rankBadge || !data.rankBadge.html) return;
		const target = document.querySelector('[component="user/badges"]');
		if (!target || target.querySelector('.rank-badge')) return;
		const wrap = document.createElement('span');
		wrap.className = 'rank-badges-profile';
		wrap.innerHTML = data.rankBadge.html; // server-built, all admin input escaped
		target.prepend(wrap);
		checkLoaded(wrap);
	}

	/** Badge HTML by id ("r2", "s0") per language, loaded once per language and page session. */
	const ladders = {};

	/**
	 * @param {string} lang
	 * @returns {Promise<Object<string, string>>} id → badge HTML (small size)
	 */
	function loadLadder(lang) {
		if (!ladders[lang]) {
			const url = config.relative_path + '/api/v3/plugins/rank-badges/ladder?lang=' + encodeURIComponent(lang);
			ladders[lang] = fetch(url, { credentials: 'same-origin' })
				.then(function (res) { return res.ok ? res.json() : {}; })
				.then(function (body) {
					const data = (body && body.response) || {};
					const map = {};
					(data.ladder || []).concat(data.groups || []).forEach(function (b) {
						if (b && b.id && b.html) map[b.id] = b.html;
					});
					return map;
				})
				.catch(function () { return {}; });
		}
		return ladders[lang];
	}

	/**
	 * Replaces post badges rendered in another language than the viewer's (data-rb-lang) with
	 * the same badge (data-rb id) from the ladder route. Profile badges (large size) are
	 * rendered for the viewer on the server and are left alone.
	 *
	 * @param {ParentNode} [root=document]
	 * @returns {void}
	 */
	function relocalize(root) {
		const lang = window.config && config.userLang;
		if (!lang) return;
		const stale = Array.prototype.filter.call(
			(root || document).querySelectorAll('.rank-badge[data-rb][data-rb-lang]:not(.rank-badge--lg)'),
			function (el) { return el.getAttribute('data-rb-lang') !== lang; }
		);
		if (!stale.length) return;
		loadLadder(lang).then(function (map) {
			stale.forEach(function (el) {
				const html = map[el.getAttribute('data-rb')];
				if (!html || !el.parentNode) return;
				const tpl = document.createElement('template');
				tpl.innerHTML = html; // server-built, all admin input escaped
				const fresh = tpl.content.firstElementChild;
				if (!fresh) return;
				el.replaceWith(fresh);
				checkLoaded(fresh.parentNode || document);
			});
		});
	}

	/**
	 * Runs after every client-side navigation and when posts are added or edited.
	 *
	 * @returns {void}
	 */
	function onPage() {
		checkLoaded();
		injectProfileBadge();
		relocalize();
	}

	if (window.jQuery) {
		window.jQuery(window).on('action:ajaxify.end action:posts.loaded action:posts.edited', onPage);
	}
	// Server-rendered first page: check images as soon as the DOM is ready.
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { checkLoaded(); });
	} else {
		checkLoaded();
	}
}());
