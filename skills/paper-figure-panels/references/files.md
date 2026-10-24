# Panel helper files

The exported packet is `{version:1,workspaceRoot,path,revision,figures,blocks:[{id,kind,text}]}`. Each usable figure supplies `blockId`, authored `path`, resolved workspace `file`, `sourceHash`, and compact `savedPanels:[{label,stale,targetCount}]`. The listing also returns destination identity and `panelCount`, `validPanelCount`, `associationCount`. This is manuscript data only. Different packet content cannot overwrite an existing filename. Helpers and manifest import reject a different workspace even when its copied manuscript has identical bytes. Older packets without `workspaceRoot` remain readable; confirm their destination manually.

The regions manifest uses `source` (resolved workspace file), `sourceHash`, and `panels:[{label,page,region}]`. Regions are four normalized fractions: left, top, right, bottom. Add `figureBlockId` if one source is referenced more than once. Targets are a JSON object mapping every candidate label to a list of actual packet block IDs, e.g. `{"a":["<actual opaque ID>"]}`. Helpers copy the full exact text; never substitute guessed IDs.

`prepare_panels.py WORKSPACE PACKET REGIONS TARGETS --output REGISTRATION.json` checks current Markdown revision/artwork hash, fills exact targets, writes crops under the manuscript's `figures/reader-panels/`, and creates previews. Existing different output refuses overwrite: use a new round filename.

`prepare_panels.py WORKSPACE PACKET --query REGEX` searches current snapshot block text case-insensitively and returns only matching whole blocks, including exact IDs and zero-based indices. It checks the manuscript revision and writes nothing. Query matches are candidates for reading, not automatic panel associations.

`inspect_figure.py WORKSPACE MANIFEST.json [--page N] [--output-dir DIR]` permits empty/missing panels for an initial grid. It returns source dimensions, grids, overlays, crop previews/contact sheets, and edge-content hints. These cannot identify missing shared legends or prove completeness. Default previews sit beside the manifest.

`split_panels.py WORKSPACE MANIFEST.json [--output-dir DIR]` keeps its legacy interface. Default output is `figures/reader-panels/`. For a broad home workspace, choose output under the manuscript or use its directory as a narrower root, then prefix returned files back to conversation-workspace-relative paths.

When extending a partial map, preserve its desired old regions and target IDs using saved manifests/current packet. Importing only a new panel replaces previous labels. An empty inline panels array removes a figure map. `paper_panel_set` returns a compact confirmation; use `paper_read` with `includePanels:false` for ordinary paragraph reads.

Helpers confine paths and preserve originals; the host revalidates source and exact paragraphs before saving. A packet never authorizes prose acceptance or review-baseline changes.
