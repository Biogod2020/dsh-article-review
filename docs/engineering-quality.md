# Review-quality upgrade

This source upgrade strengthens the native DSH manuscript-review workflow. It does not replace the reader with an autonomous journal referee or claim benchmark-leading scientific judgment.

## What changed

### Source-grounded change evidence

`src/change-audit.ts` detects changed ordered lexical tokens and retains their exact UTF-16 source offsets. It adds coverage for signs, statistical comparators, leading-dot decimals, exponents, comma-grouped numbers, common dose/concentration/time units, and unit powers. Whitespace and equivalent micro/minus glyphs are normalized; SI-unit case is retained. Ordered comparison catches swapped values that a set comparison would miss.

The UI and `paper_check` show bounded examples with full counts and an explicit truncation flag. The default is 12 tokens per side per changed category. A model's `style` label cannot suppress a detected numerical change in the review queue. Categories are routing aids, not severity probabilities or a scientific safety score. Examples:

| Before | After | Review cue |
| --- | --- | --- |
| `p < 0.05` | `p > 0.05` | Statistical comparison changed |
| `-0.8` | `+0.8` | Sign changed |
| `10 ng` | `10 pg` | Dose unit changed |
| `5 mmol/L` | `5 mmol/mL` | Concentration denominator changed |
| `may improve` | `improves` | Qualification removed |

Methods context now follows nested headings and ends at the appropriate sibling section. Duplicate/ambiguous block identity is still conservative. Overlapping quotations such as `aba` in `ababa` no longer become falsely unique. Revision identity matching uses an index rather than scanning all old/new blocks for every block; seeded differential tests preserve the original uniqueness policy.

### One mechanical acceptance preflight

`PaperStore.check` and actual acceptance use `prepareAcceptance`. The preflight checks disk/source freshness, exact anchors, human locks, retained figure hashes, proposal constraints, bound new citation keys, complete Markdown fragments and resulting byte limits. The selected proposal and its check are read in one serialized operation. `paper_check` returns `applicable`, actionable `blockers`, fresh flags where validation completes, and source-grounded evidence. It reports `scientificallyVerified: false` explicitly.

A successful check is only a snapshot. Accepting rechecks everything and still uses the existing journal/atomic-write path. A failed check does not settle the proposal or modify manuscript bytes. Bound bibliography metadata establishes citation-key availability, not whether a paper supports a claim.

### Revision-pinned whole-block pagination

Legacy `paper_read({path})` behavior remains available. For long manuscripts, start with:

```json
{"path":"article.md","startBlock":0,"maxBlocks":40,"maxCharacters":32000}
```

Continue with `page.nextStartBlock` and the returned `revision`. Stop when `nextStartBlock` is null. A continuation without the revision, a stale revision, invalid limits, or combining `blockId` with pagination is rejected. `maxBlocks` is 1–200; `maxCharacters` is 1,000–200,000.

The character budget is **soft for the first indivisible block**. A large table/block is returned whole with `exceededCharacterBudget: true`, never silently truncated into unsafe `before` text. UTF-16 character counts are not model token counts. This does not bound histories, bibliography indexes or full proposal inspections.

### Review queue

Filter pending proposal groups by all, needs judgment, wording, structure, claim or evidence. Counts remain visible, filters preserve source order and complete dependent groups, and clearing a filter restores hidden proposals. Filtering never accepts/rejects, locks or marks text reviewed. Search follows the visible filtered queue. The interface is available in Chinese and English.

## Reproduce the checks

### Portable core: no DSH checkout or model credentials

Use Node 22.19+ or Node 24+:

```sh
npm run test:setup
npm test
npm run typecheck:core
```

The separate `validation/package.json` and lockfile deliberately avoid installing the source package's `workspace:^` dependencies. `npm ci --ignore-scripts` installs only pinned public test packages. This lane tests shared logic and the new evidence component, **not the native host or all reader UI**. The CI matrix runs this lane on Linux, macOS and Windows with Node 22 and 24; a green portable Windows job does not certify native Windows file locking.

### Full native integration and host/browser types

```sh
DSH_HARNESS_ROOT=/absolute/path/to/installed/deepseek-harness npm run test:harness
```

The supplied harness must already have workspace dependencies and native addons built. The runner stages this repository's source/tests in a temporary directory, links installed dependencies, checks host and browser types separately, then runs all native tests. It cleans up the temporary copy and never edits the supplied harness. It does not start the user's application, update installed plugin bundles or publish a release. Snapshot updates are intentionally refused by this disposable runner; update and inspect them in a development checkout.

## Verification record for this change

Base source: `577ecad`. Native test dependencies: DeepSeek Harness `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`, Node 24.16.0, TypeScript 6.0.3 and Vitest 4.1.8 on macOS.

- The initial targeted regression set reproduced 10 failures in the original implementation; all 11 targeted cases pass after the fixes. This is a deliberately selected regression set, not an independent benchmark.
- Portable lane: 12 files, 66 passing tests, plus its strict type check. It was also run from a temporary copy without root `node_modules` or a harness checkout.
- Native lane: 31 files, 211 passing tests, including real filesystem persistence, two-process ownership/crash recovery, authenticated HTTP composition with scripted model responses, and browser component tests. Host and browser strict type checks pass separately.
- Three property tests contain 600 generated trials with seed `20260930`, covering conservative identity matching, accepted replacements and numerical signs. These trials are included within the test count, not 600 additional independent test cases.

These are local verification results, not a claim that remote CI or a production deployment has completed. The GitHub check status is authoritative for its own matrix runs.

## Remaining boundaries and the SOTA evaluation gate

Lexical checks can produce false positives and miss semantic changes, unusual units, embedded math and domain-specific phrasing. They do not establish causality, statistical correctness, novelty, citation support or clinical validity. A missing flag is not approval. No new scientific-verification model, external DOI resolver or live-provider evaluation was added in this change.

The source remains a local Markdown-oriented DSH plugin. Existing ordinary write tools or external editors can bypass the plugin's review path. Keep appropriate DSH permissions; these checks are not a global security boundary. Metadata/history retention and noncooperating filesystem races retain their documented limitations. Native Windows support and production browser accessibility/performance still require separate validation.

A defensible scientific-review SOTA claim needs a frozen, leakage-controlled evaluation set of real manuscript revisions with expert labels; baselines at matched model, tools and inference budget; per-category false-positive/false-negative rates; citation-support precision; accepted harmful-edit rate; author completion time; cost/latency; and blinded expert evaluation with uncertainty intervals. Compare this upgrade with the previous release and direct unstructured editing before claiming superiority. The current work provides repeatable engineering gates for that evaluation, not a fabricated leaderboard result.
