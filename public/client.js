'use strict';

/*
 * nodebb-plugin-rank-badges: forum-side script, bundled into NodeBB's client JS through
 * "scripts" in plugin.json (runs on every forum page, not in the ACP).
 * 1. Missing badge image → show the level bar instead.
 * 2. Profile pages: put the badge next to the group badges in the account header.
 */
(function () {
	/**
	 * Switches a badge to its level-bar fallback (CSS: .rank-badge--image-failed).
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
	 * Puts ajaxify.data.rankBadge (set by library.js onAccountData) into the account header.
	 * Themes have no slot for it there, hence the DOM insertion. Guarded against double
	 * insertion because ajaxify.end can fire more than once per page.
	 *
	 * @returns {void}
	 */
	function injectProfileBadge() {
		const data = window.ajaxify && window.ajaxify.data;
		if (!data || !data.rankBadge || !data.rankBadge.html) return;
		const target = document.querySelector('[component="user/badges"]');
		if (!target || target.querySelector('.rank-badge')) return;
		require(['translator'], function (translator) {
			translator.translate(data.rankBadge.html, function (html) {
				if (target.querySelector('.rank-badge')) return;
				const wrap = document.createElement('span');
				wrap.className = 'rank-badges-profile';
				wrap.innerHTML = html; // server-built, all admin input escaped
				target.prepend(wrap);
				checkLoaded(wrap);
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
	}

	if (window.jQuery) {
		window.jQuery(window).on('action:ajaxify.end action:posts.loaded action:posts.edited', onPage);
	}
	// Server-rendered first page: check images as soon as the DOM is ready.
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkLoaded);
	} else {
		checkLoaded();
	}
}());
