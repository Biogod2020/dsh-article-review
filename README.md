---
description: "Review Markdown manuscripts with durable annotations, agent-accessible manuscript tools, and changes measured against the last marked review."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-paper-review

English | [中文](README.zh.md)

## Summary

Read a Markdown manuscript beside the native conversation, collect annotations, and request localized revisions. A floating progress rail jumps to sections and paragraphs without narrowing the page. Bind `.bib` files as the citation-key authority and inspect their index outside the reading body. The agent can open manuscripts, manage bibliography entries, and create or revise pending manuscript proposals. Paper mode retains ordinary tools; a file-write-enabled agent can still edit outside the review workflow. Install a pinned, prebuilt Git tag into a Web profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the prebuilt version tag with DSH's profile command:

```sh
dsh plugin --profile web add 'github:Biogod2020/dsh-article-review#v0.1.7-alpha.2'
dsh web
```

The installer adds this package's [bundle patch](cordis.patch.yml) after the Web layer. Restart an already running Web profile after installation; no separate launcher or model configuration is needed. This independent add-on was smoke-tested with DSH `0.1.6-alpha.2` on macOS. The `main` branch contains development source with `workspace:^` dependencies and is not a direct Git install target; pin a release tag. For local development, build a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) checkout containing this package, then run `dsh plugin --profile web add /absolute/path/to/deepseek-harness/packages/experimental/paper-review` and keep that checkout in place.

### Configuration

The default manuscript directory is the current conversation's local workspace. Stored conversations can reopen manuscripts after a server restart without sending a model message. Optional profile overrides target the `paper-review` row. The [review overlay](review.overlay.yml) remains available for isolated development with an explicit `DSH_PAPER_REVIEW_ROOT`; it is not needed for native installation.

| Field | Default | Meaning |
|---|---|---|
| `workspaceRoot` | Conversation workspace | Optional fixed local directory containing the manuscripts |
| `maxBytes` | `1000000` | Maximum manuscript UTF-8 bytes; at most `2000000` |

Choose a local workspace and open the conversation's right sidebar. Choose **Read, annotate and revise**, then select **Choose Markdown file** to open the macOS Finder file chooser on the DSH host, or enter a relative `.md` path such as `article.md`. The host validates the selected file inside the workspace and refuses symlink escapes. On a non-macOS host, the button opens the in-app workspace browser, which lists up to 500 visible folders and Markdown files per directory. The agent can use `paper_list` and `paper_open` to select a known workspace path; its choice appears in the sidebar after its turn. The selection survives restarts. **Exit Paper mode** hides the active manuscript tools without deleting review records; it is unavailable while the agent is running. Manuscripts must remain inside the workspace or explicitly configured review directory.

After opening a manuscript, the header keeps the review tabs visible while hiding file controls. Select **Change file** to reopen the path, picker and exit action; use the toolbar chevron to leave only a narrow manuscript bar while reading. The toolbar choice survives a reload. Navigation and major review decisions pair icons with text; compact controls such as refresh, mark reviewed, lock and source use icons with tooltips and accessible names. Narrow panes show icon-only tabs. An opening Markdown provenance comment appears as a collapsed **Manuscript source note** in the reader; expand it to inspect its exact text. These display controls do not edit the manuscript or its review records.

With focus in the review pane, press Cmd+F on macOS or Ctrl+F elsewhere to find text in the current manuscript. The pane switches to **Read** if necessary, highlights visible matches, and offers Enter, Shift+Enter or arrow buttons to move between them. Escape closes the search and removes its temporary highlights; it does not create saved review highlights or change the manuscript. Search does not take the shortcut from a text input or another pane. Very broad searches stop after 2,000 matches.

### Review workflow

1. Select text within a paragraph and right-click for yellow, green or blue highlights, underlining, annotations, copying, focused reading or AI context. Inline formatting and repeated phrases retain the selected occurrence. Highlights and annotations never change the manuscript. The highlight list offers removal and restoration. Clicking a paragraph still exposes its existing actions.
2. Mark a paragraph reviewed, or review and lock it. This saves the human-review baseline. A lock prevents proposals and acceptance for that block inside this plugin. Marking it reviewed again preserves the lock; only **Unlock** removes it. The narrow floating review rail shows the percentage and color-coded status of reviewable blocks without changing reading width. Expand it for section-grouped paragraph previews, then click one to jump there. Green means the current text was reviewed, gray means unread, and amber means the text changed after review. Bibliography and source comments do not count; accepting a revision can lower the percentage until you review it again.
3. Open **Review changes** to read each proposal's before and after Markdown with changed visible words colored, alongside the model's declared category and independent lexical warnings. Comparisons load as they approach the viewport; scroll to a proposal to inspect it. Expand **View Markdown source diff** to inspect exact word and formatting-syntax changes. You or the agent can accept or reject each group; `paper_decide` accepts only after your request. Acceptance changes the file but never marks the result reviewed. To improve a pending proposal, use **Request revision** or ask the agent to call `paper_revise`: it updates the same proposal ID, reruns checks and leaves the manuscript untouched. Accepted and rejected proposals cannot be revised.
4. Inspect **Since my last review**, then mark the revised paragraph reviewed only after checking it. Multiple accepted rounds remain compared with that earlier human baseline.
5. **Check updates** refreshes proposal metadata. A completed conversation turn also checks it. External file changes leave the reader fixed until you select **Load new version**.
6. Open **Compare versions** and select any two saved revisions. **Rendered pages** colors changed visible words without filling entire blocks; thin borders identify changed blocks. Externally rewritten blocks may receive new IDs, so this view matches sufficiently similar blocks between stable neighbors for word coloring only; it never moves saved annotations. **Source side by side** and **Source inline changes** show exact additions and deletions in complete Markdown source, including formatting-only changes. If a rendered block cannot be matched or its text cannot be mapped reliably, it keeps its border without inline color. Swap the sides to reverse the comparison. This view neither restores files nor advances human-review baselines. Narrow panes stack the two sides vertically.
7. In **Read**, a small figure thumbnail floats at the right edge. Hover over it or use its expand button to see the thumbnail grid; click a thumbnail or a caption's **View full screen** button to open a viewport-sized preview. PDF thumbnails and the full-screen preview show the first page; **Open in DSH tab** remains available for multi-page viewing. Figures do not load into manuscript text. The pinned Markdown reference chooses the file: paths resolve beside the manuscript unless its opening provenance comment explicitly says `Figure PDFs stay in path/;`, in which case that one directory is used. There is no figure-version picker or fallback to a same-named file. Missing files and unsupported media show a failure instead of another figure.

### References and BibTeX

Open **References** to bind existing workspace `.bib` files by path or, on a macOS DSH host, with Finder. The tab shows indexed entries and flags missing `[@key]` citations or possible legacy bare keys. The reader hides a top-level Markdown `References` or `Bibliography` section without deleting it from source or version history; the bound `.bib` files, not that display section, are the authority. Cite in Markdown as `[@key]` or `[@first; @second]`; in Read, resolved citations display as author-year labels without rewriting the saved Markdown, while unknown or incomplete entries remain visible as keys. New citations in manuscript proposals must resolve in the bound files; newly introduced bare year-style keys and `[cite: key]` notation are refused. Existing legacy text is left intact and surfaced for migration. The agent can find, bind, list, read, add and replace BibTeX entries through `paper_bib_*` tools; adding or replacing an entry writes the bound `.bib` file directly and creates no manuscript proposal. Syntax and key uniqueness are checked, but the tool does not independently verify publication metadata or whether it supports a claim. Manuscript prose changes still require the normal proposal and acceptance flow.

Annotations can attach the selected paragraph and its neighbors to the ordinary composer. Attaching context does not send it; inspect the draft before submitting it to your configured model provider. The selection menu supports arrow keys, Enter and Escape; outside clicks or reader scrolling dismiss it.

The reader, annotations, selection menu and version differences follow DSH's **Light**, **Dark** or **System** appearance setting immediately. Highlights and added/deleted text use scheme-specific colors. The plugin does not save a separate theme preference.

Canceling an annotation or selecting another paragraph clears its unsaved comment. Opening another manuscript also clears selected annotation checkboxes, so a batch cannot carry selections from the previous file.

On DSH 0.1.6, attached context appends to existing plain-text drafts. If the draft contains file or session reference chips, the plugin leaves it unchanged and asks you to send or clear it first. Newer composers preserve those references during insertion. Busy composers reject attachment without changing the draft.

Highlights, annotations, original quotations, revisions, decisions, baselines, locks, and the last clicked paragraph per session live under `<workspaceRoot>/.paper-review/`. Preserve this private directory with the manuscript backup; exclude it from public Git history because it contains complete draft text and comments. Browser storage holds only the last path. Do not edit the same manuscript concurrently in another application while accepting a proposal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [host](src/index.ts) adds manuscript discovery, review and BibTeX tools to the ordinary agent tools. Authenticated operator requests use Connection's `/api` carrier; model tools derive the session from the executing agent. Enabled sessions and their selected manuscript paths persist in the workspace's private review directory and restore before a resumed agent runs. Exit hides active manuscript tools while retaining review records and ordinary tools. Inactive sessions can still use `paper_list` and `paper_open`. The plugin does not override DSH's configured permissions, and its paragraph locks do not prevent direct file writes through other tools.

The [store](src/store.ts) serializes actions and holds an exclusive kernel-backed workspace lock. The kernel releases it when the server exits, including after a crash. An existing `owner.lock` from an older plugin process blocks startup while its recorded PID is alive; a dead PID is admitted under the kernel lock, and the old file is removed on a clean close. An invalid or unverifiable owner record still requires manual inspection. Do not remove `owner.kernel.lock` while a server may be using the workspace. In-place proposal revision checks the displayed revision, disk source, annotations, exact block text and locks before updating only private review state; omitted fields stay unchanged, while a supplied edits array replaces the full edit group. A stale pending proposal can be rebased in place by supplying the new base revision and complete replacements against exact current blocks; its ID and pending status remain unchanged. Acceptance repeats source and lock checks before writing. It saves a recovery journal, atomically replaces the source, commits state, and removes the journal. On restart, a matching before/after source hash resolves an interrupted acceptance; a third hash refuses further work and preserves the journal for manual reconciliation.

The [Markdown parser](src/document.ts) retains source offsets and assigns durable block ids. Unique unchanged blocks survive insertions; accepted replacements explicitly preserve identity. Ambiguous external rewrites detach annotations instead of guessing. The [panel](src/client/panel.tsx) uses the native sidebar and composer without changing core DSH packages. No runtime invariant companion is published: the store validates persisted state and owns every state transition; there is no separately cached runtime observation to reconcile.

The [selection reader](src/client/reader-text.tsx) mounts Markdown near the visible scroll area and paints DOM ranges through the CSS Custom Highlight API; it does not insert markup into React-owned text. It displays pipe tables with em-dash divider rows as tables in reading and rendered comparisons without changing the saved Markdown or block identities. Changed tables retain block borders instead of word-level coloring. Saved rendered anchors include the selected offset, quote, surrounding text and exact block source. Any source change to that block detaches its rendered anchors rather than guessing how formatting changed. Existing private schema-version-1 records remain readable with an empty highlight list; older raw-source annotations retain their original matching rules. Highlight removal is reversible. Paint registrations and menu listeners are disposed with their components.

The [review panel](src/client/panel.tsx) keeps proposal summaries, risk flags and decisions mounted while it defers offscreen comparisons. Each comparison parses both sides once; its exact Markdown source diff is computed only while expanded. Browsers without IntersectionObserver render every comparison immediately.

[Figure references](src/client/figures.ts) come from explicit caption paths and Markdown image destinations. The host validates each referenced path inside the review workspace; symlink escapes and non-file paths are refused. The floating gallery loads images only when shown and renders PDF first pages into bounded PNGs with macOS `sips` or Poppler `pdftoppm`; without either converter, the PDF tile remains labeled and the native DSH tab remains available. Full-screen PDF display shows its first page, while the native tab handles additional pages.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/README.md) — opt-in publication and dependency policy.
- [Web bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md) — the profile hosting this plugin.
- [Focused store tests](tests/store.spec.ts) — source conflicts, anchors, locks and human baselines.
- [Real composition test](tests/composition.spec.ts) — scripted agent-loop calls, authentication and disposal.
- Browser tests live in the DSH checkout, outside this source repository.

-----

<a id="model-experience"></a>
## Model Experience

### Manuscript tools

#### What the model sees

The model receives `paper_list` and `paper_open` before a manuscript opens. An enabled review session also receives native `paper_read`, `paper_annotations`, `paper_propose`, `paper_revise`, `paper_check`, `paper_decide` and six `paper_bib_*` schemas; the exact schemas are recorded in the [composition snapshot](tests/__snapshots__/composition.spec.ts.snap). Reads return exact block ids, source, revision and locks. Proposals return their id, status, lexical flags and `manuscriptWritten: false`. Checks report whether pending replacements still match unlocked source; passing a proposal ID also returns that proposal's full content. `paper_revise` keeps the proposal ID and manuscript untouched. `paper_decide` can reject or accept a pending proposal after conflict checks. BibTeX add/replace writes only a bound `.bib` file and reports `metadataVerified: false`. The model retains ordinary tools allowed by its DSH permission mode.

#### Token effect

Two discovery schemas remain available before opening a manuscript; twelve active schemas join the ordinary model tool list afterward. Exiting hides those twelve schemas for the next turn; it does not remove earlier tool results from session history. A full read can include the entire manuscript up to the configured byte cap. Reading one block includes its adjacent blocks. Inspecting a proposal or revising it returns its full edit group. The BibTeX index returns metadata for every bound entry, so large libraries also increase tool-result size. Proposal and annotation histories are retained locally without a pruning limit.

#### KV Cache effect

Stable tool schemas may preserve an existing reusable prefix; toggling this plugin or changing tool definitions can invalidate it. New tool results append history. This plugin neither promises provider caching nor issues an independent reviewer request.

### Explicitly attached local context

#### What the model sees

The editable user-message draft contains the path, reader revision, selected blocks, adjacent source and selected annotations. The active interface language selects the [localized instructions](src/client/locales.ts); the English rule is quoted below. Nothing is submitted until the user sends the native composer draft.

##### English editing instruction

```markdown
Only change the selected blocks. Read with paper_read, then submit each independent change with paper_propose. For an existing pending proposal, inspect it with paper_check and revise it in place with paper_revise; do not create another proposal. Group dependent edits. Preserve numbers, citations and scientific claims unless explicitly instructed. Do not strengthen causality, generalizability, novelty, significance or superiority. If evidence is missing, report it. Never treat a mechanical check as scientific validation.
```

#### Token effect

Attached blocks and annotations add a user message only when submitted. Neighbor context is explicit; this operation does not silently attach the entire manuscript. Multiple selected annotations can produce a large draft, which the user can inspect before sending.

#### KV Cache effect

Submitted context appends to the conversation. Changed quotations, revisions, annotations or interface language change the new message, not earlier retained messages. Provider cache reuse remains outside this plugin's control.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This local single-author Markdown prototype has the following limits.

- PDF, Word and LaTeX sources, tracked document export, paragraph insertion/deletion/movement and cross-block Markdown reference resolution are not implemented. Proposals replace complete blocks of the same Markdown type; related replacements can be grouped.
- Mechanical numeric, citation, figure, Methods and claim-word checks are incomplete lexical signals, not a scientific audit. Real-provider quality and an independent reviewing model remain unverified; the automated model responses are scripted.
- Selections stay within one Markdown block. Cross-block selections receive an explicit message; add separate notes and submit them together. Highlights require a browser with the CSS Custom Highlight API. A changed source block marks its rendered selections **Needs location**, even if the quoted words survive elsewhere. Automatic fuzzy matching and manual reanchoring are not implemented; preserve the old record and create a new one at the intended passage.
- Locks apply to this plugin, not external editors. A noncooperating writer can race the final check and rename. Atomic replacement and the journal address process interruption, not guaranteed power-loss durability or hostile local filesystem mutation.
- The Finder chooser opens on the macOS DSH host, not on a remote browser's computer. Remote and unattended host deployments should select a known workspace path with `paper_open`. Ordinary write tools can bypass proposal review, so use DSH's permission mode and explicit instructions when author approval is required.
- The Git release does not install `koffi` automatically because this native dependency is used only for Windows workspace locking. Windows installation and operation are not yet verified; Windows requires `koffi` in the same profile before the plugin can open a manuscript.
- Full revisions and annotations are retained without pruning or a restore button. Large histories can consume disk and slow state loading; the reader and review comparisons mount near the viewport, but version comparison remains eager. The workspace lock permits one server process, with multiple browser windows; it is not multi-author synchronization.
- BibTeX indexing accepts ordinary complete entries but does not expand macros or validate bibliographic truth. New in-text citations are checked in proposed block replacements, not in unrelated direct file writes. The references tab flags possible bare keys conservatively; a scientific term can resemble a key and needs human judgment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The deterministic composition and browser tests cover integration without contacting a model provider. They do not establish scientific review quality.

</details>
