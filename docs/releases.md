# macOS arm64 releases

`npm run release:build` builds the app, DMG and signed updater archive, then writes
`latest.json` and SHA256SUMS under `release/<version>/` (ignored by Git).

The public updater key is in `src-tauri/tauri.conf.json`. Keep its corresponding
private key outside the repository, by default at
`~/.config/hebe/release-keys/updater.key`, with mode 0600. Back this key up securely:
losing it prevents updates for installed clients. Never regenerate it for a
routine release. A custom path or key can be supplied through
`TAURI_SIGNING_PRIVATE_KEY`; encrypted keys also need
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Do not print or commit these values.

For each release:

1. Keep versions in package.json, Cargo.toml and tauri.conf.json aligned; refresh
   their lockfiles. Update `docs/release-notes.md`.
2. Run `npm test` and `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml`.
3. Build with `npm run release:build` on Apple Silicon. The app bundle uses
   explicit ad-hoc signing (`signingIdentity: "-"`) until a Developer ID is
   available, and the build script rejects bundles failing strict codesign
   validation. Verify the DMG, executable
   architecture, archive signature and generated manifest before uploading.
4. Commit changes, push main, and create a draft GitHub Release with tag
   `v<version>` targeting that commit. Upload every file from `release/<version>/`.
5. Publish the draft as the latest stable release after inspecting its assets.
   The app uses `releases/latest/download/latest.json`, compares versions, and
   verifies the archive signature before installation. Only darwin-aarch64 is
   advertised; never point an Intel target to this archive.

Automatic checks run three seconds after launch and every 30 minutes while visible.
Returning to the app or reconnecting triggers a check if the last success is over
five minutes old; failures retry after one minute. Hidden windows defer work.
Disabling the preference stops scheduled checks; manual checks remain available.
Checking never installs automatically. The user downloads/installs in the Settings → Updates panel, then restarts explicitly through the original installed bundle path,
after the old process has exited (no forced new instance). Unsaved documents are checked before installation and restart. A failed check or download can be retried.

Updater signatures authenticate Hebe update packages. They are distinct from
Apple Developer ID signing and notarization. This initial release has no Developer
ID certificate or Apple notarization; do not describe it as notarized. Install
Hebe.app in a writable Applications folder before using in-app updates, rather
than running directly from the read-only DMG. Test a subsequent version using an
isolated copy of the installed app; do not replace a user's running app to test.

