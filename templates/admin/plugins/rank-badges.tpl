<!--
	ACP page of nodebb-plugin-rank-badges, rendered by the route in library.js (init).
	Behaviour lives in public/admin.js; strings come from
	languages/<lang>/admin/plugins/rank-badges.json through the tx() template helper. Fields with a name attribute are saved by
	NodeBB's settings module under the "rank-badges" hash; the two tables are kept as JSON in the
	hidden inputs at the bottom and validated on the server by lib/ranks.js.
-->
<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-0 mb-4" tabindex="0">
			<form role="form" class="rank-badges-settings d-flex flex-column gap-4">
				{{{ if reputationDisabled }}}
				<div class="alert alert-info mb-0">{{tx("admin/plugins/rank-badges:reputation-disabled")}}</div>
				{{{ end }}}

				<div class="row g-3">
					<div class="col-12 col-md-6">
						<label class="form-label fw-semibold" for="rb-mode">{{tx("admin/plugins/rank-badges:mode")}}</label>
						<select class="form-select" id="rb-mode" name="mode">
							<option value="all">{{tx("admin/plugins/rank-badges:mode-all")}}</option>
							<option value="posts">{{tx("admin/plugins/rank-badges:mode-posts")}}</option>
							<option value="reputation">{{tx("admin/plugins/rank-badges:mode-reputation")}}</option>
							<option value="any">{{tx("admin/plugins/rank-badges:mode-any")}}</option>
						</select>
						<p class="form-text">{{tx("admin/plugins/rank-badges:mode-help")}}</p>
					</div>
					<div class="col-12 col-md-6">
						<label class="form-label fw-semibold" for="rb-langs">{{tx("admin/plugins/rank-badges:langs")}}</label>
						<input type="text" class="form-control" id="rb-langs" name="nameLangs" placeholder="en-GB, pl">
						<p class="form-text">{{tx("admin/plugins/rank-badges:langs-help")}}</p>
					</div>
				</div>

				<div class="d-flex flex-wrap gap-4">
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showBar" name="showBar">
						<label class="form-check-label" for="rb-showBar">{{tx("admin/plugins/rank-badges:show-bar")}}</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showImages" name="showImages">
						<label class="form-check-label" for="rb-showImages">{{tx("admin/plugins/rank-badges:show-images")}}</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-autoInject" name="autoInject">
						<label class="form-check-label" for="rb-autoInject">{{tx("admin/plugins/rank-badges:auto-inject")}}</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-showOnProfile" name="showOnProfile">
						<label class="form-check-label" for="rb-showOnProfile">{{tx("admin/plugins/rank-badges:show-on-profile")}}</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-hideGroupBadges" name="hideGroupBadges">
						<label class="form-check-label" for="rb-hideGroupBadges">{{tx("admin/plugins/rank-badges:hide-group-badges")}}</label>
					</div>
					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="rb-categoryModerators" name="categoryModerators">
						<label class="form-check-label" for="rb-categoryModerators">{{tx("admin/plugins/rank-badges:category-moderators")}}</label>
					</div>
				</div>
				<p class="form-text mt-n3">{{tx("admin/plugins/rank-badges:auto-inject-help")}} <code>posts.user.rankBadge.html</code></p>

				<div>
					<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
						<h5 class="mb-0">{{tx("admin/plugins/rank-badges:ranks")}}</h5>
						<div class="d-flex flex-wrap gap-2">
							<button type="button" class="btn btn-sm btn-light" data-rb-action="add-rank"><i class="fa fa-plus"></i> {{tx("admin/plugins/rank-badges:add-rank")}}</button>
							<!-- Presets found by library.js (listPresets): sub-folders of presets/ with preset.json. -->
							{{{ each presets }}}
							<button type="button" class="btn btn-sm btn-light" data-rb-action="preset" data-preset="{./id}"><i class="fa fa-images"></i> {{tx("admin/plugins/rank-badges:load-preset", ./id)}}</button>
							{{{ end }}}
							<button type="button" class="btn btn-sm btn-light" data-rb-action="defaults"><i class="fa fa-rotate-left"></i> {{tx("admin/plugins/rank-badges:restore-defaults")}}</button>
						</div>
					</div>
					<p class="form-text">{{tx("admin/plugins/rank-badges:ranks-help", "512")}}</p>
					<div class="table-responsive">
						<table class="table table-sm align-middle" id="rb-ranks">
							<thead><tr><th>#</th><th>{{tx("admin/plugins/rank-badges:col-name")}}</th><th>{{tx("admin/plugins/rank-badges:col-min-posts")}}</th><th>{{tx("admin/plugins/rank-badges:col-min-reputation")}}</th><th>{{tx("admin/plugins/rank-badges:col-image")}}</th><th>{{tx("admin/plugins/rank-badges:col-colour")}}</th><th></th></tr></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>

				<div>
					<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
						<h5 class="mb-0">{{tx("admin/plugins/rank-badges:groups")}}</h5>
						<button type="button" class="btn btn-sm btn-light" data-rb-action="add-special"><i class="fa fa-plus"></i> {{tx("admin/plugins/rank-badges:add-group")}}</button>
					</div>
					<p class="form-text">{{tx("admin/plugins/rank-badges:groups-help")}}</p>
					<div class="table-responsive">
						<table class="table table-sm align-middle" id="rb-special">
							<thead><tr><th>{{tx("admin/plugins/rank-badges:col-group")}}</th><th>{{tx("admin/plugins/rank-badges:col-name")}}</th><th>{{tx("admin/plugins/rank-badges:col-icon")}}</th><th>{{tx("admin/plugins/rank-badges:col-image")}}</th><th>{{tx("admin/plugins/rank-badges:col-colour")}}</th><th>{{tx("admin/plugins/rank-badges:col-show-hidden")}}</th><th></th></tr></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>

				<!-- Validation errors and warnings, filled by public/admin.js (renderChecks). -->
				<div id="rb-checks" class="d-none">
					<h5>{{tx("admin/plugins/rank-badges:checks")}}</h5>
					<ul class="list-unstyled d-flex flex-column gap-2 mb-0"></ul>
				</div>

				<!-- Filled by public/admin.js (syncHidden) before each save. -->
				<input type="hidden" name="ranks" id="rb-ranks-json">
				<input type="hidden" name="special" id="rb-special-json">

				<div>
					<!-- Server-rendered badges of the saved settings (public/admin.js preview). -->
					<h5>{{tx("admin/plugins/rank-badges:preview")}}</h5>
					<p class="form-text">{{tx("admin/plugins/rank-badges:preview-help")}}</p>
					<div class="d-flex flex-wrap gap-2" id="rb-preview"></div>
				</div>
			</form>
		</div>
	</div>
</div>
