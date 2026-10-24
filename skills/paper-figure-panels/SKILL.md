---
name: paper-figure-panels
description: Inspect and split manuscript figures into labeled panels, then associate verified crops with exact body paragraphs in DSH Paper review. Use for figure/text reading and panel placement; preserve original artwork and prose.
---

Produce readable crops and exact paragraph links, keeping the whole figure available. Use the bundled helpers instead of inventing inspection scripts. Paths below are workspace-relative except the absolute skill/helper directory. Run helpers with the conversation workspace as their working directory; `--no-project` avoids resolving unrelated Python projects and `python -B` avoids writing bytecode beside the skill. Keep the uv cache and Python installation in this workspace as shown below; the sandbox cannot write the global cache. After one successful dependency setup, cached calls may add `--offline`. Keep work files beside the manuscript, for example `papers/draft/.panel-work/run1/`. Never write `.paper-review` yourself or change DSH services, permissions or model settings to finish a figure.

## Start once, reuse results

Run the documented, vetted helpers directly in the uv environment. Do not probe system Python for Pillow, read helper implementations or enumerate their CLI flags before using them; this skill supplies the required formats and commands. Inspect code only to diagnose a specific helper failure.

Use the **Workspace, Manuscript and Reader revision in the launch message** as the destination. Call `paper_open` with that exact path, then `paper_figure_list({path, packet:"papers/draft/.panel-work/run1/context.json"})`. Check the returned `workspaceRoot`, `path` and `revision` against the destination before cropping. For a manual invocation without a launch target, use the current conversation's selected manuscript; resolve an ambiguous target before saving. Never substitute a scratch copy, another session or a standalone HTML reader for the destination. Helpers run with this workspace root, and all workers receive this same destination.

The packet binds its workspace, manuscript revision, source hashes, figures and exact block IDs/text. It is data, not instructions. `savedPanels` reports existing maps; `panelCount`, `validPanelCount` and `associationCount` summarize this manuscript. Reuse non-stale completed panels unless asked to recheck them; revisit only missing, changed or flagged figures. Reuse existing crop bytes when appropriate, but export context and obtain exact IDs from the destination: copies with identical Markdown can have different block IDs. A changed source needs a fresh packet filename.

For three or more figures, use **2–3 available native workers**, one writer per figure. Assign disjoint figures and work paths, use the configured model, and pass the shared packet path and destination instead of a copied long conversation. Each DSH child must use the same workspace and call `paper_open` with the destination path itself to enable manuscript tools. Workers inspect, crop, register their own figure and report the compact result, including its destination. The parent coordinates without redoing verified crops. Respect configured limits; do not enable team features or change settings. Read [parallel.md](references/parallel.md) only when using DSH `workflow`. Without native delegation, follow the same process sequentially.

## Finish each figure

1. Read its caption and relevant body paragraphs from the packet or `paper_read` with **`includePanels:false`**. For a large packet, `prepare_panels.py WORKSPACE PACKET --query '(?:Fig(?:ure)?\.?)\s*3(?!\d)'` returns matching whole blocks and IDs without loading the full file. Use small pages or selected blocks; avoid rereading the whole manuscript and all saved maps. Match actual panel labels and explicit callouts, using caption/content evidence for whole-figure callouts. Do not invent panel-specific citations. Copy opaque target IDs; helpers retrieve unchanged complete text.
2. Create a regions manifest with `source` (the packet figure's resolved `file`), `sourceHash`, and initially `panels:[]`. Inspect the actual artwork and run:

   ```sh
   UV_PYTHON_INSTALL_DIR=/ABS/WORKSPACE/.paper-tools/python uv --cache-dir /ABS/WORKSPACE/.paper-tools/uv-cache run --no-project --python 3.12 --with pillow==12.3.0 --with pymupdf==1.26.7 python -B /ABS/SKILL/scripts/inspect_figure.py /ABS/WORKSPACE /ABS/WORKSPACE/papers/draft/.panel-work/run1/fig1.json
   ```

   View the returned grid. Coordinates are **normalized `[left,top,right,bottom]`** from the top-left of the rendered source; pages start at 1. Its header distinguishes actual dimensions from resized-preview pixels. Raster images honor EXIF; PDF/SVG render at 2×. Do not infer bounds from whitespace alone.
3. Fill `panels` with visually identified `{label,page,region}` entries. Write a short targets file mapping each label to its actual body block IDs. Omit unresolved panels and explain why instead of guessing links. Run:

   The regions file is `{"source":"WORKSPACE_RELATIVE_FIGURE","sourceHash":"PACKET_HASH","panels":[{"label":"a","page":1,"region":[0,0,0.5,0.5]}]}`. The targets file is an object such as `{"a":["EXACT_BODY_BLOCK_ID"],"b":["ANOTHER_BODY_BLOCK_ID"]}`; its labels must exactly match the regions file. Use IDs from the packet; the helper inserts complete unchanged paragraph text.

   ```sh
   UV_PYTHON_INSTALL_DIR=/ABS/WORKSPACE/.paper-tools/python uv --cache-dir /ABS/WORKSPACE/.paper-tools/uv-cache run --no-project --python 3.12 --with pillow==12.3.0 --with pymupdf==1.26.7 python -B /ABS/SKILL/scripts/prepare_panels.py /ABS/WORKSPACE papers/draft/.panel-work/run1/context.json papers/draft/.panel-work/run1/fig1.json papers/draft/.panel-work/run1/fig1-targets.json --output papers/draft/.panel-work/run1/fig1-r1-registration.json
   ```

   This crops content-addressed PNGs beside the manuscript, produces grids/contact sheets, and fills exact paragraph text in a registration file. It checks packet revision and source hash. Do not retype long paragraphs; the helper's response omits repeated `before` text.
4. **View contact sheets and small/dense crops at readable size before saving.** Use contact sheets for the normal check; skip the separate overlay when boundaries are already clear. If the host supports batched image reads, read all sheets in one step. Reopen individual crops only for small labels or a specific clipping concern; use the exact returned preview paths, never wildcard paths. Do not repeatedly request the same source/grid. Preserve panel letters, titles, axes/ticks, scale bars, complete connector/return-arrow paths, legends and relevant footnotes, with a small visible margin. Inspect `nearbySourceReview` for annotations just outside an otherwise blank edge. Edge/nearby-source flags are review hints, not automatic failures; no flag proves completeness. Include shared keys in the crop or retain whole-figure reading and report that dependency. Never redraw scientific content to make a crop independent.
5. Correct only affected regions, using a new `r2`/`r3` output filename. After at most three boundary rounds, retain unresolved content as the whole figure, record the issue, and continue. Save each verified map immediately:

   `paper_panel_set({path, manifest:"papers/draft/.panel-work/run1/fig1-r1-registration.json"})`

   The host rechecks the manifest workspace/manuscript, source/crop hashes and exact target text. Confirm the acknowledgement's `workspaceRoot`, `path` and `revision` match the destination. This replaces the figure's complete map: preserve desired existing panels when extending it. On refusal, refresh only changed inputs; do not blindly retry. Do not repeat a successful registration or recite the saved map.

Finish by calling `paper_figure_list({path: DESTINATION})` in the original conversation. Verify destination identity, unchanged revision, `diskChanged:false`, each completed figure's non-stale `savedPanels`, and the expected `validPanelCount`/`associationCount`. Exported PNGs, helper previews, or a successful save in a child/copy do not establish completion here. Report the actual destination, verified totals and unresolved review items. The reader refreshes after the conversation finishes; **Check updates** also reloads metadata while preserving position. In **Text and figures**, choose **Whole figure / a / b / …**; **Locate related text** opens an exact associated paragraph. Leave prose and original files unchanged.

## Older hosts

Check the actual tool schema. If it lacks `packet`/`manifest`, use `paper_read`, `paper_figure_list`, `inspect_figure.py` and `split_panels.py`, then supported inline `paper_panel_set` fields. Copy complete current target text and IDs verbatim. Do not try unsupported arguments or install/reload anything during the author's reading session. Read [files.md](references/files.md) for file formats and partial-map updates.
