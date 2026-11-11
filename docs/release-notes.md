# Hebe 1.2.0 — Safer writing, longer documents

## 文档安全

- 所有标签独立自动保存，切换标签不会取消其他文档的保存。
- 使用原子写入，并在保存前核对磁盘版本；外部修改与保存失败会显示提示。
- 恢复打开的标签和未命名草稿；提供查看磁盘副本、另存副本及确认覆盖入口。
- 连续输入期间保留最新编辑，关闭与退出等待进行中的保存。

## 写作体验

- 修复专注模式的当前行强调，实现打字机模式的光标居中。
- 输入法组合期间暂停自动保存和外部重载。
- 异步图片插入跟踪原始位置，避免光标移动后插错位置。

## 导出与长文

- 所有导出可选择目标位置，覆盖已有文件需确认，导出失败保留旧文件。
- PDF 支持 A4 / Letter、字号、页边距、目录和章节编号，修复 XeLaTeX 导出路径。
- 新增正文 `[toc]` 目录、脚注跳转及 YAML Front Matter 预览。
- Format 菜单新增图片、目录与脚注插入；图片支持替换和编辑描述/路径。

## Upgrade / 升级

在已安装的 Hebe 中选择 **Hebe → Check for Updates…**，点击红黄绿窗口按钮旁的橙色圆点，下载安装后重启。菜单检查保持后台运行。也可下载 DMG 手动安装。

This release adds independent per-tab autosave, atomic writes, draft recovery, external-change protection, working focus/typewriter modes, configurable PDF export, footnotes, contents, Front Matter and image actions. Verified with 73 frontend tests, 7 Rust tests and a real Chinese PDF export.

Requires Apple Silicon and macOS 13+. PDF export requires Pandoc and XeLaTeX. Draft recovery uses local WebView storage; clearing app data removes drafts, and undo history remains session-only. Native Chinese IME candidate-window flows have not been fully exercised. Updater archives use the existing trusted signing key. The app is ad-hoc signed, without Apple Developer ID notarization.
