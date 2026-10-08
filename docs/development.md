# Development and compatibility

English | [中文](development.zh.md)

This document covers local builds, manuscript tools, persistence and platform compatibility. For everyday use, see the [user guide](user-guide.md).

## Git installation

For installation commands, see the [project README](../README.md#installation). The installer adds the package's [bundle patch](../cordis.patch.yml) after the Web layer; no separate launcher or model configuration is needed. This independent add-on was smoke-tested on macOS with DSH `0.2.0-rc.2`. Host/client types and integration tests use the pinned upstream tag `dsh-v0.2.0-rc.2` (`639ed015`). For other hosts, see [scope and compatibility](#scope-and-compatibility).

The browser receives the current manuscript plus a revision index; historical bodies load only for the selected comparison pair. Reader blocks share viewport observers. PDF previews share a byte-bounded cache and converter queue (`previewCacheBytes`, default 4194304; `previewConcurrency`, default 1). See the [performance measurements](performance.zh.md).

## Local development

Build the plugin inside a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) checkout, then install the built local directory:

```sh
dsh plugin --profile web add /absolute/path/to/deepseek-harness/packages/experimental/paper-review
```

The installation links to the local directory, so keep the checkout in place. Rebuild after source changes; refresh the page for client changes and reload the plugin or restart DSH for host changes. The `main` branch uses `workspace:*` / `workspace:~` dependencies; for direct Git installation, use the prebuilt tag in the project README.

## Validation

```sh
npm run test:setup
npm test
npm run typecheck:core
DSH_HARNESS_ROOT=/absolute/path/to/deepseek-harness npm run test:harness
```

The full lane checks host/client types separately and runs the native composition tests against the installed upstream checkout. It never edits that checkout. See the [hands-on review](experience-review.zh.md) for the DSH 0.2 test matrix and remaining issues.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [host](../src/index.ts) adds manuscript discovery, review and BibTeX tools to the ordinary agent tools. Authenticated operator requests use Connection's `/api` carrier; model tools derive the session from the executing agent. Enabled sessions and their selected manuscript paths persist in the workspace's private review directory and restore before a resumed agent runs. Exit hides active manuscript tools while retaining review records and ordinary tools. Inactive sessions can still use `paper_list` and `paper_open`. The plugin does not override DSH's configured permissions, and its paragraph locks do not prevent direct file writes through other tools.

The [store](../src/store.ts) serializes actions and holds an exclusive kernel-backed workspace lock. The kernel releases it when the server exits, including after a crash. An existing `owner.lock` from an older plugin process blocks startup while its recorded PID is alive; a dead PID is admitted under the kernel lock, and the old file is removed on a clean close. An invalid or unverifiable owner record still requires manual inspection. Do not remove `owner.kernel.lock` while a server may be using the workspace. In-place proposal revision checks the displayed revision, disk source, annotations, exact block text and locks before updating only private review state; omitted fields stay unchanged, while a supplied edits array replaces the full edit group. A stale pending proposal can be rebased in place by supplying the new base revision and complete edits against exact current blocks; its ID and pending status remain unchanged. Insertions remain applicable after unrelated revisions when their exact anchor id and source survive. Acceptance inserts beside that current anchor; changed, missing or locked anchors still block it. Acceptance repeats source and lock checks before writing. It saves a recovery journal, atomically replaces the source, commits state, and removes the journal. On restart, a matching before/after source hash resolves an interrupted acceptance; a third hash refuses further work and preserves the journal for manual reconciliation.

The [Markdown parser](../src/document.ts) retains source offsets and assigns durable block ids. Unique unchanged blocks survive insertions; accepted replacements explicitly preserve identity. Ambiguous external rewrites detach annotations instead of guessing. The [panel](../src/client/panel.tsx) uses the native sidebar and composer without changing core DSH packages. No runtime invariant companion is published: the store validates persisted state and owns every state transition; there is no separately cached runtime observation to reconcile.

The [selection reader](../src/client/reader-text.tsx) mounts Markdown near the visible scroll area and paints DOM ranges through the CSS Custom Highlight API; it does not insert markup into React-owned text. It displays pipe tables with em-dash divider rows as tables in reading and rendered comparisons without changing the saved Markdown or block identities. Changed tables retain block borders instead of word-level coloring. Saved rendered anchors include the selected offset, quote, surrounding text and exact block source. Any source change to that block detaches its rendered anchors rather than guessing how formatting changed. Existing private schema-version-1 records remain readable with an empty highlight list; older raw-source annotations retain their original matching rules. Highlight removal is reversible. Paint registrations and menu listeners are disposed with their components.

The [review panel](../src/client/panel.tsx) keeps proposal summaries, risk flags and decisions mounted while it defers offscreen comparisons. Each comparison parses both sides once; its exact Markdown source diff is computed only while expanded. Browsers without IntersectionObserver render every comparison immediately.

[Figure references](../src/figures.ts) come from explicit captions and ordinary Markdown images. The host confines paths and snapshot folders to the workspace, limits retained bytes, and checks snapshot hashes again before acceptance. Retained old images survive later changes to the original file; historical versions without snapshots cannot recover previously overwritten bytes. [Small previews](../src/client/figure-preview.tsx) load near the viewport and release blob URLs when collapsed or unmounted. PDF first pages become bounded PNGs with macOS `sips` or Poppler `pdftoppm`; without either converter, the native DSH tab remains available. Preview failures never select a different figure.

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/README.md) — opt-in publication and dependency policy.
- [Web bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md) — the profile hosting this plugin.
- [Focused store tests](../tests/store.spec.ts) — source conflicts, anchors, locks and human baselines.
- [Real composition test](../tests/composition.spec.ts) — scripted agent-loop calls, authentication and disposal.
- Browser tests live in the DSH checkout, outside this source repository.

<a id="model-experience"></a>
## Model Experience

### Manuscript tools

#### What the model sees

The model receives `paper_list` and `paper_open` before a manuscript opens. An enabled review session also receives native `paper_read`, `paper_annotations`, `paper_propose`, `paper_revise`, `paper_delete`, `paper_check`, `paper_decide` and six `paper_bib_*` schemas; the exact schemas are recorded in the [composition snapshot](../tests/__snapshots__/composition.spec.ts.snap). Reads return exact block ids, source, revision and locks. In an edit, use `insert-before` or `insert-after` with the anchor block's exact `before` text and a complete Markdown fragment in `after`; lists, tables, quotes, code and multiple blocks are permitted. Omit `operation` to replace a block with any complete Markdown fragment, or set `after` to an empty string to propose deletion. For compatibility, an omitted `operation` also inserts when `after` contains the exact unchanged anchor beside blank-separated new blocks. Proposals return their id, status, lexical flags and `manuscriptWritten: false`. Checks report whether pending edits still match unlocked source; passing a proposal ID also returns that proposal's full content. `paper_revise` keeps the proposal ID and manuscript untouched. `paper_decide` can reject or accept a pending proposal after conflict checks. BibTeX add/replace writes only a bound `.bib` file and reports `metadataVerified: false`. The model retains ordinary tools allowed by its DSH permission mode. `paper_figure_list` reads exact references and retained hashes. `paper_figure_replace` retains both files and returns `originalFilesWritten: false`; it never rewrites caption prose. Supplying a pending `proposalId` preserves other edits while changing its image destination. Acceptance still checks source, locks, and snapshot hashes through `paper_decide`.

#### Token effect

Two discovery schemas remain available before opening a manuscript; fifteen active schemas join the ordinary model tool list afterward. Exiting hides those fifteen schemas for the next turn without removing earlier results. Full reads return whole blocks in revision-pinned pages (40 blocks / 32,000 characters by default); a block read includes neighbors. Proposal inspection and revision return the full edit group. Figure tools return paths and hashes, not image bytes, so the model must inspect the artwork separately. BibTeX indexes return all bound metadata. Large libraries, proposals and histories increase tool-result size; local histories have no pruning limit.

#### KV Cache effect

Stable tool schemas may preserve an existing reusable prefix; toggling this plugin or changing tool definitions can invalidate it. New tool results append history. This plugin neither promises provider caching nor issues an independent reviewer request.

### Explicitly attached local context

#### What the model sees

The editable user-message draft contains the path, reader revision, selected blocks, adjacent source and selected annotations. The active interface language selects the [localized instructions](../src/client/locales.ts); the English rule is quoted below. Nothing is submitted until the user sends the native composer draft.

##### English editing instruction

```markdown
Only change the selected blocks; insert complete Markdown before or after an exact anchor when the author requests new material. Read with paper_read, then submit each independent change with paper_propose. For an existing pending proposal, inspect it with paper_check and revise it in place with paper_revise; do not create another proposal. Group dependent edits. Preserve numbers, citations and scientific claims unless explicitly instructed. Do not strengthen causality, generalizability, novelty, significance or superiority. If evidence is missing, report it. Never treat a mechanical check as scientific validation.
```

#### Token effect

Attached blocks and annotations add a user message only when submitted. Neighbor context is explicit; this operation does not silently attach the entire manuscript. Multiple selected annotations can produce a large draft, which the user can inspect before sending.

#### KV Cache effect

Submitted context appends to the conversation. Changed quotations, revisions, annotations or interface language change the new message, not earlier retained messages. Provider cache reuse remains outside this plugin's control.

## Scope and compatibility
The Desktop update was exercised on macOS with DSH App `0.2.0-rc.2` and fictional files: manuscript selection, cancel and retry, BibTeX binding, figure proposal and rejection, annotation persistence and native composer context. Host/client type checks and 239 rc.2 integration tests passed. Windows Desktop has not been exercised on a real machine.


<a id="scope-and-compatibility"></a>
<a id="known-limitations-and-deferred-work"></a>

The plugin reviews local Markdown manuscripts with one server process and multiple browser windows. The following notes cover formats, platforms and concurrent access.

- PDF, Word and LaTeX sources, tracked document export, block movement and cross-block Markdown reference resolution are not implemented. Proposals can replace or delete exact blocks, or insert complete Markdown fragments beside exact anchors; dependent edits can be grouped.
- Numeric, citation, figure, Methods and claim-word checks flag lexical changes for author review. Authors assess their scientific meaning and evidence support. Automated integration tests use scripted model responses; real-model revision quality requires separate evaluation.
- Selections stay within one Markdown block. Cross-block selections receive an explicit message; add separate notes and submit them together. Highlights require a browser with the CSS Custom Highlight API. A changed source block marks its rendered selections **Needs location**, even if the quoted words survive elsewhere. Automatic fuzzy matching and manual reanchoring are not implemented; preserve the old record and create a new one at the intended passage.
- Locks apply to this plugin, not external editors. A noncooperating writer can race the final check and rename. Atomic replacement and the journal address process interruption, not guaranteed power-loss durability or hostile local filesystem mutation.
- Desktop uses its window-owned system file dialog and the DSH `__DSH_HOST_PATHS__` preload bridge for manuscripts, BibTeX and replacement figures. Canceling or closing the picker ends the pending request. The host validates the selected absolute path, extension and real workspace boundary before returning a relative path. Web retains its macOS host chooser; it opens on the host computer. Browse workspace and `paper_open` work on remote hosts. Ordinary write tools can bypass proposal review, so use DSH's permission mode and explicit instructions when author approval is required.
- The Git release does not install `koffi` automatically because this native dependency is used only for Windows workspace locking. Windows installation and operation are not yet verified; Windows requires `koffi` in the same profile before the plugin can open a manuscript.
- Full revisions and annotations are retained without pruning or a manuscript restore button. Large histories can consume disk and slow state loading; the reader, review comparisons and rendered version blocks mount near the viewport. The references list shows at most forty entries per page. The workspace lock permits one server process, with multiple browser windows; it is not multi-author synchronization.
- BibTeX indexing accepts ordinary complete entries but does not expand macros or validate bibliographic truth. New in-text citations are checked in proposed replacements and insertions, not in unrelated direct file writes. The references tab flags possible bare citation keys; scientific terms can also trigger a flag and need contextual review.
