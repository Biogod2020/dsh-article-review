# 0.2.2-alpha.17 — bare-name installation

Install `dsh-article-review` in DSH's plugin manager. This release publishes to npm's `latest` tag, which is what an unversioned package name resolves. Previous releases on `next` did not update `latest`, so bare-name installation still selected `0.2.1-alpha.1` and failed the newer host's compatibility check.

The host/client runtime is unchanged from `0.2.2-alpha.16`. Supported DSH versions and manuscript/review storage formats are unchanged. The release workflow now publishes to `latest`, verifies that both registries point that tag at the tested archive, and installs the bare name in rc.3, rc.4 and 0.2.2-alpha.2. Each install must report the expected package version before its authenticated API and restart checks run.

Pin `dsh-article-review@0.2.2-alpha.17` when you need a fixed version. A future preview intentionally published only to `next` will remain separate from bare-name installs. Installed profiles and lockfiles require an explicit update; this release does not promise automatic upgrades of existing installations. Windows Desktop has not received a new hands-on hardware check.

## 中文

在 DSH 的插件管理器中填写 `dsh-article-review` 即可按裸名安装。本版发布到 npm 的 `latest` 标签；裸名默认解析到这个标签。此前新包只发布到 `next`，`latest` 仍指向旧版 `0.2.1-alpha.1`，导致新版 DSH 的兼容检查拦截安装。

本版 Host/Client 运行文件与 `0.2.2-alpha.16` 相同，支持的宿主版本和审阅数据格式保持不变。发布流程改为 `latest`，核对官方源与国内镜像的标签及归档，并在 rc.3、rc.4、0.2.2-alpha.2 中使用裸名安装。每次安装先核对实际版本，再检查认证接口、批注、人工基线和重启恢复。

需要固定版本时使用 `dsh-article-review@0.2.2-alpha.17`；明确独立的预览才使用 `next`。已有安装和锁文件仍需显式更新，不代表所有已安装用户会自动升级。Windows Desktop 本轮未新增真实硬件界面验收。
