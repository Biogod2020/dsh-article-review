---
description: "Read, annotate and revise Markdown manuscripts in DSH with AI proposals, word-level diffs and persistent review baselines."
kind: "package-bundle"
---

# DSH Article Review

English | [中文](README.zh.md)

Read, annotate and revise Markdown manuscripts alongside your [DSH](https://github.com/deepseek-ai/deepseek-harness) conversation. AI submits revision proposals; you inspect the changes, accept or reject them, or request another revision.

Across multiple revision rounds, each paragraph stays compared with **the last version you marked reviewed**, so you can see what still needs your attention.

![Review an AI proposal with rendered and source differences](docs/screenshots/review-proposal.png)

*Screenshots use fictional manuscripts; proposals include real model runs.*

## Features

- **Read and annotate** — highlights, underlines, comments and manuscript search.
- **Revise with AI** — propose replacements, insertions or deletions; revise pending proposals. Supports headings, lists and tables.
- **Track your review** — mark and lock reviewed paragraphs; track later changes.
- **Compare versions** — word-level comparisons and exact Markdown source diffs.
- **Review figures** — preview and propose replacements; keep before/after copies.
- **Manage references** — bind BibTeX, jump to citations and check new citation keys.

<a id="installation"></a>
## Install

Supports DSH Desktop and Web `0.2.0-rc.2`. Uses your existing model configuration.

### Desktop App

The App includes its runtime; no separate Node installation is needed.

1. Open **Plugins** in the App's left sidebar, then click **Add plugin**.
2. Paste this prebuilt release address:

   `github:Biogod2020/dsh-article-review#v0.2.0-rc.3`

3. After installation, click **Enable now** and follow any restart prompt.
4. Choose a local workspace and open a conversation. In the right sidebar, choose **Read, annotate and revise**.
5. Click **Browse workspace → Choose local file** to open a Markdown manuscript. The system dialog belongs to the App; the selected file must be inside this conversation's workspace. BibTeX and replacement figures use the same Desktop picker.

Desktop uses its own `desktop` profile. Installing into the `web` profile does not install into the App. If updating from an older plugin, install the release address above and follow the App's reload or restart prompt. macOS Desktop has been exercised; see [platform requirements](docs/development.md#scope-and-compatibility) for Windows.

If the GitHub address times out, download the [prebuilt release archive](https://codeload.github.com/Biogod2020/dsh-article-review/tar.gz/refs/tags/v0.2.0-rc.3), save the downloaded `.tar.gz` file locally, and enter that file’s absolute path in **Plugins → Add plugin**. The archive already includes `lib/index.js` and `lib/client.js`; no extraction or build is needed.

### Web

Requires Node.js 22 (≥22.19) or 24+:

```sh
dsh plugin --profile web add 'github:Biogod2020/dsh-article-review#v0.2.0-rc.3'
dsh web
```

Restart a running Web profile after installation. Use the prebuilt tag; `main` contains development source.

## Start reviewing

1. Choose **Read, annotate and revise** in the right sidebar and open a Markdown manuscript.
2. Select text, annotate it, attach the notes to the conversation and send your request.
3. In **Review changes**, accept, reject or request a revision; check the result and mark it reviewed.

Accepting updates the manuscript and keeps your review baseline. Back up `.paper-review/` with the manuscript and exclude it from public Git history. Paragraph locks apply within this plugin.

## Screenshots

Select text and right-click to highlight or annotate.

![Selection actions](docs/screenshots/select-text.png)

Save annotations and attach revision requests to the conversation.

![Annotations and highlights](docs/screenshots/annotate.png)

Check review progress and jump to sections or paragraphs.

![Review progress and navigation](docs/screenshots/review-outline.jpg)

Compare two versions and see changed words directly.

![Version comparison](docs/screenshots/versions-rendered.jpg)

Preview PDFs, review figure replacements and browse references.

![PDF preview](docs/screenshots/figure-pdf.jpg)

![Figure replacement](docs/screenshots/figure-replacement.jpg)

![Reference browser](docs/screenshots/references.jpg)

Compact reading on narrow screens.

<img src="docs/screenshots/narrow-zh-light.jpg" alt="Narrow-screen reading" width="360">

## Documentation

- [User guide](docs/user-guide.md) — operations and configuration.
- [Development and compatibility](docs/development.md) — builds, tools and persistence.

Edit Markdown manuscripts; figures support images and PDFs. See [other formats and platforms](docs/development.md#scope-and-compatibility).

[MIT License](LICENSE)
