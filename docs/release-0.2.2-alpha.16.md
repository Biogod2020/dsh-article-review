# 0.2.2-alpha.16

This release also normalizes local archive paths in release acceptance, preventing relative package paths from being mistaken for GitHub repositories.

This release adds DSH `0.2.1-rc.4` and `0.2.2-alpha.2` compatibility while retaining the older declared hosts. Install `dsh-article-review@0.2.2-alpha.16` from the npm `next` channel or the prebuilt GitHub tag.

DSH `0.2.2-alpha.2` removed `tools.presentAs`. Review now retains that host's selected executor, so entering or leaving review does not replace native or PTC execution. Older hosts retain the existing native presentation during review. Manuscript, annotation and human-review storage formats are unchanged.

Host/client type checks and all 298 integration tests pass separately against rc.3, rc.4 and 0.2.2-alpha.2. The tests exercise scripted model proposals, acceptance/rejection, ordinary tools after leaving review, figure panels and import skills. Portable tests and core type checks also pass. The exact archive is installed in isolated profiles to verify authentication, same-origin checks, browser-module delivery, manuscript opening, annotations, review baselines and restart recovery without model calls.

The release workflow requires rc.3, rc.4 and 0.2.2-alpha.2 acceptance before npm OIDC publication. After publication it compares the official npm and mainland mirror archives with the tested artifact and installs by package name from both registries in all three runtimes. Source quality CI also checks alpha.4, rc.4 and 0.2.2-alpha.2 integration.

The latest runtimes are checked as published packages on macOS and Linux. The newer Desktop shells and Windows Desktop are not covered by a new hands-on UI run. DSH `0.2.2-alpha.2` requires Node.js 24.9 or later when used outside its bundled Desktop runtime.

## 中文

本版新增 DSH `0.2.1-rc.4` 和 `0.2.2-alpha.2` 适配，保留此前声明支持的宿主版本。安装包为 `dsh-article-review@0.2.2-alpha.16`，通过 npm `next` 通道及 GitHub 预构建标签发布。

DSH `0.2.2-alpha.2` 移除了 `tools.presentAs`。新版宿主上，进入和退出论文审阅均沿用宿主选择的原生或 PTC 执行器；旧宿主保留审阅期间的原生工具展示。稿件、批注和人工审阅基线的存储格式保持不变。

rc.3、rc.4 和 0.2.2-alpha.2 均通过 Host/Client 类型检查和各 298 项集成测试，覆盖脚本化模型提案、接受/拒绝、退出后普通工具、图表面板及导入技能。实际安装包另行验证认证、同源检查、客户端模块交付、打开稿件、批注、人工基线及重启恢复；该检查不调用真实模型。

发布流水线在三个版本验收后才通过 npm OIDC 发布同一归档，随后核对官方源和国内镜像的归档，并在三个运行时中从两个源按包名安装。最新运行时以 macOS 和 Linux 上的公开发行包验收；本轮没有对新版 Desktop 外壳或 Windows Desktop 做新的人工界面验收。单独运行 DSH `0.2.2-alpha.2` 需要 Node.js 24.9 或更新版本，Desktop 使用自带运行时。
