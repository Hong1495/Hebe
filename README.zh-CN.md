# Hebe

**安静、轻量的桌面 Markdown 写作工具。**

Hebe 是一款受 Typora 启发的开源 Markdown 编辑器：平时阅读排版后的文档，点击即可编辑源码，内容始终保存在本地 Markdown 文件中。

[下载 macOS 版本](https://github.com/Hong1495/Hebe/releases/latest) · [English](README.md) · [反馈问题](https://github.com/Hong1495/Hebe/issues)

![Hebe 编辑器](assets/hebe-editor.png)

## 功能

- 即时预览与源码模式，支持标题、列表、引用、链接、强调等常见 Markdown 语法。
- 可编辑表格、代码块、Mermaid 图表、KaTeX 数学公式与本地图片粘贴。
- 多标签编辑，同一会话内保留撤销历史、光标和滚动位置。
- 原生菜单、可选大纲、深浅主题、专注模式与打字机模式。
- 已保存文件停止输入三秒后自动保存，关闭窗口或退出时确认未保存内容。
- 通过 Pandoc 导出 PDF、DOCX、HTML、EPUB，支持 Mermaid 图片导出。
- 参考 Bee 实现签名升级：窗口红黄绿按钮旁的等间距橙色圆点、版本说明浮层、自动检查、手动下载安装、确认后重启。

## 安装

首个公开版本 **v1.1.0** 支持 **Apple Silicon Mac，macOS 13 及以上**，暂不提供 Intel Mac、Windows 或 Linux 安装包。

1. 从 [Releases](https://github.com/Hong1495/Hebe/releases/latest) 下载 DMG。
2. 将 Hebe.app 拖入 Applications，从安装位置启动；不要直接在只读 DMG 中使用升级功能。
3. 本版本为 ad-hoc 签名，未经过 Apple Developer ID 签名和公证。如被 macOS 阻止，在确认来源和校验文件后，通过「系统设置 → 隐私与安全性 → 仍要打开」启动。

菜单「Hebe → Check for Updates…」和「Settings → Updates」可手动检查升级。自动检查可以关闭，发现新版本后不会自动安装。更新包签名与 Apple 公证是两回事。

## 导出

日常编辑无需安装额外工具。导出需要 [Pandoc](https://pandoc.org/installing.html)，PDF 还需要 XeLaTeX（MacTeX / BasicTeX / TeX Live 及所需宏包）。中文 PDF 使用系统苹方字体。

```bash
brew install pandoc
brew install --cask basictex
```

导出文件生成在文档旁边，同名目标会被覆盖。相对图片路径按文档目录解析。导出与图片粘贴前需先保存文档。

## 开发

技术栈：Tauri 2、React 19、TypeScript、CodeMirror 6、Rust。需要 Xcode 命令行工具、当前稳定版 Rust 和 Node.js 22.12+，推荐 Node 24 LTS。

```bash
npm ci
npm run tauri:dev
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

浏览器预览使用 `npm run dev`，文件操作、原生菜单和升级需在 Tauri 中运行。参阅[架构说明](docs/architecture.md)与[发布流程](docs/releases.md)。

## 当前边界

无需账号，不提供云同步。更新检查访问 GitHub；文档中的远程图片可能访问图片服务器。最近文件路径与偏好设置保存在本机。

启动时恢复最近一个文件；不提供未保存草稿的崩溃恢复，撤销历史不跨重启保存。MDX 作为文本编辑，不执行 JSX。导出排版由 Pandoc 模板决定，不保证与编辑器完全一致。

欢迎提交包含最小 Markdown 样例和复现步骤的 Issue。采用 [MIT 许可证](LICENSE)。
