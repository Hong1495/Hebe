# Hebe 1.2.1 — Visible exports on macOS Desktop

修复导出到桌面后 Finder 看不到文件、再次导出却提示覆盖的问题。导出完成前会清除临时文件遗留的 macOS 隐藏标记，保留其他文件标记；PDF、HTML、DOCX、EPUB 均适用，导出失败仍保留原文件。

在 Hebe 中选择 **Hebe → Check for Updates…**，检测到更新后点击窗口红黄绿按钮旁的橙色圆点，下载安装并重启。

PDF, HTML, DOCX and EPUB exports now clear macOS's hidden-file flag before the completed file is committed. This fixes exports to Desktop and other folders where Pandoc can mark a dot-prefixed temporary output hidden. The change preserves all other file flags and keeps atomic overwrite behavior.

Verified with 73 frontend tests, 9 Rust tests, a production build, and the release checks for the signed Apple Silicon updater archive.

Requires Apple Silicon and macOS 13+. PDF export requires Pandoc and XeLaTeX. The app is ad-hoc signed, without Apple Developer ID notarization.
