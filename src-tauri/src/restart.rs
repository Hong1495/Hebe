// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

// Resolve once before the updater swaps bundles. Looking up the running binary
// after replacement can resolve to the moved/deleted backup on macOS.
pub struct RestartTarget(pub Option<PathBuf>);
impl RestartTarget {
    pub fn capture() -> Self {
        Self(
            std::env::current_exe()
                .ok()
                .and_then(|p| bundle_root(&p))
                .and_then(|p| p.canonicalize().ok()),
        )
    }
}
fn bundle_root(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app")
        .then(|| bundle.to_path_buf())
}

const REOPEN: &str = r#"
parent="$1"
bundle="$2"
# LaunchServices must see the old instance exit before opening the same bundle.
while /bin/kill -0 "$parent" 2>/dev/null; do /bin/sleep 0.2; done
exec /usr/bin/open -a "$bundle"
"#;

#[tauri::command]
pub fn restart_after_update(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<RestartTarget>();
    let bundle = state.0.as_ref().ok_or("请退出开发版本后手动打开 Hebe")?;
    if !bundle.join("Contents/Info.plist").is_file() {
        return Err("原安装位置不存在，请手动重新打开 Hebe".into());
    }
    // Arguments never become shell source. The detached helper waits for this
    // PID, then opens the installed .app without requesting a second instance.
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", REOPEN, "hebe-restart"])
        .arg(std::process::id().to_string())
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    command.process_group(0);
    command.spawn().map_err(|e| e.to_string())?;
    crate::quit_app(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_uses_original_bundle_path() {
        assert_eq!(
            bundle_root(Path::new("/Applications/Hebe.app/Contents/MacOS/hebe")),
            Some(PathBuf::from("/Applications/Hebe.app"))
        );
        assert_eq!(
            bundle_root(Path::new(
                "/Users/test/My Apps/Hebe.app/Contents/MacOS/hebe"
            )),
            Some(PathBuf::from("/Users/test/My Apps/Hebe.app"))
        );
        assert_eq!(bundle_root(Path::new("/tmp/target/debug/hebe")), None);
    }
}
