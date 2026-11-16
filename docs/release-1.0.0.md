# 1.0.0 — paper projects and DSH 0.2.1-rc.5

This release ships the two ways to work described in the [README](../README.md): manuscript review, and paper projects. A paper project builds a project folder around the argument of an existing PDF, Word, LaTeX or Markdown paper, with an argument map, simulated editor, reviewer and reader comments, and rewrite drafts. Your original files are never changed. See [paper projects](project-mode.zh.md).

**DSH compatibility:** adds DSH `0.2.1-rc.5`, the current `next` release, and keeps every host supported by `0.2.2-alpha.17` (Desktop `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.2-alpha.2`, Web `0.2.1-alpha.4`). The only functional change from rc.4 to rc.5 is in the Web chat's thinking-block rendering (`dsh-client-ui-chat`), which this plugin does not use. The plugin needs no source changes for rc.5. The quality, publish and installation workflows add an rc.5 lane.

**Other fixes:** PDF imports keep full titles, and the importer warns when a thesis title is only a label.

Manuscript review storage (`.paper-review/`) and its data format are unchanged. Installed profiles and lockfiles need an explicit update. Windows Desktop has not received a new hands-on hardware check.

## 中文

本版正式提供 [README](../README.zh.md) 中的两种用法：稿件审阅和论文项目。论文项目从已有的 PDF、Word、LaTeX 或 Markdown 论文出发，围绕其论证建立项目文件夹，包括论证图、模拟编辑/审稿人/读者意见和改写稿，不修改原始文件。见[论文项目](project-mode.zh.md)。

**DSH 兼容性：** 新增 DSH `0.2.1-rc.5`（当前 `next` 版本），并保留 `0.2.2-alpha.17` 支持的全部宿主（Desktop `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.2-alpha.2`，Web `0.2.1-alpha.4`）。rc.4 到 rc.5 唯一的功能改动是 Web 聊天中思考块的渲染（`dsh-client-ui-chat`），本插件未使用，因此 rc.5 无需修改源码。质量、发布和安装工作流新增 rc.5 测试。

**其他修复：** PDF 导入保留完整标题；学位论文标题只有标签时给出提示。

稿件审阅的存储目录（`.paper-review/`）与数据格式不变。已有安装和锁文件仍需显式更新。Windows Desktop 本轮未新增真实硬件界面验收。
