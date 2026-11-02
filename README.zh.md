---
description: "在 DSH 中阅读、批注与修改 Markdown 稿件，查看 AI 提案、逐词差异及相对上次审阅的累计变化。"
kind: "package-bundle"
---

# DSH Article Review

[English](README.md) | 中文

在 [DSH](https://github.com/deepseek-ai/deepseek-harness) 对话旁读论文、写批注、与 AI 逐段修稿。AI 提交修改提案，你查看差异、接受、拒绝或要求重写。

经历多轮修改后，每段仍对照**你最后确认已审的版本**，待审变化一目了然。

![查看 AI 提案的渲染效果与源码差异](docs/screenshots/review-proposal.png)

*截图使用虚构稿件，含真实模型提案。*

## 核心功能

- **从文章开始**：固定的 `paper-project-start` skill 支持 PDF、DOCX、LaTeX、TXT、Markdown、HTML 和粘贴正文，保留原稿，准备已有图片并打开阅读器。
- **阅读批注**：高亮、下划线、评论与全文搜索。
- **图文对照**：整图或 AI 切分的 panel 与正文一起阅读，可选小节分页，切换时保留位置。见[阅读指南](docs/user-guide.zh.md#图文对照与小节分页)。
- **AI 修稿**：替换、增删和重写提案，支持标题、列表、表格。
- **审阅进度**：标记、锁定已审段落，追踪后续变化。
- **版本对比**：逐词对比与 Markdown 源码差异。
- **图表审阅**：预览、提议换图，保留前后副本。
- **配套文档预览**：使用 DSH 原生预览打开 Markdown、PDF、Office 等文件，保留当前审稿状态。
- **文献管理**：绑定 BibTeX，定位引用，检查新增引用键。
- **论文项目（预览）**：围绕论证来写和审一篇论文：核心论点、故事流、分论点，以及每个分论点背后的论据和图表面板；agent 以编辑、审稿人和读者的身份审阅。已有稿件可以转成项目。见[论文项目](#论文项目预览)。

<a id="installation"></a>
## 安装

`0.2.2-alpha.17` 支持 DSH Web `0.2.1-alpha.4` 和 Desktop `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.2-alpha.2`，沿用现有模型配置。

注册表 `latest` 指向 `0.2.2-alpha.17`。pnpm 11 默认有 24 小时新包观察期，当天裸名安装仍可能选择旧版。今天可填写完整版本 `dsh-article-review@0.2.2-alpha.17`，或按[说明仅对此包允许即时安装](docs/installation-channels.md#中文)；观察期后可直接使用裸名。

### Desktop App

App 自带运行环境，无需另装 Node。

1. 在 App 左侧打开 **Plugins（插件）**，点击 **Add plugin（添加插件）**。
2. 粘贴 npm 包名：

   `dsh-article-review`

3. 安装完成后点击 **Enable now（立即启用）**，按提示重启。
4. 选择本地工作区并打开一个对话，在右侧栏选择**阅读、批注与局部修改**。
5. 点击**浏览工作区 → 选择本地文件**打开 Markdown 稿件。系统选择窗口属于 App，文件必须位于当前对话工作区内。BibTeX 和替换图片也使用同一 Desktop 选择器。

Desktop 使用独立的 `desktop` 配置，安装到 `web` 不会同时安装到 App。若之前通过 GitHub 安装了旧包 `@deepseek-ai/dsh-experimental-paper-review`，先在 Plugins 中卸载旧包，再安装上述 npm 包并按提示重启；工作区中的 `.paper-review/` 审阅记录继续使用。macOS Desktop 已实测；Windows 要求见[支持范围与兼容性](docs/development.zh.md#scope-and-compatibility)。

可选择 npm 官方源或中国大陆镜像。镜像尚未同步新版本时，先切回官方源。GitHub 安装地址为 `github:Biogod2020/dsh-article-review#v0.2.2-alpha.17`。若 GitHub 地址连接超时，可下载[预构建发行归档](https://codeload.github.com/Biogod2020/dsh-article-review/tar.gz/refs/tags/v0.2.2-alpha.17)，在 **Plugins → Add plugin** 中输入本地归档的绝对路径，无需解压或构建。`v0.2.1-alpha.1` 及更早 tag 保留旧包名，两种包名请选择一种安装。

### Web

DSH `0.2.2-alpha.2` 需要 Node.js 24.9 或更新版本；此前支持的 DSH 版本沿用各自的 Node.js 要求（22 ≥22.19 或 24+）：

```sh
dsh plugin --profile web add dsh-article-review
dsh web
```

安装后重启正在运行的 Web 配置。GitHub 安装请使用预构建 tag；`main` 是开发源码。

## 开始审阅

导入文档或粘贴正文时，在阅读器文件操作区点击**导入文章**，或在对话中使用 `/paper-project-start` 并指定原稿。转换结果保存在当前对话工作区的新目录中。首次运行通过 `uv` 在项目内准备转换工具；无图文章跳过裁切，扫描件需要 OCR 和核对。见[文章导入说明](docs/user-guide.zh.md#从文章开始)。

1. 在右侧栏选择**阅读、批注与局部修改**，打开 Markdown 稿件。
2. 选中文字添加批注，附到对话输入框，发送修改要求。
3. 在**审阅变更**中接受、拒绝或要求重写，检查后确认已审。

接受提案更新正文，保留已审基线。审阅记录位于 `.paper-review/`，随稿件备份，勿提交公开仓库。段落锁仅约束本插件。

## 论文项目（预览）

在右侧栏选择**论文**。打开一个含 `project.json` 的文件夹，或者填写**从已有稿件初始化**：稿件可以是 PDF、Word、LaTeX、Markdown，可选填图、已有意见和论文所在的研究仓库。面板会给出默认的项目文件夹，并在交给对话中的 agent 之前检查每个路径。

- **初始化像人一样读稿**：agent 逐页阅读稿件，把正文抄成项目里的纯文本；在带坐标网格的页面上看图，裁出每张图和每个面板；再整理论证，把段落对应到分论点。检查脚本对照原稿，指出漏抄的页、改写过的段落、粘贴留下的痕迹和裁坏的图。整个过程由面板分轮推进，显示进度，可以暂停、继续（重启后也能继续）或停止。原始文件和仓库都只读不改。
- **审论证**：故事流画布显示核心论点、各拍和分论点，以及每个分论点下的论据和面板；可以标为已审，之后的改动会标出来。
- **阅读**：分页阅读，每页旁边显示这一页引用的图表面板；选中文字可以写意见。
- **意见与草稿**：人和模拟的编辑、审稿人、读者都可以写意见；agent 直接修改论点和图，段落改写则以草稿形式等你接受或放弃。

项目模式在 DSH 0.2.1-alpha.4 上开发和测试。设计说明见 [docs/project-mode.zh.md](docs/project-mode.zh.md)。

## 操作截图

选中文字，右键添加高亮或批注。

![选区操作菜单](docs/screenshots/select-text.png)

保存批注，把修改要求附到对话。

![批注与高亮](docs/screenshots/annotate.png)

查看已审进度，跳转章节与段落。

![审阅进度与导航](docs/screenshots/review-outline.jpg)

比较两个版本，直接查看字词变化。

![版本对比](docs/screenshots/versions-rendered.jpg)

预览 PDF、审阅换图、浏览文献。

![PDF 预览](docs/screenshots/figure-pdf.jpg)

![换图前后对比](docs/screenshots/figure-replacement.jpg)

![文献浏览](docs/screenshots/references.jpg)

窄屏也能顺畅阅读。

<img src="docs/screenshots/narrow-zh-light.jpg" alt="窄屏阅读" width="360">

## 文档

- [使用指南](docs/user-guide.zh.md)：操作与配置。
- [开发与兼容性](docs/development.zh.md)：构建、工具与持久化。
- [论文项目](docs/project-mode.zh.md)：项目模式的设计与验证说明。

编辑 Markdown 稿件，图表支持图片与 PDF。[其他格式与平台](docs/development.zh.md#scope-and-compatibility)。

[MIT 许可证](LICENSE)
