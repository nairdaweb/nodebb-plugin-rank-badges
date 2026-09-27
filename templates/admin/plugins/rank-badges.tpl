<!--
	ACP page of nodebb-plugin-rank-badges, rendered by the route in library.js (init).
	Behaviour lives in public/admin.js. Fields with a name attribute are saved by NodeBB's
	settings module under the "rank-badges" hash; the two tables are kept as JSON in the hidden
	inputs at the bottom and validated on the server by lib/ranks.js.
-->
<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-0 mb-4" tabindex="0">
			<form role="form" class="rank-badges-settings d-flex flex-column gap-4">
				<div class="row g-3">
					<div class="col-12 col-md-6">
						<label class="form-label fw-semibold" for="rb-mode">How ranks are earned</label>
						<select class="form-select" id="rb-mode" name="mode">
							<option value="all">Posts and reputation (both thresholds)</option>
							<option value="posts">Posts only</option>
							<option value="reputation">Reputation only</option>
							<option value="any">Posts or reputation (either threshold)</option>
						</select>
						<p class="form-text">A user gets the highest rank in the list whose thresholds they meet.</p>
					</div>
					<div class="col-12 col-md-6">
						<label class="form-label fw-semibold" for="rb-langs">Languages for rank names</label>
						<input type="text" class="form-control" id="rb-langs" name="nameLangs" placeholder="en-GB, pl">
						<p class="form-text">One name column per language code. An empty name uses the translation from the plugin's language files (default ranks) or the first name given.</p>
					</div>
				</div>

				<div class="d-flex flex-wrap gap-4">
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showBar" name="showBar">
						<label class="form-check-label" for="rb-showBar">Show level bar</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showImages" name="showImages">
						<label class="form-check-label" for="rb-showImages">Show images</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-autoInject" name="autoInject">
						<label class="form-check-label" for="rb-autoInject">Add badge to posts automatically</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showOnProfile" name="showOnProfile">
						<label class="form-check-label" for="rb-showOnProfile">Show badge on profiles</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-hideGroupBadges" name="hideGroupBadges">
						<label class="form-check-label" for="rb-hideGroupBadges">Hide group title badges in posts of users with a group badge</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-categoryModerators" name="categoryModerators">
						<label class="form-check-label" for="rb-categoryModerators">Category moderators get the "Global Moderators" badge</label>
					</div>
				</div>
				<p class="form-text mt-n3">"Add badge to posts automatically" uses the theme's custom profile info slot (Harmony, Persona). Turn it off if your theme prints <code>posts.user.rankBadge.html</code> itself.</p>

				<div>
					<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
						<h5 class="mb-0">Ranks</h5>
						<div class="d-flex flex-wrap gap-2">
							<button type="button" class="btn btn-sm btn-light" data-rb-action="add-rank"><i class="fa fa-plus"></i> Add rank</button>
							<!-- Presets listed by library.js; shown only when the preset directory exists. -->
							{{{ each presets }}}{{{ if ./available }}}
							<button type="button" class="btn btn-sm btn-light" data-rb-action="preset" data-preset="{./id}"><i class="fa fa-images"></i> Load preset "{./id}"</button>
							{{{ end }}}{{{ end }}}
							<button type="button" class="btn btn-sm btn-light" data-rb-action="defaults"><i class="fa fa-rotate-left"></i> Restore defaults</button>
						</div>
					</div>
					<p class="form-text">Order matters: level = position in the list. Images: upload or paste a URL (square, ≥ 64 px; shown at 20 px in posts). Colour is optional (accent of the badge).</p>
					<div class="table-responsive">
						<table class="table table-sm align-middle" id="rb-ranks">
							<thead><tr><th>#</th><th data-rb-names-head>Name</th><th>Min. posts</th><th>Min. reputation</th><th>Image</th><th>Colour</th><th></th></tr></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>

				<div>
					<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
						<h5 class="mb-0">Group badges</h5>
						<button type="button" class="btn btn-sm btn-light" data-rb-action="add-special"><i class="fa fa-plus"></i> Add group badge</button>
					</div>
					<p class="form-text">Members of these groups get this badge instead of a rank. The first matching group in the list wins. Icon: a Font Awesome name such as <code>fa-shield-halved</code>.</p>
					<div class="table-responsive">
						<table class="table table-sm align-middle" id="rb-special">
							<thead><tr><th>Group</th><th data-rb-names-head>Name</th><th>Icon</th><th>Image</th><th>Colour</th><th></th></tr></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>

				<!-- Filled by public/admin.js (syncHidden) before each save. -->
				<input type="hidden" name="ranks" id="rb-ranks-json">
				<input type="hidden" name="special" id="rb-special-json">

				<div>
					<!-- Server-rendered ladder of the saved settings (public/admin.js preview). -->
					<h5>Preview</h5>
					<div class="d-flex flex-wrap gap-2" id="rb-preview"></div>
				</div>
			</form>
		</div>
	</div>
</div>
