# 开发与兼容性

[English](development.md) | 中文

本文说明本地构建、稿件工具、持久化与平台兼容性。日常操作见 [使用指南](user-guide.zh.md)。

## Git 安装

安装命令见 [项目首页](../README.zh.md#installation)。安装器将本包的[组合配置](../cordis.patch.yml)加入 Web 层之后；无需额外启动器或模型配置。此独立插件已在 macOS + DSH `0.2.0-rc.2` 上完成启动检查。宿主/客户端类型与集成测试使用上游 `dsh-v0.2.0-rc.2`（`639ed015`）。其他平台的要求见 [支持范围与兼容性](#scope-and-compatibility)。

## 本地开发

在包含此插件的兼容 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作区中构建，然后安装已构建的本地目录：

```sh
dsh plugin --profile web add /absolute/path/to/deepseek-harness/packages/experimental/paper-review
```

此安装链接到本地目录，请保留该工作区。源码修改后需重新构建；客户端修改需刷新页面，宿主端修改需重新加载插件或重启 DSH。`main` 使用 `workspace:*` / `workspace:~` 依赖；直接 Git 安装请使用项目首页的预构建 tag。

## 验证

```sh
npm run test:setup
npm test
npm run typecheck:core
DSH_HARNESS_ROOT=/absolute/path/to/deepseek-harness npm run test:harness
```

完整流程分别检查宿主/客户端类型，并在已安装依赖的上游工作区上运行真实组合测试，不修改该工作区。[使用体验报告](experience-review.zh.md)记录 DSH 0.2 的实测和剩余问题。

<a id="understand-the-implementation"></a>
## 理解实现

[宿主端](../src/index.ts)在智能体原有工具之外增加稿件发现、审阅及 BibTeX 工具。经过认证的作者请求使用 Connection 的 `/api` 通道；模型工具从执行中的智能体取得会话标识。已启用会话及所选稿件路径保存在工作区私有审阅目录中，恢复会话时会先恢复这些状态。退出会隐藏活跃稿件工具，但保留审阅记录和普通工具。未启用的会话仍可使用 `paper_list` 与 `paper_open`。插件不会覆盖 DSH 已配置的权限，段落锁也不能阻止其他工具直接写文件。

[存储](../src/store.ts)串行处理操作，并通过系统级锁独占工作区；服务退出或崩溃后，系统会释放这把锁。旧版插件留下的 `owner.lock` 若记录的进程仍在运行，就会阻止启动；若进程已停止，新版插件会在持有系统级锁时继续，并在正常关闭时清理旧锁。无法验证的锁记录仍需人工检查。服务可能正在使用工作区时，不要删除 `owner.kernel.lock`。原位修改提案时会检查当前阅读版本、磁盘原文、批注、精确段落原文和锁定状态，只更新私有审阅状态；未提供的字段保持不变，提供 `edits` 时则替换整组修改。对已过期的待审提案，可提供新的基线版本及与当前段落原文完全匹配的整组修改，在原提案中重新对齐；ID 和待审状态不变。无关修改产生新版本后，只要锚点 id 和精确原文仍一致，插入提案就仍可接受。接受时在当前锚点旁插入；锚点变化、消失或锁定时仍拒绝。接受前会再次检查原文和锁定状态。随后保存恢复日志、原子替换原文、提交状态并删除日志。重启时，原文与操作前后任一哈希匹配即可处理被中断的接受；第三种哈希会拒绝后续操作，保留日志供人工协调。

[Markdown 解析器](../src/document.ts)保留原文偏移并分配持久段落 id。唯一且未变的段落可以跨插入操作保留身份；接受的替换显式保留身份。遇到不明确的外部重写，批注会脱离定位，不会猜测。[面板](../src/client/panel.tsx)使用原生侧栏和输入框，不修改 DSH 核心包。不发布运行时不变量配套模块：存储验证持久化状态并拥有全部状态转换，没有需要协调的独立运行时缓存观测。

[选区阅读器](../src/client/reader-text.tsx)仅在可见滚动区域附近挂载 Markdown，并通过 CSS Custom Highlight API 绘制 DOM 范围，不向 React 管理的文字中插入标记。阅读页和渲染后的对比页会把使用长破折号分隔行的管道表格显示为表格，不修改已保存的 Markdown 或区块身份。表格发生变化时只显示区块边框，不做逐词着色。渲染后选区保存偏移、引文、前后文和精确段落原文。该段原文发生任何变化时，选区都会标为待重新定位，不猜测格式如何变化。现有私有 schema-version-1 记录可继续读取，高亮列表默认为空；旧的原文批注沿用其匹配规则。移除高亮可以恢复。绘制注册和菜单监听器会随组件释放。

[审阅面板](../src/client/panel.tsx)始终显示提案摘要、风险标记和决定按钮，但会延后挂载屏幕外的对比内容。每组对比只解析一次两侧内容；精确的 Markdown 源码差异仅在展开时计算。不支持 IntersectionObserver 的浏览器会立即渲染全部对比。

[图引用](../src/figures.ts)从明确图注及普通 Markdown 图片中提取。宿主限制路径和快照目录位于工作区内、限制快照字节数，接受前再次核对哈希。保留的旧图不受原文件后续变化影响；没有快照的历史版本无法恢复此前被覆盖的图片。[小预览](../src/client/figure-preview.tsx)接近可见区域时加载，收起或卸载后释放 blob URL。PDF 首页用 macOS `sips` 或 Poppler `pdftoppm` 生成有界 PNG；没有转换器时仍可用 DSH 原生标签页查看。预览失败不会选择另一张图。

<a id="further-exploration"></a>
## 进一步阅读

- [实验包](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/README.md) — 可选发布与依赖策略。
- [Web 组合包](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md) — 承载此插件的配置。
- [存储专项测试](../tests/store.spec.ts) — 原文冲突、定位、锁定和人工基线。
- [真实组合测试](../tests/composition.spec.ts) — 脚本化 agent loop（智能体循环）调用、认证和资源释放。
- 浏览器测试位于 DSH 工作区，不在此源码仓库内。

<a id="model-experience"></a>
## 模型体验

### 稿件工具

#### 模型看到什么

打开稿件前，模型就能使用 `paper_list` 和 `paper_open`。启用审阅后，还会收到原生 `paper_read`、`paper_annotations`、`paper_propose`、`paper_revise`、`paper_delete`、`paper_check`、`paper_decide` 和六个 `paper_bib_*` schema；精确 schema 保存在[组合测试快照](../tests/__snapshots__/composition.spec.ts.snap)中。读取结果包含精确区块 id、原文、版本和锁定状态。插入时用 `insert-before` 或 `insert-after`，`before` 填锚点的精确原文，`after` 可填完整 Markdown 片段，包括列表、表格、引用块、代码和多个区块。省略 `operation` 可用完整 Markdown 替换区块，也可把 `after` 设为空字符串来提议删除。兼容旧调用：若 `after` 含未改动的锚点及用空行分隔的新区块，也会按插入处理。提案返回 id、状态、词面提示及 `manuscriptWritten: false`。检查结果说明待审修改是否仍匹配未锁定原文；提供提案 ID 后还会返回该提案的完整内容。`paper_revise` 保留提案 ID，不修改稿件。`paper_decide` 可在冲突检查后拒绝或接受待审提案。BibTeX 新增和替换只写已绑定的 `.bib` 文件，并返回 `metadataVerified: false`。模型仍保留 DSH 权限模式允许的普通工具。 `paper_figure_list` 读取精确图引用及快照哈希；`paper_figure_replace` 保留两张图并返回 `originalFilesWritten: false`，不改图注。传入待审 `proposalId` 可改其图片目标路径并保留其他编辑；接受仍由 `paper_decide` 核对原文、锁定状态及快照哈希。

#### Token 影响

打开稿件前可用两个发现 schema；启用后在普通工具之外增加十五个活跃 schema。退出后下一轮隐藏这十五个 schema，不移除早期结果。全文读取按固定版本分页，默认 40 个完整区块、32,000 字符；按区块读取含邻居；提案查看和修改返回完整修改组。图工具返回路径和哈希，不返回图片字节，模型仍需另行查看图像。BibTeX 索引返回全部绑定元数据。大型文献库、提案和历史会增加结果长度；本地历史没有裁剪上限。

#### KV Cache 影响

稳定工具 schema 可能保留已有可复用前缀；启停插件或修改工具定义可能使其失效。新工具结果追加历史。本插件不保证提供商缓存，也不发起独立复核模型请求。

### 显式附加的局部上下文

#### 模型看到什么

可编辑的用户消息草稿包含路径、阅读版本、选定段落、相邻原文及选定批注。界面语言决定使用哪组[本地化指令](../src/client/locales.ts)；英文规则原文如下。用户发送原生输入框草稿之前，不会提交任何内容。

##### 英文编辑指令

```markdown
Only change the selected blocks; insert complete Markdown before or after an exact anchor when the author requests new material. Read with paper_read, then submit each independent change with paper_propose. For an existing pending proposal, inspect it with paper_check and revise it in place with paper_revise; do not create another proposal. Group dependent edits. Preserve numbers, citations and scientific claims unless explicitly instructed. Do not strengthen causality, generalizability, novelty, significance or superiority. If evidence is missing, report it. Never treat a mechanical check as scientific validation.
```

#### Token 影响

附加段落和批注只在提交后形成用户消息。相邻上下文是显式的；此操作不会偷偷附加全文。选择多条批注可能形成较大草稿，用户可以先检查再发送。

#### KV Cache 影响

提交的上下文追加到会话。引文、版本、批注或界面语言的变化会改变新消息，不会改变此前保留的消息。提供商的缓存复用不受本插件控制。

## 支持范围与兼容性

<a id="scope-and-compatibility"></a>
<a id="known-limitations-and-deferred-work"></a>

插件面向本地 Markdown 稿件审阅，支持一个服务进程和多个浏览器窗口。以下说明文件格式、平台及并发行为。

- 尚未实现 PDF、Word、LaTeX 原稿、带修订痕迹的文档导出、区块移动以及跨区块 Markdown 引用解析。提案可以替换或删除精确区块，也可在精确锚点旁插入完整 Markdown 片段；相关修改可以分组。
- 数字、引用、图表、方法和论断词检查会提示文字变化，作者负责判断其科学含义及证据支持。自动化集成测试使用脚本化模型响应；真实模型的修改质量需单独评估。
- 选区限定在一个 Markdown 段落内。跨段选择会明确提示；可分别批注后一起提交。高亮需要支持 CSS Custom Highlight API 的浏览器。段落原文变化后，渲染选区会标为**需要重新定位**，即使引文仍出现在其他位置。尚未实现模糊匹配和手动重定位；请保留旧记录，在目标位置新建。
- 锁定只约束本插件，不约束外部编辑器。不配合的外部写入可能在最终检查与重命名之间竞争。原子替换和恢复日志针对进程中断，不保证突然断电持久性或抵御恶意本地文件系统修改。
- Finder 选择窗口打开在 macOS DSH 宿主上，不会在远程浏览器所在电脑上弹出。远程或无人值守的宿主应通过 `paper_open` 选择已知路径。普通写入工具可以绕过提案审阅；若必须由作者批准，请使用 DSH 权限模式并明确说明要求。
- Git 发行包不会自动安装 `koffi`，因为这个原生依赖只用于 Windows 工作区锁。Windows 上的安装与运行尚未验收；在 Windows 打开稿件前，需先在同一个配置中安装 `koffi`。
- 完整版本和批注持续保留，没有清理机制或稿件恢复按钮。长历史可能占用磁盘并拖慢状态载入；阅读区、审阅对比及渲染后的版本区块在接近可见区域时挂载。文献列表每页最多显示四十条。工作区锁允许一个服务器进程及多个浏览器窗口，不提供多作者同步。
- BibTeX 索引可处理普通完整条目，但不会展开宏或核实书目信息。新增正文引用会在本插件的替换和插入提案中校验，不会拦截其他工具直接写文件。文献库会提示疑似裸引用键；科学术语也可能触发提示，需结合上下文判断。
