# macOS Polish — Audit Report

**Branch:** `mac-polish-audit`
**Auditor:** Claude (Opus 4.7), 2026-04-30
**Repo state at audit time:** `master` HEAD = `396ae1a` ("PixelPusher v1.0.0 - clean source"), plus uncommitted work from earlier in the session (icon.icns, build/entitlements.mac.plist, expanded `mac:` block in electron-builder.yml).

**Status update (post-implementation pass, same date):** items 2, 3, 4, 5, 6, 7 implemented and verified at the build/launch level. Items 1 remains blocked on Apple Developer Program enrollment ($99/yr). Implementation details are appended to each item section below.

---

## Executive Summary

**Premise correction:** the audit prompt assumes the seven polish items were already implemented. They were not. The earlier session (Phase 1–9) only did the bare-minimum Mac port: created `build/icon.icns`, created `build/entitlements.mac.plist`, and expanded the `mac:` block in `electron-builder.yml` with `identity: null`, `hardenedRuntime: false`, and dual `arm64`/`x64` targets. None of the seven polish items in this prompt have been implemented. The audit therefore mostly reads "Fail / Not Implemented," but the value is (a) a verified baseline of what's actually in the codebase, (b) cross-checked current Apple/Electron documentation pinned to the right versions, and (c) one **real bug** discovered while validating item 2 that needs fixing before any release.

| # | Item                          | Initial        | Post-impl                          |
|---|-------------------------------|----------------|------------------------------------|
| 1 | Code-signing + Notarization   | Fail           | **Blocked** (needs Developer ID). Wiring + `.env.example` + comments prepared so a single config flip activates it once the cert lands. |
| 2 | Universal binary              | Fail (bug)     | **Pass** — single universal `.dmg` (192 MB) + `.zip` (186 MB). Main exec is fat `x86_64 arm64`, both sharp arches present in correct dirs, better-sqlite3 is fat. Arm64-sharp bug fixed. |
| 3 | Native menu + lifecycle       | Partial        | **Pass (code-verified, not click-tested)** — App / Edit / Window menus added; toggleDevTools dev-only; "Quit" label dropped on Mac; About moved to App menu on Mac. |
| 4 | Dock integration              | Fail           | **Pass (code-verified)** — `setProgressBar` wired into scan/organize/hash with cleanup on every exit path; error-count badge after organize; all calls platform-guarded. |
| 5 | TCC usage strings             | Fail           | **Pass at the build level; runtime-blocked on signing.** All five Usage keys present in built Info.plist. **macOS still won't fire prompts until the app has a stable signature** (item 1) — verified by `plutil -p` but not by a real permission dialog. |
| 6 | titleBarStyle hiddenInset     | Fail           | **Pass (code-verified)** — `titleBarStyle: 'hiddenInset'` on darwin only; drag region on the header with no-drag on interactive children; 84-px left padding to clear traffic lights. |
| 7 | Auto-update                   | Fail           | **Wired; runtime-blocked on signing.** `electron-updater@6.8.3` installed, `publish: github`, `.dmg + .zip` targets, dialog-on-update-downloaded, logger routed. Will refuse to install updates until item 1 ships a stable signature. |

**Audit pass:** no code changes — only research and documentation.

**Implementation pass (later same day):** items 2–7 implemented per the plan in each section below. Item 1 prep work done (config commented for one-flip activation, `.env.example` + `.gitignore` updates) but signing itself is blocked on cert acquisition.

---

## Pre-flight Inventory

### Versions

| Package                | Installed | Latest (Apr 2026) | Gap |
|------------------------|-----------|-------------------|-----|
| `electron`             | 29.4.6    | 41.3.0            | **12 majors behind — Electron 29 is EOL since Sept 2024** |
| `electron-builder`     | 24.13.3   | 26.8.1            | 2 majors behind |
| `electron-updater`     | not installed | n/a           | not used |
| `@electron/notarize`   | 2.2.1 (transitive via electron-builder) | 3.1.1 | 1 major behind |
| `@electron/universal`  | 1.5.1 (transitive)               | 2.0.3 | 1 major behind |
| `@electron/rebuild`    | 3.6.0     | (current)         | ok |
| `electron-log`         | not installed | n/a           | not used |
| Node target by Electron 29 | v20.9.0 | n/a             | matches host nvm Node 20.20.2 |

`npm audit --omit=dev`: **0 vulnerabilities** in production deps.

### Current `mac` block (`electron-builder.yml` after prior session's edits)

```yaml
mac:
  category: public.app-category.utilities
  icon: build/icon.icns
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  hardenedRuntime: false
  gatekeeperAssess: false
  identity: null
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

`asarUnpack` is correctly set for native modules:

```yaml
asarUnpack:
  - "node_modules/better-sqlite3/**/*"
  - "node_modules/sharp/**/*"
  - "node_modules/@img/**/*"
  - "node_modules/exiftool-vendored*/**/*"
```

No `publish:` field. No `mac.extendInfo`. No `mac.notarize`. No `afterSign` hook.

### Current `BrowserWindow` constructor (`src/main/index.ts:34-51`)

```ts
mainWindow = new BrowserWindow({
  width: bounds?.width ?? 1280,
  height: bounds?.height ?? 800,
  x: bounds?.x,
  y: bounds?.y,
  minWidth: 900,
  minHeight: 600,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
  },
  title: 'PixelPusher',
  icon: app.isPackaged
    ? undefined
    : path.join(__dirname, '../../../build/icon.png'),
  show: false,
});
```

No `titleBarStyle`, no `trafficLightPosition`, no `vibrancy`, no `frame`/`transparent` overrides.

### Current entitlements file (`build/entitlements.mac.plist`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
  <key>com.apple.security.files.downloads.read-write</key>
  <true/>
</dict>
</plist>
```

This is fine *as a starting point* but will be irrelevant until `hardenedRuntime: true` and a real signing identity are configured (entitlements are only enforced under hardened runtime).

### `Info.plist` `extendInfo` additions

**None.** Built `Info.plist` (`release/mac/PixelPusher.app/Contents/Info.plist`) Usage keys via `plutil -p`:

```
"NSBluetoothAlwaysUsageDescription" => "This app needs access to Bluetooth"
"NSBluetoothPeripheralUsageDescription" => "This app needs access to Bluetooth"
"NSCameraUsageDescription" => "This app needs access to the camera"
"NSMicrophoneUsageDescription" => "This app needs access to the microphone"
```

These are Electron's default placeholder strings, not chosen by this app. The file-system-access keys the photo organizer actually needs are absent.

### CI

**None.** No `.github/workflows/`, no `.gitlab-ci.yml`, no `.circleci/`. All builds are local-only. There is no signing-cert handling, no notarize step, no published release pipeline.

### Tests

`vitest run` passes: **62 tests across 4 files** (`database`, `file-mover`, `junk-detector`, `pattern`). None of these exercise Mac-specific behavior. There is no Playwright/Spectron e2e harness.

---

## Item 1 — Code-signing + Notarization

**Status: Fail (intentionally disabled, distribution-blocking)**

### Findings

- `electron-builder.yml` line 24: `identity: null` — signing explicitly disabled.
- `electron-builder.yml` line 22: `hardenedRuntime: false` — entitlements are non-binding without hardened runtime; notarization will reject.
- `electron-builder.yml` line 23: `gatekeeperAssess: false` — correct (avoids a build-machine pre-check that would fail on unsigned builds), but moot until signing is enabled.
- No `mac.notarize` field, no `afterSign` hook, no `scripts/notarize.js`.
- Grep for `appleId|APPLE_ID|TEAM_ID|APP_SPECIFIC_PASSWORD|CSC_LINK|CSC_KEY_PASSWORD` in repo → **0 matches**. No hardcoded credentials (good); also no documented env var path (bad — there's no template for the user to fill in).
- Build was verified earlier in the session: electron-builder logged `skipped macOS code signing  reason=identity explicitly is set to null` and produced an unsigned `.dmg` that triggers Gatekeeper on first launch.
- Verification commands per the prompt (`codesign --verify`, `spctl --assess`, `xcrun stapler validate`) were not run because there is nothing signed to verify. Running them now would just confirm "rejected, source=Unnotarized Developer ID."

### What current docs say (cross-checked)

- electron-builder uses `@electron/notarize` v3.x under the hood, which calls `xcrun notarytool`. The legacy `altool` path is gone (Apple deprecated altool in Nov 2023).
- The supported way to enable notarization in electron-builder ≥24 is to set `mac.notarize: true` (or an object) and provide credentials via env vars: either `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`, or `APPLE_KEYCHAIN` + `APPLE_KEYCHAIN_PROFILE`. (Sources: electron-builder mac docs; @electron/notarize README.)
- electron-builder defaults: `hardenedRuntime: true` and `gatekeeperAssess: false`. Our config overrides hardenedRuntime to `false`, which the docs warn against for any signed build.

### Common bugs already partially relevant

- **`mac.notarize: false` left in from local-dev debugging** — n/a (field absent).
- **Native modules in `app.asar.unpacked` not signed** — would matter once signing is on; current `asarUnpack` config covers `better-sqlite3`, `sharp`, `@img/*`, `exiftool-vendored*`, all of which would need to be signed in a recursive `--deep` codesign pass. electron-builder handles this when `identity` is set; just noting for when it gets enabled.

### What needs to happen to mark this Pass

1. Acquire Apple Developer Program membership ($99/yr) + create a Developer ID Application certificate.
2. Set `hardenedRuntime: true`, remove `identity: null` (let it auto-detect or set `mac.identity: "Developer ID Application: <Name> (<TeamID>)"`).
3. Add `mac.notarize: true` (or `{ teamId: "<TeamID>" }`).
4. Add an `.env.example` documenting which of the three credential modes the project will use, and add the env-var read path to the build pipeline (most likely CI; see Manual Action below).
5. After build, run on the artifact:
   - `codesign --verify --deep --strict --verbose=2 release/mac/PixelPusher.app`
   - `spctl --assess --type execute --verbose release/mac/PixelPusher.app`
   - `xcrun stapler validate release/mac/PixelPusher.app`
   - `xcrun stapler validate release/PixelPusher-1.0.0.dmg`

### Interim recommendation (not a fix; a stopgap)

If the user wants to ship unsigned builds short-term but still let TCC prompts fire on modern macOS, change `identity: null` → `identity: "-"` (ad-hoc signing). Per current TCC guidance, ad-hoc signing produces a stable code signature that lets `Info.plist` Usage strings reach the system permission prompt UI; with `identity: null`, TCC may silently deny. (Source: HackTricks macOS TCC overview; Apple Dev Forums thread 678816.) **This is a workaround, not a substitute for proper signing + notarization.**

### Manual Action Required

- Apple Developer Program enrollment (paid, blocking).
- Decide credential transport: App Store Connect API key (recommended for CI) vs app-specific password vs keychain profile.
- Set up macOS CI (GitHub Actions `macos-latest` or self-hosted) — Linux runners cannot sign or notarize.

### Implementation pass (post-audit)

**Status: Blocked** (no Developer ID cert; cannot complete locally).

Prep done so the path to enabled signing is one config flip:

- `electron-builder.yml` `mac.identity` left at `null` with a 5-line comment block listing the three signing options and the exact codesign command for ad-hoc post-build signing if needed.
- `mac.notarize: false` added explicitly (was implicit).
- `.env.example` written documenting the three credential modes (App Store Connect API key, app-specific password, keychain profile) plus the cert-related env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_NAME`).
- `.gitignore` extended: `.env`, `.env.local`, `*.p8`, `*.p12`.

Initial attempt to use `identity: "-"` for ad-hoc signing was reverted: electron-builder 24 doesn't recognize `-` as the ad-hoc sentinel — it tries to look up a literal cert by that name, fails, and falls back to skipping signing (same end result as `null`, with a confusing log line). Upgrading electron-builder to 25+ may help; for now, the documented post-build `codesign --force --deep --sign -` command is the cleanest interim path if ad-hoc is desired.

Verification commands documented for when this item is unblocked:

```sh
codesign --verify --deep --strict --verbose=2 release/mac-universal/PixelPusher.app
spctl --assess --type execute --verbose release/mac-universal/PixelPusher.app
xcrun stapler validate release/mac-universal/PixelPusher.app
xcrun stapler validate release/PixelPusher-1.0.0-universal.dmg
```

---

## Item 2 — Universal Binary

**Status: Fail (and: a real native-module bug)**

### Findings

- `mac.target` is `[arm64, x64]` separate archs, **not** `universal`. Output: two `.dmg`s (`PixelPusher-1.0.0-arm64.dmg`, `PixelPusher-1.0.0.dmg`). This is technically a valid configuration but does not match the user's stated preference for a single universal `.dmg`.

### `lipo -info` results from the verified build

Main executables:

```
release/mac/PixelPusher.app/Contents/MacOS/PixelPusher
  → Non-fat file, architecture: x86_64

release/mac-arm64/PixelPusher.app/Contents/MacOS/PixelPusher
  → Non-fat file, architecture: arm64
```

Both are correct for their target arch.

Native modules in the **arm64** build:

```
.../app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node
  → Non-fat file, architecture: x86_64   ← BUG
.../app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  → Non-fat file, architecture: arm64    ← correct
```

Native modules in the **x64** build:

```
.../app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node
  → architecture: x86_64                  ← correct
.../app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  → architecture: x86_64                  ← correct
```

### The bug

The arm64 `.dmg` ships **`@img/sharp-darwin-x64`** (Intel sharp binary) instead of `@img/sharp-darwin-arm64`. Sharp uses npm `optionalDependencies` to deliver platform-specific prebuilt binaries — only the host's variant gets installed during `npm install`. Because the dev machine is Intel, only `sharp-darwin-x64` was installed and electron-builder bundled exactly that into both arch builds. **Result: on Apple Silicon, `require('sharp')` will fail at runtime**, breaking perceptual-hash duplicate detection (a core feature per `CLAUDE.md`).

This is the canonical "JS code is universal, native modules are not" failure mode the prompt called out.

`better-sqlite3` doesn't have this bug because it's a single package and electron-builder rebuilds it per-arch via `prebuild-install` during the package step — the build log shows `install prebuilt binary  name=better-sqlite3 version=9.6.0 platform=darwin arch=arm64` then `arch=x64`.

### Fix paths (do not implement in audit pass)

Pick one when implementing:

1. **Stay on separate-archs but add cross-arch sharp variants.** Add a `postinstall` step (or pre-`dist` step) that installs the arm64 sharp binary explicitly:
   ```
   npm install --no-save --include=optional --os=darwin --cpu=arm64 \
     @img/sharp-darwin-arm64@0.33.5 @img/sharp-libvips-darwin-arm64@1.0.4
   ```
   Then add both `@img/sharp-darwin-arm64` and `@img/sharp-libvips-darwin-arm64` to the `asarUnpack` glob (current `node_modules/@img/**/*` already covers them).
2. **Switch to `arch: universal`.** Add a single `target: dmg` with `arch: universal`, and configure `@electron/universal` to handle the per-arch native modules. This requires both the x64 and arm64 sharp variants installed at build time (same install dance as #1) plus electron-builder will use `@electron/universal` to merge them. Note the package version installed (1.5.1) is a major version behind the current 2.x — bump it during this work.
3. **Build on a native arm64 Mac.** If the official build host is Apple Silicon, `npm install` will fetch `sharp-darwin-arm64` natively and the bug disappears for the arm64 dmg, but the x64 dmg then has the *same* bug with the arches inverted. So this just trades one platform for the other unless combined with #1.

### Common bugs already partially relevant

- "**`npm rebuild` runs only for the host arch and electron-builder doesn't catch it**" — exact failure mode hit here for sharp.
- `app.asar.unpacked` config — not the problem; the unpack glob is correct, the file just contains the wrong binary.

### What needs to happen to mark this Pass

- Decide separate-archs vs universal (design decision).
- Install/bundle both arm64 and x64 sharp variants.
- Re-run `lipo -info` on every `.node` in the artifact and confirm correct arch (or `x86_64 arm64` if universal).
- For universal: also confirm `Architectures in the fat file: x86_64 arm64` on the main executable.
- Test launch on Apple Silicon hardware (this audit ran on Intel; arm64 dmg has not been runtime-tested).

### Manual Action Required

- Access to an Apple Silicon Mac for runtime verification of the arm64 build, OR a CI runner with `macos-latest` (which is now arm64).

### Implementation pass

**Status: Pass** at the build/inspection level (runtime test on Apple Silicon still pending, see Manual Action above).

Changes:

- `scripts/ensure-mac-arches.js` — new script that, on darwin, checks for both `@img/sharp-darwin-{arm64,x64}` and `@img/sharp-libvips-darwin-{arm64,x64}` in `node_modules` and runs `npm install --no-save --include=optional --cpu=<arch> --os=darwin sharp` for any missing arch. The `--cpu`/`--os` flags bypass the platform filter that was making sharp's optional deps skip on the host arch.
- `package.json` — `predist: npm run ensure:mac-arches` so the dist build always pre-flights both arches.
- `electron-builder.yml` — `mac.target` switched to a single `arch: universal` (with an `arch: [arm64, x64]` fallback retained as comments).

Verification (`lipo -info` on the universal build artifact):

```
release/mac-universal/PixelPusher.app/Contents/MacOS/PixelPusher
  → Architectures in the fat file: x86_64 arm64                 ✓ universal main exec

.../app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node
  → x86_64                                                       ✓
.../app.asar.unpacked/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node
  → arm64                                                        ✓ (was missing pre-fix)
.../app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  → Architectures in the fat file: x86_64 arm64                 ✓ fat
```

(sharp's prebuilds aren't published as fat binaries — they ship one `.node` per arch in their respective `@img/sharp-darwin-<arch>` packages, both included in the bundle. At runtime sharp picks the right one via its loader. better-sqlite3 was rebuilt as a true fat binary by electron-builder's per-arch rebuild step.)

Output sizes: `.dmg` 192 MB (vs ~108 MB single-arch), `.zip` 186 MB. ~2× as expected for a universal binary.

---

## Item 3 — Native Menu + Lifecycle

**Status: Partial**

### Findings

**Lifecycle (correct):**

- `src/main/index.ts:106-108` — `window-all-closed` does not quit on darwin: ✓
- `src/main/index.ts:110-112` — `activate` recreates the window if none open: ✓
- `src/main/index.ts:114-121` — `before-quit` flushes logger, closes ExifTool and DB cleanly: ✓
- `src/main/index.ts:15-19` — `requestSingleInstanceLock` enforced: ✓ (works correctly with `app.on('second-instance')` at :99)

**Menu (`src/main/menu.ts`):**

The menu has four top-level submenus: **File, View, Tools, Help**. Missing for a proper Mac app:

| Required             | Present | Notes |
|----------------------|---------|-------|
| App menu (named "PixelPusher" with About / Services / Hide / Hide Others / Show All / Quit) | ❌ | Cmd-H hide, Cmd-Alt-H hide-others won't work. About is in Help instead. |
| Edit menu (roles: undo, redo, cut, copy, paste, pasteAndMatchStyle, delete, selectAll) | ❌ | **Critical**: without these roles, Cmd-C/V/X/Z and the right-click "Look Up / Search With" context menu will not work in renderer text inputs. |
| Window menu (roles: minimize, zoom, separator, front, list of windows) | ❌ | Cmd-M minimize will not work. |
| Services submenu inside App menu | ❌ | Required for system Services integration; `submenu: []` placeholder must be present for it to populate. |

Other findings in the existing menu:

- `menu.ts:33` — `{ role: 'quit', label: 'Exit' }` overrides the system label. On Mac the convention is "Quit PixelPusher". Removing the `label:` override lets it default correctly per platform. (Cmd-Q still works.)
- `menu.ts:53` — `{ role: 'toggleDevTools' }` is exposed in production builds. Common practice is dev-only:
  ```ts
  ...(process.env.NODE_ENV === 'development' ? [{ role: 'toggleDevTools' }] : [])
  ```
- `menu.ts:18-29` — File menu items use raw `accelerator` + `click` handlers that send IPC to the renderer. This is fine for app-specific actions like "Open Source Folder", but the rest of the menu has the same pattern for things that *could* be roles — though in this menu specifically there aren't any role-replaceable items (all Tools/Help entries are app-specific).
- The menu builder is invoked from `app.whenReady().then(...) → createWindow() → buildMenu()` (`index.ts:129/154/82`). This is correct ordering: `app.name` is available by the time `buildMenu` runs, so the App menu (when added) will get the right label.

**Test results manually walked (not click-verified, code-verified):**

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| Cmd-Q quits | ✓ | `role: 'quit'` at File:Exit — works. |
| Cmd-W closes window without quitting app | **Fail** | No `role: 'close'` anywhere; default Cmd-W will be unbound. |
| Cmd-A in text fields | **Fail** | No Edit menu with `selectAll` role. |
| Cmd-Z undo in text fields | **Fail** | Same. |
| Right-click → Look Up / Search With | **Fail** | Same — depends on Edit menu being present. |
| Services submenu populates | **Fail** | No App menu, no Services entry. |
| Cmd-, opens Preferences | **Fail** | No App menu, no preferences pane in this app yet. |

### Common bugs to look out for during implementation

- Don't hardcode the label "PixelPusher" in the App menu — use `app.name` so it always matches `productName` from electron-builder.yml.
- DevTools accelerator: `'CmdOrCtrl+Alt+I'` on Mac should be `'Cmd+Alt+I'` or just use `role: 'toggleDevTools'` (which sets the right one per platform).
- A `null`/`undefined` slipping into the template silently breaks the entire menu — the `buildRecentFoldersMenu` and `buildThemeMenu` helpers always return a valid object, ✓ — but if you add new helpers, watch this.

### What needs to happen to mark this Pass

- Add App menu, Edit menu, Window menu (with the standard roles).
- Add Services submenu placeholder.
- Move "About PixelPusher" from Help to App menu (Help → About is non-conventional on Mac).
- Optionally: gate `toggleDevTools` to dev builds only.
- Manual click-test of Cmd-A/C/V/Z in a text input, Cmd-W close, Cmd-M minimize, right-click in input.

### Implementation pass

**Status: Pass at the code/structure level. Click-tests pending (require interactive launch).**

`src/main/menu.ts` rewritten. New top-level layout (darwin):

```
PixelPusher → About / Services / Hide / Hide Others / Show All / Quit
File         → New Session / Open Source / Open Destination / Recent / Close
Edit         → Undo / Redo / Cut / Copy / Paste / Paste & Match Style / Delete / Select All / Speech
View         → Collapse All / Expand All / Theme / Reload / DevTools (dev-only) / Zoom / Fullscreen
Tools        → Clear DB / View Logs / Clear Old Logs
Window       → Minimize / Zoom / Bring All to Front
Help         → View Logs
```

Non-darwin platforms get the same menus minus the App menu and with About in Help (the standard cross-platform location).

Specifics:

- `app.name` used dynamically for the App menu label and About items — survives a `productName` rename in electron-builder.yml.
- Services submenu: `{ role: 'services', submenu: [] }` — empty array required for system population.
- DevTools: gated by `process.env.NODE_ENV === 'development' || !app.isPackaged`. Production users won't see Reload/DevTools entries.
- File menu: `{ role: 'quit', label: 'Exit' }` removed — last entry is now `role: 'close'` on Mac (closes window without quitting) and `role: 'quit'` elsewhere.
- All Edit-menu entries use `role:` so system features (Look Up, Search With, Speech, native undo stack) work in renderer text inputs.
- Build-time menu helpers (`buildRecentFoldersMenu`, `buildThemeMenu`) preserved unchanged.

---

## Item 4 — Dock Integration During Long Operations

**Status: Fail (not implemented)**

### Findings

`grep -rn "setProgressBar\|app\.dock\|dock\." src/` → **0 matches**. There is no dock progress bar, no dock badge, no dock bounce.

The scan/organize logic (`src/main/file-scanner.ts`, `file-mover.ts`) emits IPC progress events to the renderer but never calls `mainWindow.setProgressBar(...)` or `app.dock.setBadge(...)`.

### What current docs say (cross-checked, Electron 29 BaseWindow API)

- `BrowserWindow.setProgressBar(progress)` accepts `[0, 1.0]` for normal progress, **`< 0` removes the bar** (the prompt says `-1` specifically; docs say "any negative" which `-1` satisfies), and `> 1` enters indeterminate mode.
- `app.dock` is `undefined` on non-darwin platforms; all calls must be guarded with `if (process.platform === 'darwin' && app.dock)`.
- Badge strings: short (≤3 chars) — macOS truncates anything longer.

### What needs to happen to mark this Pass

- In `src/main/ipc-handlers.ts` (or wherever scan/organize progress is emitted), call `mainWindow.setProgressBar(processed / total)` on each progress tick.
- Cleanup on every exit path: success, error, user cancel, app quit. The progress bar leaking after completion is a common bug.
- Guard all `app.dock.*` calls with `if (process.platform === 'darwin' && app.dock)`.
- Add `app.dock.setBadge(String(unresolvedDupes))` (or similar small int) when an operation completes, clear with `app.dock.setBadge('')`.
- Manual test: start a long scan, watch the dock icon, confirm progress bar fills smoothly and disappears on completion.

### Implementation pass

**Status: Pass at the code level. Manual dock test pending interactive launch.**

New module `src/main/mac-dock.ts` with five helpers, all platform-guarded:

```ts
setDockProgress(win, processed, total)  // sets value in [0,1] or indeterminate when total<=0
clearDockProgress(win)                  // sets -1 to remove
setDockBadge(text)                      // 1–3 char string
clearDockBadge()
dockBounce(type)
```

Wired into `src/main/ipc-handlers.ts`:

| Operation | progress tick                | success                    | error                       | exit (`finally`)                |
|-----------|------------------------------|----------------------------|-----------------------------|---------------------------------|
| scan      | `setDockProgress` per batch  | (handled by finally)       | (handled by finally)        | `clearDockProgress`             |
| organize  | `setDockProgress` per batch  | `clearDockProgress` + badge if errors>0 | `clearDockProgress` | (already cleared in success/error)            |
| hash      | `setDockProgress` per batch  | (handled by finally)       | (handled by finally)        | `clearDockProgress`             |

Additional cleanup: `clearDockBadge()` is called at the start of every new scan/organize so a stale "errors" badge doesn't carry over.

Edge cases handled:

- `app.dock` is `undefined` outside darwin — every helper short-circuits.
- `win.isDestroyed()` checked before `setProgressBar` (matches existing patterns in the file).
- Discovery phase (total unknown) calls `setDockProgress(win, 0, 0)` which the helper translates to indeterminate (`setProgressBar(2)`).

---

## Item 5 — TCC Usage Strings in Info.plist

**Status: Fail (silent-failure mode active)**

### Findings

`grep -rn "extendInfo\|NS[A-Z][a-z]+UsageDescription"` in `electron-builder.yml`, `package.json`, `build/*.plist` → **0 matches** for file-system access keys.

`plutil -p release/mac/PixelPusher.app/Contents/Info.plist | grep Usage` from the built artifact:

```
"NSBluetoothAlwaysUsageDescription" => "This app needs access to Bluetooth"
"NSBluetoothPeripheralUsageDescription" => "This app needs access to Bluetooth"
"NSCameraUsageDescription" => "This app needs access to the camera"
"NSMicrophoneUsageDescription" => "This app needs access to the microphone"
```

Those are Electron's defaults. **Every key the photo organizer actually needs is absent**:

- `NSDesktopFolderUsageDescription` — missing
- `NSDocumentsFolderUsageDescription` — missing
- `NSDownloadsFolderUsageDescription` — missing
- `NSRemovableVolumesUsageDescription` — missing
- `NSNetworkVolumesUsageDescription` — missing (relevant if scanning SMB/NFS shares)
- `NSPhotoLibraryUsageDescription` — irrelevant unless the app touches Photos.app library directly (it doesn't, per CLAUDE.md — it walks arbitrary filesystem trees).

### Why this is the silent-failure mode the prompt warned about

When a TCC-protected folder is accessed without the corresponding Usage key in `Info.plist`, modern macOS does **not** show a permission prompt and does **not** return an error to the app — it silently returns an empty directory listing or `EPERM`. The user sees "scan completed, found 0 files" with no visible reason. This will hit anyone who points PixelPusher at `~/Desktop`, `~/Documents`, `~/Downloads`, or an external drive on Sonoma+.

### Compounding factor: signing

Per cross-checked guidance, **TCC requires a stable code signature** (Developer ID, app-store, or at minimum ad-hoc `identity: "-"`). The current build has `identity: null`, which means TCC may silently deny prompts even *with* the keys added. Add the keys AND switch from `identity: null` to at least `identity: "-"` or, ideally, real signing.

### What needs to happen to mark this Pass

In `electron-builder.yml`:

```yaml
mac:
  # ...
  extendInfo:
    NSDesktopFolderUsageDescription: "PixelPusher needs access to your Desktop to scan and organize photos and videos stored there."
    NSDocumentsFolderUsageDescription: "PixelPusher needs access to your Documents to scan and organize photos and videos stored there."
    NSDownloadsFolderUsageDescription: "PixelPusher needs access to your Downloads folder so it can move photos and videos out of it."
    NSRemovableVolumesUsageDescription: "PixelPusher needs access to external drives to scan and organize photos and videos stored on them."
    NSNetworkVolumesUsageDescription: "PixelPusher needs access to network shares to scan and organize photos and videos stored on them."
```

Strings should be plain-English and explain the reason — Apple's review process rejects vague placeholders, and users are far more likely to deny if the text reads like boilerplate.

After implementation:

1. Build, then `plutil -p release/mac/PixelPusher.app/Contents/Info.plist | grep Usage` and confirm all five keys made it into the built `Info.plist` (extendInfo can fail silently on YAML indentation errors).
2. Test on a fresh user account or one where `tccutil reset SystemPolicyDesktopFolder com.pixelpusher.app` (and equivalents) have been run — first scan attempts on Desktop / Documents / Downloads / external drive should each fire the macOS permission prompt with the strings above.

### Common bugs the implementation should avoid

- Indentation: `extendInfo` is a YAML mapping nested under `mac:` — wrong nesting silently no-ops.
- Confusing Photos.app library access (`NSPhotoLibraryUsageDescription`) with picture-files-in-the-filesystem (the four folder keys above). PixelPusher needs the latter, not the former, per CLAUDE.md architecture.

### Implementation pass

**Status: Pass at the build level. Real TCC prompts depend on item 1 (signing).**

`mac.extendInfo` block added with all five Usage strings (Desktop, Documents, Downloads, RemovableVolumes, NetworkVolumes). Verified in the built `Info.plist`:

```
$ plutil -p release/mac-universal/PixelPusher.app/Contents/Info.plist | grep -E "Usage|NS[A-Z][a-z]+Folder|Removable|Network"

"NSDesktopFolderUsageDescription"   => "PixelPusher needs access to your Desktop to scan and organize photos and videos stored there."
"NSDocumentsFolderUsageDescription" => "PixelPusher needs access to your Documents to scan and organize photos and videos stored there."
"NSDownloadsFolderUsageDescription" => "PixelPusher needs access to your Downloads folder so it can move photos and videos out of it."
"NSNetworkVolumesUsageDescription"  => "PixelPusher needs access to network shares to scan and organize photos and videos stored on them."
"NSRemovableVolumesUsageDescription"=> "PixelPusher needs access to external drives to scan and organize photos and videos stored on them."
```

(Bluetooth/Camera/Microphone keys are still in the plist — those are Electron's defaults, untouched.)

**Important caveat carried forward:** TCC requires a stable code signature to actually fire the permission prompt UI. With current `identity: null`, modern macOS may silently deny without prompting, even though the keys are now correct. This will fully activate when item 1 is unblocked. For interim validation, the user can manually ad-hoc sign the bundle:

```sh
codesign --force --deep --sign - release/mac-universal/PixelPusher.app
```

---

## Item 6 — `titleBarStyle: 'hiddenInset'` + Drag Region

**Status: Fail (not implemented)**

### Findings

- `BrowserWindow` ctor (`src/main/index.ts:34-51`): no `titleBarStyle`, no `trafficLightPosition`, no `frame: false`, no `vibrancy`. The window uses default Mac chrome (full title bar).
- `src/renderer/styles/globals.css` (199 lines): zero references to `-webkit-app-region`. There is no drag region defined anywhere in the renderer.
- The renderer markup has no top-bar element; the React app mounts at `<div id="root" />` and rolls its own layout. Adding a drag region will require both a CSS rule and a top-bar component (or a `position: absolute` invisible drag strip).

### What current docs say (Electron `BaseWindow` constructor options, cross-checked)

- Valid `titleBarStyle` values: `'default'` | `'hidden'` | `'hiddenInset'` | `'customButtonsOnHover'`.
- `'hiddenInset'`: traffic lights "slightly more inset from the window edge" — the look the prompt wants.
- `'hidden'`: traffic lights at default position (top-left ~7px), no title bar.
- `'customButtonsOnHover'`: experimental, traffic lights only appear on hover.
- `BrowserWindow.setProgressBar(progress)`: any negative value (including `-1`) removes the progress bar; `>1` enters indeterminate mode.

### What needs to happen to mark this Pass

In `src/main/index.ts` BrowserWindow ctor, gate per-platform:

```ts
...(process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset' as const }
  : {}),
```

In the renderer, add a top-bar element (~32-38 px tall) with:

```css
.titlebar {
  -webkit-app-region: drag;
  height: 38px; /* tall enough for hiddenInset traffic lights */
  user-select: none;
}
.titlebar button,
.titlebar input,
.titlebar select,
.titlebar a,
.titlebar .no-drag {
  -webkit-app-region: no-drag;
}
```

Reserve ~70 px on the top-left for the traffic lights (don't render anything there). On non-darwin, the same titlebar area can render normal window controls or just be omitted.

### Common bugs the implementation should avoid

- `-webkit-app-region: drag` on `body` makes nothing clickable.
- Setting `titleBarStyle` without leaving room for the traffic lights = lights overlap content.
- Forgetting `no-drag` on inputs/buttons = users can't interact with anything in the drag region.

### Implementation pass

**Status: Pass at the code level. Visual confirmation pending interactive launch.**

Changes:

- `src/main/index.ts` BrowserWindow ctor: `...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {})` — only applied on darwin so Windows/Linux still get their native title bar.
- `src/main/preload.ts`: bridge `process.platform` to renderer as `electronAPI.platform`.
- `src/shared/types.ts`: extend `ElectronAPI` with `platform: NodeJS.Platform`.
- `src/renderer/App.tsx`:
  - At module load, set `<html data-platform="<platform>">` so CSS can scope styles.
  - Header element gets `className="app-titlebar"`, `paddingLeft: 84` on Mac (clears traffic lights), and inline `WebkitAppRegion: 'drag'` (cast through `as React.CSSProperties` to satisfy TS).
  - The right-side button group inside the header gets `WebkitAppRegion: 'no-drag'` so its buttons remain clickable.
- `src/renderer/styles/globals.css`:
  ```css
  [data-platform="darwin"] .app-titlebar { -webkit-app-region: drag; user-select: none; }
  [data-platform="darwin"] .app-titlebar button,
  [data-platform="darwin"] .app-titlebar input,
  [data-platform="darwin"] .app-titlebar select,
  [data-platform="darwin"] .app-titlebar a,
  [data-platform="darwin"] .app-titlebar .no-drag { -webkit-app-region: no-drag; }
  ```

The 84-px left padding on Mac reserves room for the three traffic light buttons (~70 px wide region). The header is 40 px tall, which is sufficient for `hiddenInset` (the inset traffic lights occupy ~28 px vertically, centered).

---

## Item 7 — Auto-update via electron-updater

**Status: Fail (not implemented)**

### Findings

- `electron-updater` is **not** in `package.json` (neither `dependencies` nor `devDependencies`).
- `grep -rn "electron-updater\|autoUpdater\|publishing" src/` → **0 matches**. No autoUpdater wiring anywhere.
- `electron-builder.yml` has **no `publish:` field**, so the built `latest-mac.yml` (which *was* emitted at `release/latest-mac.yml`) points at no real publish target.
- No `dev-app-update.yml` (good — no risk of dev builds checking for updates, but irrelevant without the rest).
- Mac auto-update **requires signed builds**: electron-updater verifies the new bundle's signature against the running app's signature. With item 1 unresolved, this item is a no-op even if implemented.

### What current docs say (cross-checked)

- Auto-update needs `electron-updater` dependency + a `publish:` config (`github`, `s3`, `digitalOceanSpaces`, `keygen`, `generic`).
- Mac auto-update **requires the `.zip` target alongside `.dmg`**. Squirrel.Mac (the underlying updater for macOS) reads from `.zip`, not `.dmg`. Current `mac.target` is `dmg` only — needs to add `zip`.
- `latest-mac.yml` is generated automatically — already emitted by current build.
- Code-signing identity must be **stable across versions**. Re-signing v1.0.1 with a different cert than v1.0.0 will cause electron-updater to refuse the update with "New version is not signed by the application owner" — the silent-failure mode the prompt called out.

### What needs to happen to mark this Pass

1. Resolve item 1 first (signing + notarization).
2. `npm install electron-updater` (current major).
3. Add to `electron-builder.yml`:
   ```yaml
   publish:
     provider: github   # or s3, generic
     owner: christhomas2131
     repo: pixelpusher
   mac:
     target:
       - target: dmg
         arch: [arm64, x64]   # or universal
       - target: zip          # required for mac auto-update
         arch: [arm64, x64]
   ```
4. In `src/main/index.ts` after `app.whenReady()` resolves:
   ```ts
   import { autoUpdater } from 'electron-updater';
   autoUpdater.logger = logger;            // wire to existing logger
   autoUpdater.checkForUpdatesAndNotify(); // or finer-grained event handling
   ```
5. Decide UX: silent-on-restart vs prompt-now vs banner; wire `update-available` / `update-downloaded` / `error` events; only call `quitAndInstall()` after user consent.
6. Test the full flow end-to-end: build 1.0.0, install, ship 1.0.1, launch 1.0.0, watch update download and install. **No shortcut on this — Mac signature verification is its own failure surface and must be tested live.**

### Manual Action Required

- Apple Developer cert with stable team ID (item 1).
- A publish target with credentials. For GitHub: a `GH_TOKEN` env var on the build machine, plus a public release on the repo.

### Implementation pass

**Status: Wired and initializing. Real update flow blocked on item 1 (signing) and on a published 1.0.1 release.**

New dependency: `electron-updater@6.8.3` (added to `dependencies` — flagged here per the prompt's "no new deps without justification" rule; required for item 7, no viable alternative).

Changes:

- `electron-builder.yml`:
  - `publish: { provider: github, owner: christhomas2131, repo: pixelpusher }`
  - `mac.target` now produces both `dmg` and `zip` (zip required by Squirrel.Mac for auto-update).
- `src/main/auto-update.ts` — new module:
  - Adapts the existing rotating-file logger to electron-updater's `Logger` interface (info/warn/error/debug).
  - Skips entirely if `!app.isPackaged` (no dev-build update pings).
  - `autoDownload: true`, `autoInstallOnAppQuit: true`.
  - Listens for `checking-for-update`, `update-available`, `update-not-available`, `error`, `download-progress`, `update-downloaded`.
  - `update-downloaded` shows a native dialog ("Restart Now" / "Later"); only `quitAndInstall()` on consent.
- `src/main/index.ts`: `initAutoUpdate(getWindow)` called inside `app.whenReady()` after `createWindow()`.

Verification of the wiring (packaged-app launch on darwin x64):

```
[2026-04-30 ...] [INFO] [updater] Checking for update
```

The check itself will fail until a real GitHub Release with 1.0.1 + `latest-mac.yml` exists at the publish target. That's expected; the wiring is the deliverable.

**Will not work end-to-end until item 1 ships a stable Developer ID signature** — Mac auto-update verifies the new bundle's signature against the running app's signature before applying. Re-signing 1.0.1 with a different cert than 1.0.0 is the #1 silent-failure mode.

---

## Cross-cutting Concerns

### Build reproducibility

- `npm run build` produced identical output on two consecutive runs in this session (webpack reported "compared for emit" on the second run, indicating no content drift).
- No `.env.example`. Once item 1 introduces credential env vars, an example file is mandatory for onboarding.

### Dependency hygiene

- **`electron@29.4.6` is end-of-life** as of Sept 2024. Out-of-scope to upgrade in this audit, but flagging: continued use of an EOL Electron means no Chromium security patches. The codebase uses Electron 29-specific APIs that would mostly survive a bump to 30/31, but a 29→41 jump will require a deliberate migration pass.
- `electron-builder@24` → 26 — two majors behind. The `mac.notarize` shape changed at some point; verify when implementing item 1.
- `@electron/notarize` (transitive) and `@electron/universal` (transitive) are one major behind their latest. Bumping electron-builder will pull these forward.

### Existing tests

`vitest run` passes 62/62 on darwin x64 (`database`, `file-mover`, `junk-detector`, `pattern`). None exercise menu, dock, signing, updater, or window chrome — those would need integration tests (Playwright or similar). No regressions to flag.

### CI

**None.** All seven items above need a Mac CI runner to be properly automated and notarized. GitHub Actions `macos-latest` is now arm64 — useful for catching the sharp-arm64 bug from item 2 automatically.

---

## Out-of-Scope Findings (logged, not fixed)

These were noticed during the audit; per the prompt's hard rule they are not addressed here.

1. **Electron 29 EOL** (see above).
2. `package.json` `"author": ""` and `"license": "ISC"` — license is "ISC" but `LICENSE` file in the repo says something else; worth aligning before any public release.
3. `src/main/menu.ts:33` `{ role: 'quit', label: 'Exit' }` overrides the system label. Mac convention is "Quit PixelPusher" — drop the `label:` override.
4. `src/main/menu.ts:53` `{ role: 'toggleDevTools' }` is exposed in production. Consider gating to dev only.
5. `electron-builder.yml` `files:` includes `node_modules/**/*` explicitly — redundant with electron-builder's defaults but harmless.
6. The renderer's `index.html` CSP allows `'unsafe-eval'` in `script-src`. Not a Mac issue but worth a security note.

---

## Manual Action Required

Items the audit cannot resolve from inside the repo:

- **Apple Developer Program membership** ($99/yr) — gates items 1, 5 (effectively), 7.
- **macOS CI runner** (GitHub Actions `macos-latest` or self-hosted) — required for repeatable signing/notarization and for catching the sharp-arm64 bug.
- **Choice of credential transport for notarization** (App Store Connect API key recommended).
- **Choice of publish target for auto-update** (GitHub Releases recommended for an open-source repo).
- **An Apple Silicon Mac** to runtime-test the arm64 build (or rely on a `macos-latest` arm64 runner).
- **Decision: separate-arch builds vs universal `.dmg`** (item 2 design choice).

---

## Sources Cited

- [electron-builder — macOS Configuration](https://www.electron.build/mac.html)
- [electron-builder — Auto Update](https://www.electron.build/auto-update)
- [electron-builder — Multi Platform Build](https://www.electron.build/multi-platform-build.html)
- [@electron/notarize on GitHub](https://github.com/electron/notarize)
- [@electron/universal on GitHub](https://github.com/electron/universal)
- [Electron BaseWindow constructor — `titleBarStyle`, `setProgressBar`](https://www.electronjs.org/docs/latest/api/base-window)
- [Apple Developer Forums — TCC silent-deny on unsigned apps (thread 678816)](https://developer.apple.com/forums/thread/678816)
- [HackTricks — macOS TCC overview](https://angelica.gitbook.io/hacktricks/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-tcc)
