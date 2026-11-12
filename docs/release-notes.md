# Hebe 1.2.2 — Responsive writing and readable PDF tables

窗口缩放时正文与源码自动换行，编辑区保持居中；列表续行保持缩进，长链接和行内代码可折行。代码预览默认自动换行，也可在设置中关闭，改用块内横向滚动。表格单元格随内容增高，宽表格在自身区域滚动。

PDF 导出中的长代码不再被裁切。超宽表格根据纸张与页边距分组排版，每组重复第一列以对应行数据；长标识符和行内代码可换行。包含合并单元格的超宽表格会明确提示拆分后再导出。

修复源码模式快捷键误插入注释、专注/打字机模式样式在编辑后丢失的问题，并增加 WebKit 输入法确认键保护，避免表格中结束拼音输入时误触行导航。

在 Hebe 中选择 **Hebe → Check for Updates…**，检测到更新后点击窗口红黄绿按钮旁的橙色圆点，下载安装并重启。

Body and source text now wrap as the window changes size. Code preview wrapping is configurable, table cells grow with their contents, and wide blocks scroll locally. PDF exports wrap long code and split wide tables into readable column groups with a repeated first column. Source-mode shortcuts and writing-mode styling are more reliable.

Validation: 74 frontend tests and 11 Rust tests passed, including real PDF exports at A4/Letter sizes with multiple margins and font sizes. Native source switching and ordinary table editing/navigation were checked. Final native IME confirmation-key retesting and candidate-panel positioning remain unverified because system input-source controls were unavailable during testing.

Requires Apple Silicon and macOS 13+. PDF export requires Pandoc, XeLaTeX and the fvextra TeX package. The app is ad-hoc signed, without Apple Developer ID notarization.
