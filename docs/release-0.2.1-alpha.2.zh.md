# 0.2.1-alpha.2：侧栏图标

将审阅入口的默认立方体占位符替换为“稿纸＋批注笔”。使用插件内置 SVG、圆角细线和 `currentColor`，按 DSH 原生尺寸显示并跟随深浅主题，无需外部图片或新版共享图标模块。

![深色主题中的审阅入口](screenshots/sidebar-icon-dark.png)

![浅色主题中的审阅入口](screenshots/sidebar-icon-light.png)

已在隔离的 macOS Desktop `0.2.0-rc.2` 中通过原生插件管理器安装及启用候选包，验证标准宽度、窄侧栏、深浅主题和点击入口。原审阅标签页、批注及累计人工基线恢复正常。测试后恢复系统主题跟随并退出测试 App。

两个已支持的 DSH 版本分别通过宿主/客户端类型检查及 38 文件、240 项集成测试。改动仅涉及图标注册、SVG 和发行版本，审阅流程、存储格式与人工基线规则未变。其他功能的 Desktop 验收见 [0.2.1-alpha.1 记录](release-0.2.1-alpha.1.zh.md)。

安装规格：`dsh-article-review@0.2.1-alpha.2`。Desktop 升级按插件管理器提示卸载旧版、安装新版并启用；工作区中的 `.paper-review/` 记录继续使用。
