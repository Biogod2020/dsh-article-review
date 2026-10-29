# Bare-name installation and fresh releases

`dsh-article-review` follows npm's `latest` tag. Normal releases publish to `latest`; deliberately separate previews may use `next`. A higher version on `next` does not update bare-name installs.

pnpm 11 also applies a default minimum release age of 1440 minutes. DSH uses pnpm, so its installer can select an older eligible release even when `latest` already points to a newly published version. Our unmodified-profile check reproduced `0.2.2-alpha.14` after `latest` had moved to `0.2.2-alpha.17`. The original failed check is retained: [release acceptance](https://github.com/Biogod2020/dsh-article-review/actions/runs/40876212205).

There are three supported choices:

- Keep the normal 24-hour policy and install the bare name once the desired release is old enough.
- Request today's exact version with `dsh-article-review@0.2.2-alpha.17`.
- If you trust this package and want its fresh releases immediately by bare name, add only this package to the profile's pnpm release-age exclusions.

For the third choice, edit the existing `pnpm-workspace.yaml` in your DSH profile. Desktop normally uses `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml` on Windows and `~/.dsh/profiles/desktop/pnpm-workspace.yaml` on macOS/Linux. Web uses the `web` profile. Append the package to an existing `minimumReleaseAgeExclude` list, or add this key if absent; keep the file's other settings:

```yaml
minimumReleaseAgeExclude:
  - dsh-article-review
```

Then install `dsh-article-review` in Plugins → Add plugin. This exception applies to this package, while other dependencies retain their release-age policy. Existing installed versions and lockfiles still need an explicit update.

The immediate-release acceptance uses that declared package-only exception and checks the exact installed version, authenticated API, annotations, human baselines and restart recovery. The manual `installation.yml` workflow defaults to the unchanged pnpm policy; choose `package-exception` to verify the explicit opt-in. A configured test passing does not mean a default-profile install has passed before the waiting period.

Sources: [npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/), [pnpm dependency resolution settings](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/dependency-resolution.md).

## 中文

裸名 `dsh-article-review` 跟随 npm 的 `latest` 标签；正常发行发布到 `latest`，独立预览才使用 `next`。

pnpm 11 另有默认 **24 小时新包观察期**。DSH 使用 pnpm，因此即使注册表的 `latest` 已更新，刚发布当天的裸名安装仍可能选择较旧版本。本次默认配置实测选择了 `.14`；[失败验收记录](https://github.com/Biogod2020/dsh-article-review/actions/runs/40876212205)保持原样。

- 保留默认策略：等目标版本发布满 24 小时后，再按裸名安装。
- 今天直接装指定版本：填写 `dsh-article-review@0.2.2-alpha.17`。
- 希望今天也使用裸名：信任此包的用户可在 DSH profile 现有 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 列表中追加 `dsh-article-review`，配置格式见上方。没有该键时再新增，保留其他配置。

Windows Desktop 路径通常为 `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`；macOS/Linux 为 `~/.dsh/profiles/desktop/pnpm-workspace.yaml`。Web 对应 `web` profile。之后在 Plugins → Add plugin 中输入裸名即可；其他依赖继续使用原有观察期。已有安装和锁文件仍需显式更新。

即时安装验收会明确启用“只对此包例外”的配置，并核对实际版本、认证接口、批注、人工基线和重启恢复。`installation.yml` 手动验证默认使用未修改策略，也可选择 `package-exception` 验证上述配置；配置后的验证通过，不代表未配置的当天裸名安装已经通过。
