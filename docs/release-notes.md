# Hebe 1.1.1 — A fresh mark, quieter updates

- Replace the app icon with the new feather-and-leaf M: Markdown writing meets Hebe’s spirit of youth and renewal. Update the macOS icon and browser favicon together.
- Keep **Hebe → Check for Updates…** in the background. It no longer opens Settings, switches settings sections, or automatically opens an update popover.
- When a new version is found, the orange indicator remains beside the macOS window controls. Click it to view release notes and install.
- Add regression coverage for available updates, no update, and network failures while preserving the current settings visibility.

## 从 1.1.0 升级

在已安装的 Hebe 中检查更新，点击橙色圆点，选择下载安装，再重启。1.1.0 的检查入口仍可能弹出设置，这是旧版本行为；升级到 1.1.1 后菜单检查会保持后台运行。

Requires Apple Silicon and macOS 13+. Signed updater archives use the same trusted key as 1.1.0. This release is ad-hoc signed and is not Apple-notarized.
