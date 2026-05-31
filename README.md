# PixelPusher

> Organize thousands of photos and videos into clean, date-based folders. Fast, safe, local.

![PixelPusher](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![License](https://img.shields.io/badge/license-Proprietary-red)

PixelPusher is a desktop app for anyone drowning in unorganized photos. Point it at a messy folder (or a whole drive), and it'll read the dates from your photos and videos, find duplicates, and organize everything into a folder structure you choose. Nothing leaves your computer.

## What it does

- **Scans any folder** — recursively finds every photo and video, reads EXIF dates, falls back to filename and file system dates when EXIF is missing
- **Organizes by date** — customizable folder patterns like `2024/January` or `2024/Q1/March` or `By Camera/iPhone 14 Pro/2024`
- **Finds duplicates** — perceptual hashing catches visually identical photos even if they're renamed, resized, or slightly different quality
- **Handles Google Takeout and iCloud exports** — parses the JSON sidecars, links Live Photo pairs, deduplicates album copies
- **Junk detection** — flags thumbnails, face crops, and cache files from Lightroom, iPhoto, Picasa, and Synology
- **Supports 40,000+ file libraries** — tested on real photo libraries with stable memory usage throughout
- **Safe by default** — copies files rather than moves, logs every operation, full undo for any session

## Screenshots

<!-- Add screenshots here -->

## Installation

### macOS

1. Download the matching `.dmg` from the [latest release](https://github.com/christhomas2131/pixelpusher/releases/latest):
   - Apple Silicon (M1/M2/M3/M4): `PixelPusher-1.0.0-arm64.dmg`
   - Intel: `PixelPusher-1.0.0-x64.dmg`
2. Open the `.dmg` and drag PixelPusher into Applications.
3. Launch from Applications.

**Note on Gatekeeper:** PixelPusher is not currently code-signed on macOS, so the first launch will show a "PixelPusher cannot be opened because the developer cannot be verified" dialog. To open it:

- Right-click PixelPusher in Applications → **Open** → **Open** in the second dialog, **or**
- Run once from Terminal to clear the quarantine flag:
  ```
  xattr -d com.apple.quarantine /Applications/PixelPusher.app
  ```

This is standard for small indie apps until a Developer ID code-signing certificate is purchased + notarization is enabled.

### Windows

1. Download `PixelPusher Setup 1.0.0.exe` from the [latest release](https://github.com/christhomas2131/pixelpusher/releases/latest)
2. Double-click to install
3. Launch PixelPusher from the Start menu

**Note on Windows SmartScreen:** PixelPusher is not currently code-signed, so Windows will show a "Windows protected your PC" warning on first install. Click **More info** → **Run anyway**. This is standard for small indie apps until a code signing certificate is purchased.

### System Requirements

- macOS 12 (Monterey) or later — Apple Silicon or Intel
- Windows 10 or 11 (64-bit)
- 8 GB RAM recommended for libraries over 20,000 files
- 500 MB free disk space for the app itself
- Additional disk space equal to your library size if using Copy mode

## Quick Start

1. **Add a source folder** — click "+ Add Source" and pick the folder (or drive) with your photos
2. **Pick scan settings** — Quick Scan (date only, fastest) or Full Scan (all metadata); Safe, Balanced, or Fast speed
3. **Click Scan Folder** — PixelPusher reads every file and extracts metadata
4. **Choose a destination** — where the organized copies should go
5. **Pick a folder pattern** — e.g. `{YYYY}/{MMM}` for `2024/January`
6. **Choose Copy or Move** — Copy is safer (keeps originals), Move frees up space
7. **Click Organize** — PixelPusher creates the folder structure and places every file correctly

Every operation is logged. You can undo any session from the History panel.

## Folder Pattern Tokens

Build your own folder structure using these tokens:

| Token | Example |
|-------|---------|
| `{YYYY}` | 2024 |
| `{YY}` | 24 |
| `{MM}` | 03 |
| `{MMM}` | March |
| `{DD}` | 15 |
| `{QUARTER}` | Q1 |
| `{HALF}` | H1 |
| `{YEAR_RANGE}` | 2020-2024 |
| `{CAMERA}` | iPhone 14 Pro |
| `{TYPE}` | image |
| `{TYPE_LABEL}` | Photos |
| `{EXT}` | jpg |

**Examples:**
- `{YYYY}/{MMM}` → `2024/March`
- `{YYYY}/{QUARTER}/{MMM}` → `2024/Q1/March`
- `{CAMERA}/{YYYY}` → `iPhone 14 Pro/2024`
- `{TYPE_LABEL}/{YYYY}` → `Photos/2024` and `Videos/2024`

**Mode-aware tokens:** `{TYPE_LABEL}` and `{CAMERA}` resolve differently depending on the active profile:

| Token | PixelPusher (photos) | DataHoarder |
|-------|----------------------|-------------|
| `{TYPE_LABEL}` | Photos / Videos / RAW | Documents / Music / Design / 3D |
| `{CAMERA}` | EXIF camera model (e.g. iPhone 15 Pro) | Document author (e.g. "Microsoft Word", PDF author) |

## Supported File Types

**Photos:** JPG, JPEG, PNG, HEIC, HEIF, RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, and more)

**Videos:** MP4, MOV, M4V, AVI, MKV, WMV, 3GP, MTS

**Also supported (toggle in settings):** PDF, DOCX, MP3, FLAC, PSD, AI, STL, OBJ, and more

## Privacy

PixelPusher runs entirely on your computer. No photos, metadata, or telemetry leave your device. There is no cloud sync, no online account, no external servers. The only network traffic is the optional "Buy Pro" link, which opens your default browser to the pricing page, and (in builds with `SENTRY_DSN` set) anonymous crash reports.

## Pricing

- **Free tier** — up to **5,000 files per scan**, core organize features, perceptual-hash duplicate detection (first 25 groups)
- **Pro** — unlimited files, DataHoarder mode (PDFs/docs/audio/design/3D), unlimited dupe groups, AI search, auto-cluster, watch folders, $12 **one-time purchase** (no subscription, all future updates included)

## Known Issues

- Code signing not yet in place — both Windows SmartScreen and macOS Gatekeeper will warn on first launch (see Installation notes above)
- Linux builds coming in a future release
- Very large libraries (100,000+ files) may take 30+ minutes on slower drives

## Roadmap

- [x] macOS support (Apple Silicon + Intel)
- [x] DataHoarder mode (documents, audio, design, 3D)
- [x] Byte-exact duplicate detection (DataHoarder)
- [x] Dry-run preview tree before commit
- [ ] Linux support (AppImage)
- [ ] Code signing certificate + notarization
- [ ] Face recognition grouping (opt-in, fully local)
- [ ] Smart album suggestions
- [ ] Folder watcher for auto-organizing new files

## Report Bugs

Open an issue at [github.com/christhomas2131/pixelpusher/issues](https://github.com/christhomas2131/pixelpusher/issues) and include:
- Your OS and version (macOS 14.4, Windows 11, etc.)
- PixelPusher version (PixelPusher → About on macOS / Help → About on Windows)
- A description of what happened
- The log file:
  - macOS / Linux: `~/.photomove/logs/pixelpusher.log`
  - Windows: `%USERPROFILE%\.photomove\logs\pixelpusher.log`

## License

Copyright © 2026. All rights reserved. PixelPusher is proprietary software. See [LICENSE](LICENSE) for terms.

---

*Built with Electron, TypeScript, React, SQLite, and exiftool.*
